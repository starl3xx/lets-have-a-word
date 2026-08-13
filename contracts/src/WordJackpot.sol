// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title WordJackpot
 * @notice $WORD-denominated prize pool for Let's Have A Word.
 *
 * Replaces the ETH accounting in JackpotManagerV3. Rounds are seeded from a
 * treasury tranche held here, purchases top the pool up, and resolution pays
 * the 80/10/5/5 split in $WORD.
 *
 * Three deliberate departures from the contracts this supersedes:
 *
 * 1. Balances are tracked explicitly and NEVER inferred from balanceOf.
 *    WordManagerV3 derives staking headroom as `balanceOf - _totalSupply`, so
 *    tokens parked there for game purposes silently become staker rewards.
 *    Here `pool`, `carry` and `totalClaimable` are separate, and anything above
 *    their sum is unallocated and is the only thing the owner may sweep.
 *
 * 2. A failing recipient cannot brick a payout. JackpotManagerV3's
 *    resolveRoundWithPayouts reverts the entire distribution if one transfer
 *    fails. Here a failed transfer is credited to `claimable` for later pull.
 *
 * 3. There is a storage gap. Neither existing contract reserves one, which
 *    constrains every future upgrade to appending at the end.
 *
 * The contract holds no ETH: there is no payable function, no receive and no
 * fallback, so stray ETH reverts rather than being trapped.
 */
contract WordJackpot is
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable
{
    // =========================================================================
    // Storage — DO NOT REORDER, append only (see __gap at the end)
    // =========================================================================

    IERC20 public wordToken;
    address public operator;
    /// Receives creator overflow and swept unallocated balance
    address public treasury;

    /// $WORD allocated to the ACTIVE round
    uint256 public pool;
    /// $WORD reserved to seed the NEXT round
    uint256 public carry;
    /// Payouts that failed to transfer and are awaiting pull
    mapping(address => uint256) public claimable;
    uint256 public totalClaimable;

    uint256 public activeRoundId;

    /// USD per $WORD, scaled by 1e18
    uint256 public priceE18;
    uint64 public priceUpdatedAt;
    uint64 public maxPriceAge;

    /// Bounds on a single seed, in token wei. The upper bound is the blast
    /// radius limiter if the oracle is ever wrong or manipulated.
    uint256 public minSeedTokens;
    uint256 public maxSeedTokens;

    struct Round {
        uint256 startingPool;
        uint256 finalPool;
        uint256 winnerPayout;
        bytes32 commitHash;
        uint64 startedAt;
        uint64 resolvedAt;
        bool active;
    }
    mapping(uint256 => Round) public rounds;

    /// Reserved so future versions can add state without a layout migration.
    uint256[50] private __gap;

    // =========================================================================
    // Events
    // =========================================================================

    event PoolFunded(address indexed from, uint256 amount, uint256 unallocated);
    event WordPriceUpdated(uint256 priceE18, uint64 updatedAt);
    event RoundStarted(uint256 indexed roundId, uint256 seedTokens, uint256 seedUsdCents, bytes32 commitHash);
    event PoolToppedUp(uint256 indexed roundId, uint256 amount, uint256 newPool);
    event RoundResolved(uint256 indexed roundId, uint256 totalPaid, uint256 carryForNextRound);
    event PayoutSent(uint256 indexed roundId, address indexed to, uint256 amount);
    event PayoutDeferred(uint256 indexed roundId, address indexed to, uint256 amount);
    event Claimed(address indexed to, uint256 amount);
    event UnallocatedSwept(address indexed to, uint256 amount);
    event OperatorUpdated(address indexed previous, address indexed next);

    // =========================================================================
    // Errors
    // =========================================================================

    error NotOperator();
    error ZeroAmount();
    error ZeroAddress();
    error RoundAlreadyActive();
    error RoundNotActive();
    error WrongRound();
    error PriceUnset();
    error PriceStale();
    error SeedOutOfBounds(uint256 seedTokens);
    error InsufficientUnallocated(uint256 requested, uint256 available);
    error ArrayLengthMismatch();
    error TooManyRecipients();
    error PayoutMismatch(uint256 provided, uint256 expected);
    error NothingToClaim();
    error TransferFailed();

    uint256 public constant MAX_RECIPIENTS = 32;

    modifier onlyOperator() {
        if (msg.sender != operator && msg.sender != owner()) revert NotOperator();
        _;
    }

    // =========================================================================
    // Init
    // =========================================================================

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _wordToken,
        address _operator,
        address _treasury
    ) external initializer {
        if (_wordToken == address(0) || _operator == address(0) || _treasury == address(0)) {
            revert ZeroAddress();
        }
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __Pausable_init();

        wordToken = IERC20(_wordToken);
        operator = _operator;
        treasury = _treasury;

        maxPriceAge = 2 hours;
        minSeedTokens = 1_000_000e18;
        maxSeedTokens = 500_000_000e18;

        emit OperatorUpdated(address(0), _operator);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // =========================================================================
    // Accounting
    // =========================================================================

    /**
     * @notice Tokens held here that are not committed to a round, a carry, or a
     *         pending claim. The only balance the owner may sweep.
     */
    function unallocated() public view returns (uint256) {
        uint256 balance = wordToken.balanceOf(address(this));
        uint256 committed = pool + carry + totalClaimable;
        return balance > committed ? balance - committed : 0;
    }

    function solvency()
        external
        view
        returns (
            uint256 balance,
            uint256 pool_,
            uint256 carry_,
            uint256 claimable_,
            uint256 unallocated_
        )
    {
        balance = wordToken.balanceOf(address(this));
        pool_ = pool;
        carry_ = carry;
        claimable_ = totalClaimable;
        unallocated_ = unallocated();
    }

    /**
     * @notice Deposit $WORD for future seeds. Permissionless on purpose — it is
     *         a donation path as well as the treasury top-up, and it can only
     *         increase what the contract owes players.
     */
    function fund(uint256 amount) external whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (!wordToken.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        emit PoolFunded(msg.sender, amount, unallocated());
    }

    // =========================================================================
    // Oracle
    // =========================================================================

    function setWordPrice(uint256 _priceE18) external onlyOperator {
        if (_priceE18 == 0) revert PriceUnset();
        priceE18 = _priceE18;
        priceUpdatedAt = uint64(block.timestamp);
        emit WordPriceUpdated(_priceE18, priceUpdatedAt);
    }

    function isPriceStale() public view returns (bool) {
        if (priceE18 == 0 || priceUpdatedAt == 0) return true;
        return block.timestamp - priceUpdatedAt > maxPriceAge;
    }

    /**
     * @notice Token amount a given USD seed buys at the stored price.
     *
     * tokensWei = usdCents * 1e34 / priceE18
     *
     * Derivation: tokens = (usdCents / 100) / (priceE18 / 1e18), scaled to 18
     * decimals. At $20 (2000 cents) and $0.000000256 (priceE18 = 2.56e11) this
     * is 2000 * 1e34 / 2.56e11 = 7.8125e25, i.e. 78,125,000 tokens.
     */
    function seedTokensFor(uint256 usdCents) public view returns (uint256) {
        if (priceE18 == 0) revert PriceUnset();
        return (usdCents * 1e34) / priceE18;
    }

    // =========================================================================
    // Round lifecycle
    // =========================================================================

    /**
     * @notice Start a round, seeding it with a USD-denominated amount of $WORD.
     *
     * The token amount is computed here from the contract's own stored price
     * rather than passed in. If it were an argument the USD peg would be a
     * comment rather than a property, and a bad oracle tick would over-seed
     * instead of failing. Staleness and bounds are enforced for the same
     * reason: refusing to start a round is far cheaper than mispricing one.
     */
    function startRound(
        uint256 roundId,
        uint256 seedUsdCents,
        bytes32 commitHash
    ) external onlyOperator whenNotPaused {
        if (activeRoundId != 0 && rounds[activeRoundId].active) revert RoundAlreadyActive();
        if (roundId == 0) revert WrongRound();
        if (rounds[roundId].startedAt != 0) revert RoundAlreadyActive();
        if (isPriceStale()) revert PriceStale();

        uint256 seedTokens = seedTokensFor(seedUsdCents);
        if (seedTokens < minSeedTokens || seedTokens > maxSeedTokens) {
            revert SeedOutOfBounds(seedTokens);
        }

        // Consume the carry first, then unallocated tranche.
        uint256 fromCarry = carry >= seedTokens ? seedTokens : carry;
        uint256 needed = seedTokens - fromCarry;
        uint256 available = unallocated();
        if (needed > available) revert InsufficientUnallocated(needed, available);

        carry -= fromCarry;
        pool += seedTokens;

        activeRoundId = roundId;
        rounds[roundId] = Round({
            startingPool: seedTokens,
            finalPool: 0,
            winnerPayout: 0,
            commitHash: commitHash,
            startedAt: uint64(block.timestamp),
            resolvedAt: 0,
            active: true
        });

        emit RoundStarted(roundId, seedTokens, seedUsdCents, commitHash);
    }

    /**
     * @notice Add converted pack revenue to the live round's pool.
     */
    function topUpPool(uint256 amount) external onlyOperator whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (activeRoundId == 0 || !rounds[activeRoundId].active) revert RoundNotActive();
        uint256 available = unallocated();
        if (amount > available) revert InsufficientUnallocated(amount, available);

        pool += amount;
        emit PoolToppedUp(activeRoundId, amount, pool);
    }

    /**
     * @notice Resolve the active round, paying recipients and reserving carry.
     *
     * Amounts are computed off-chain (the 80/10/5/5 split) and validated here
     * to sum exactly to the pool. `recipients[0]` is the winner by convention.
     *
     * Deliberately NOT paused-gated: escrowed funds must always be able to
     * reach players even while the contract is paused for other reasons.
     */
    function resolveRound(
        uint256 roundId,
        address[] calldata recipients,
        uint256[] calldata amounts,
        uint256 carryForNextRound
    ) external onlyOperator nonReentrant {
        if (roundId != activeRoundId) revert WrongRound();
        Round storage round = rounds[roundId];
        if (!round.active) revert RoundNotActive();
        if (recipients.length != amounts.length) revert ArrayLengthMismatch();
        if (recipients.length > MAX_RECIPIENTS) revert TooManyRecipients();

        uint256 total = carryForNextRound;
        for (uint256 i = 0; i < amounts.length; i++) {
            // A nonzero amount aimed at address(0) would pass the sum check and
            // then be skipped by the payout loop, leaving those tokens in the
            // contract as unallocated — silently sweepable, and reported as
            // paid. Reject the array instead: a failed resolve is recoverable,
            // a misallocated one is not.
            if (amounts[i] > 0 && recipients[i] == address(0)) revert ZeroAddress();
            total += amounts[i];
        }
        if (total != pool) revert PayoutMismatch(total, pool);

        // State first: the loop below makes external calls.
        uint256 paid = pool - carryForNextRound;
        pool = 0;
        carry += carryForNextRound;
        round.finalPool = total;
        round.winnerPayout = amounts.length > 0 ? amounts[0] : 0;
        round.active = false;
        round.resolvedAt = uint64(block.timestamp);
        activeRoundId = 0;

        for (uint256 i = 0; i < recipients.length; i++) {
            address to = recipients[i];
            uint256 amount = amounts[i];
            if (to == address(0) || amount == 0) continue;

            // A failing recipient must not strand everyone else's payout, so
            // the transfer is attempted and any failure becomes a pull claim.
            (bool ok, bytes memory ret) = address(wordToken).call(
                abi.encodeCall(IERC20.transfer, (to, amount))
            );
            if (ok && (ret.length == 0 || abi.decode(ret, (bool)))) {
                emit PayoutSent(roundId, to, amount);
            } else {
                claimable[to] += amount;
                totalClaimable += amount;
                emit PayoutDeferred(roundId, to, amount);
            }
        }

        emit RoundResolved(roundId, paid, carryForNextRound);
    }

    /**
     * @notice Withdraw a payout that could not be transferred at resolution.
     */
    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();

        claimable[msg.sender] = 0;
        totalClaimable -= amount;

        if (!wordToken.transfer(msg.sender, amount)) revert TransferFailed();
        emit Claimed(msg.sender, amount);
    }

    // =========================================================================
    // Admin
    // =========================================================================

    /**
     * @notice Withdraw tokens not committed to a round, carry, or claim.
     *
     * Bounded by the accounting invariant, so this can never reach player
     * funds — the escape hatch JackpotManagerV3 lacks entirely.
     */
    function sweepUnallocated(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        uint256 available = unallocated();
        if (amount > available) revert InsufficientUnallocated(amount, available);
        if (!wordToken.transfer(to, amount)) revert TransferFailed();
        emit UnallocatedSwept(to, amount);
    }

    function setOperator(address _operator) external onlyOwner {
        if (_operator == address(0)) revert ZeroAddress();
        emit OperatorUpdated(operator, _operator);
        operator = _operator;
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
    }

    function setSeedBounds(uint256 _min, uint256 _max) external onlyOwner {
        if (_min == 0 || _max < _min) revert SeedOutOfBounds(_min);
        minSeedTokens = _min;
        maxSeedTokens = _max;
    }

    function setMaxPriceAge(uint64 _maxPriceAge) external onlyOwner {
        if (_maxPriceAge == 0) revert ZeroAmount();
        maxPriceAge = _maxPriceAge;
    }

    /// Pauses funding and round starts. resolveRound and claim stay available.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}

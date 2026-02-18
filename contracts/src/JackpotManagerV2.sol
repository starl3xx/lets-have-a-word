// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title JackpotManagerV2
 * @notice Manages jackpots, paid guesses, payouts, and CLANKTON bonus word rewards
 * @dev Milestone 6.1 - Smart Contract Specification
 *      Milestone 6.2 - CLANKTON Market Cap Oracle Integration
 *      Milestone X.X - Bonus Words Feature (CLANKTON rewards)
 *
 * Deployed on Base mainnet (UUPS upgrade from JackpotManager)
 *
 * New in V2:
 * - Bonus words commitment (10 words per round that win 5M CLANKTON each)
 * - CLANKTON token distribution for bonus word winners
 * - Combined commitment function for secret word + bonus words
 */
contract JackpotManagerV2 is
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable
{
    // ============ Constants ============

    /// @notice Minimum seed requirement for new rounds (0.02 ETH)
    uint256 public constant MINIMUM_SEED = 0.02 ether;

    /// @notice Percentage of guess purchase going to jackpot (80%)
    uint256 public constant JACKPOT_SHARE_BPS = 8000;

    /// @notice Percentage of guess purchase going to creator (20%)
    uint256 public constant CREATOR_SHARE_BPS = 2000;

    /// @notice Basis points denominator
    uint256 public constant BPS_DENOMINATOR = 10000;

    /// @notice Market cap threshold for HIGH bonus tier ($250,000 with 8 decimals)
    uint256 public constant MARKET_CAP_TIER_THRESHOLD = 250_000 * 1e8;

    /// @notice Maximum age for market cap data before considered stale (1 hour)
    uint256 public constant MARKET_CAP_STALENESS_THRESHOLD = 1 hours;

    /// @notice CLANKTON reward per bonus word (5 million tokens, assuming 18 decimals)
    uint256 public constant BONUS_WORD_REWARD = 5_000_000 * 1e18;

    /// @notice Number of bonus words per round
    uint256 public constant BONUS_WORDS_PER_ROUND = 10;

    // ============ Enums ============

    /// @notice Bonus tier based on CLANKTON market cap
    enum BonusTier {
        LOW,  // 2 free guesses per day for CLANKTON holders
        HIGH  // 3 free guesses per day for CLANKTON holders
    }

    // ============ State Variables (V1 - DO NOT REORDER) ============

    /// @notice Operator wallet address (authorized to resolve rounds)
    address public operatorWallet;

    /// @notice Creator profit wallet address
    address public creatorProfitWallet;

    /// @notice Prize pool wallet address (for seeding)
    address public prizePoolWallet;

    /// @notice Current round number
    uint256 public currentRound;

    /// @notice Current jackpot balance for the active round
    uint256 public currentJackpot;

    /// @notice Total ETH accumulated for creator profits
    uint256 public creatorProfitAccumulated;

    /// @notice Mapping of round number to round data
    mapping(uint256 => Round) public rounds;

    /// @notice Mapping of player address to total guesses purchased in current round
    mapping(address => uint256) public playerGuessesThisRound;

    /// @notice CLANKTON market cap in USD (8 decimals precision)
    uint256 public clanktonMarketCapUsd;

    /// @notice Timestamp of last market cap update
    uint256 public lastMarketCapUpdate;

    // ============ State Variables (V2 - NEW, added at end) ============

    /// @notice CLANKTON ERC-20 token contract address
    IERC20 public clanktonToken;

    /// @notice Mapping of round number to bonus words commitment hash
    mapping(uint256 => bytes32) public bonusWordsCommitHashes;

    /// @notice Mapping of round number to bonus word index to claimed status
    mapping(uint256 => mapping(uint256 => bool)) public bonusWordsClaimed;

    /// @notice Total CLANKTON distributed for bonus words (tracking)
    uint256 public totalClanktonDistributed;

    /// @notice Whether bonus words feature is enabled
    bool public bonusWordsEnabled;

    // ============ Structs ============

    struct Round {
        uint256 roundNumber;
        uint256 startingJackpot;
        uint256 finalJackpot;
        address winner;
        uint256 winnerPayout;
        uint256 startedAt;
        uint256 resolvedAt;
        bool isActive;
        bytes32 commitHash; // SHA-256 hash of (salt || answer) for provably fair verification
    }

    // ============ Events ============

    /// @notice Emitted when a new round starts
    event RoundStarted(
        uint256 indexed roundNumber,
        uint256 startingJackpot,
        uint256 timestamp
    );

    /// @notice Emitted when a new round starts with onchain commitment (provably fair)
    event RoundStartedWithCommitment(
        uint256 indexed roundNumber,
        uint256 startingJackpot,
        bytes32 indexed commitHash,
        uint256 timestamp
    );

    /// @notice Emitted when a new round starts with both secret and bonus words commitments
    event RoundStartedWithBonusWords(
        uint256 indexed roundNumber,
        uint256 startingJackpot,
        bytes32 indexed secretWordCommitHash,
        bytes32 indexed bonusWordsCommitHash,
        uint256 timestamp
    );

    /// @notice Emitted when a round is resolved and winner paid
    event RoundResolved(
        uint256 indexed roundNumber,
        address indexed winner,
        uint256 jackpotAmount,
        uint256 winnerPayout,
        uint256 timestamp
    );

    /// @notice Emitted when jackpot is seeded by operator
    event JackpotSeeded(
        uint256 indexed roundNumber,
        address indexed seeder,
        uint256 amount,
        uint256 newJackpot
    );

    /// @notice Emitted when guesses are purchased
    event GuessesPurchased(
        uint256 indexed roundNumber,
        address indexed player,
        uint256 quantity,
        uint256 ethAmount,
        uint256 toJackpot,
        uint256 toCreator
    );

    /// @notice Emitted when creator profit is withdrawn
    event CreatorProfitPaid(
        address indexed recipient,
        uint256 amount
    );

    /// @notice Emitted when operator wallet is updated
    event OperatorWalletUpdated(
        address indexed oldOperator,
        address indexed newOperator
    );

    /// @notice Emitted when creator profit wallet is updated
    event CreatorProfitWalletUpdated(
        address indexed oldWallet,
        address indexed newWallet
    );

    /// @notice Emitted when prize pool wallet is updated
    event PrizePoolWalletUpdated(
        address indexed oldWallet,
        address indexed newWallet
    );

    /// @notice Emitted when CLANKTON market cap is updated
    event MarketCapUpdated(
        uint256 marketCapUsd,
        uint256 timestamp
    );

    /// @notice Emitted when a round is resolved with multiple payouts (Milestone 6.9)
    event RoundResolvedWithPayouts(
        uint256 indexed roundNumber,
        address indexed winner,
        uint256 jackpotAmount,
        uint256 totalPaidOut,
        uint256 seedForNextRound,
        uint256 recipientCount,
        uint256 timestamp
    );

    /// @notice Emitted for each individual payout during round resolution
    event PayoutSent(
        uint256 indexed roundNumber,
        address indexed recipient,
        uint256 amount,
        uint256 index
    );

    /// @notice Emitted when CLANKTON token address is set
    event ClanktonTokenSet(
        address indexed tokenAddress
    );

    /// @notice Emitted when bonus word CLANKTON reward is distributed
    event BonusWordRewardDistributed(
        uint256 indexed roundNumber,
        address indexed recipient,
        uint256 bonusWordIndex,
        uint256 amount
    );

    /// @notice Emitted when bonus words feature is toggled
    event BonusWordsToggled(bool enabled);

    // ============ Errors ============

    error OnlyOperator();
    error RoundNotActive();
    error RoundAlreadyActive();
    error InsufficientSeed();
    error InvalidWinnerAddress();
    error InvalidQuantity();
    error PaymentFailed();
    error ZeroAddress();
    error InsufficientPayment();
    error NoProfitToWithdraw();
    error ArrayLengthMismatch();
    error PayoutsExceedJackpot();
    error TooManyRecipients();
    error InvalidCommitHash();
    error ClanktonTokenNotSet();
    error BonusWordAlreadyClaimed();
    error InvalidBonusWordIndex();
    error InsufficientClanktonBalance();
    error BonusWordsNotEnabled();
    error ClanktonTransferFailed();

    // ============ Modifiers ============

    /// @notice Restricts function to operator wallet only
    modifier onlyOperator() {
        if (msg.sender != operatorWallet) revert OnlyOperator();
        _;
    }

    /// @notice Ensures a round is currently active
    modifier roundActive() {
        if (currentRound == 0 || !rounds[currentRound].isActive) revert RoundNotActive();
        _;
    }

    // ============ Initialization ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the contract with wallet addresses
     * @param _operatorWallet Address authorized to resolve rounds
     * @param _creatorProfitWallet Address receiving creator profits
     * @param _prizePoolWallet Address used for seeding jackpots
     */
    function initialize(
        address _operatorWallet,
        address _creatorProfitWallet,
        address _prizePoolWallet
    ) external initializer {
        if (_operatorWallet == address(0)) revert ZeroAddress();
        if (_creatorProfitWallet == address(0)) revert ZeroAddress();
        if (_prizePoolWallet == address(0)) revert ZeroAddress();

        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        operatorWallet = _operatorWallet;
        creatorProfitWallet = _creatorProfitWallet;
        prizePoolWallet = _prizePoolWallet;
        currentRound = 0;
        currentJackpot = 0;
    }

    /**
     * @notice V2 initialization - called after upgrade to set new state
     * @dev Can only be called once, by owner
     */
    function initializeV2() external onlyOwner {
        // V2 state is initialized to defaults (false, 0, address(0))
        // This function exists for any one-time setup needed after upgrade
        bonusWordsEnabled = false; // Start disabled until CLANKTON is deposited
    }

    // ============ V2: CLANKTON Token Setup ============

    /**
     * @notice Sets the CLANKTON token contract address
     * @dev Only callable by owner. Must be set before bonus words can be distributed.
     * @param _clanktonToken Address of the CLANKTON ERC-20 token
     */
    function setClanktonToken(address _clanktonToken) external onlyOwner {
        if (_clanktonToken == address(0)) revert ZeroAddress();
        clanktonToken = IERC20(_clanktonToken);
        emit ClanktonTokenSet(_clanktonToken);
    }

    /**
     * @notice Enables or disables the bonus words feature
     * @dev Only callable by owner. Requires CLANKTON token to be set first.
     * @param _enabled Whether bonus words should be enabled
     */
    function setBonusWordsEnabled(bool _enabled) external onlyOwner {
        if (_enabled && address(clanktonToken) == address(0)) revert ClanktonTokenNotSet();
        bonusWordsEnabled = _enabled;
        emit BonusWordsToggled(_enabled);
    }

    // ============ V2: Round Start with Bonus Words ============

    /**
     * @notice Starts a new round with commitments for both secret word and bonus words
     * @dev Single transaction for both commitments. Provably fair for both.
     * @param _secretWordCommitHash SHA-256 hash of (salt || secretWord)
     * @param _bonusWordsCommitHash SHA-256 hash of (salt || word1 || salt1 || word2 || salt2 || ...)
     *
     * Commitment scheme:
     * 1. Backend generates master salt + selects secret word + selects 10 bonus words
     * 2. Backend computes both commitment hashes
     * 3. Backend calls this function (both hashes stored immutably onchain)
     * 4. Round plays out - players make guesses
     * 5. When bonus word is guessed, backend reveals it and distributes CLANKTON
     * 6. When round resolves, backend reveals all words
     * 7. Anyone can verify both commitments match the revealed words
     */
    function startRoundWithCommitments(
        bytes32 _secretWordCommitHash,
        bytes32 _bonusWordsCommitHash
    ) external onlyOperator {
        if (currentRound > 0 && rounds[currentRound].isActive) revert RoundAlreadyActive();
        if (currentJackpot < MINIMUM_SEED) revert InsufficientSeed();
        if (_secretWordCommitHash == bytes32(0)) revert InvalidCommitHash();
        if (_bonusWordsCommitHash == bytes32(0)) revert InvalidCommitHash();

        // Start the round with secret word commitment
        _startNewRound(_secretWordCommitHash);

        // Store bonus words commitment for this round
        bonusWordsCommitHashes[currentRound] = _bonusWordsCommitHash;

        emit RoundStartedWithBonusWords(
            currentRound,
            currentJackpot,
            _secretWordCommitHash,
            _bonusWordsCommitHash,
            block.timestamp
        );
    }

    // ============ V2: Bonus Word CLANKTON Distribution ============

    /**
     * @notice Distributes CLANKTON reward for a bonus word winner
     * @dev Only callable by operator when a player guesses a bonus word
     * @param recipient Wallet address of the player who found the bonus word
     * @param bonusWordIndex Index of the bonus word (0-9)
     *
     * Requirements:
     * - Bonus words feature must be enabled
     * - CLANKTON token must be set
     * - Contract must have sufficient CLANKTON balance
     * - Bonus word at this index must not already be claimed this round
     */
    function distributeBonusWordReward(
        address recipient,
        uint256 bonusWordIndex
    ) external onlyOperator nonReentrant roundActive {
        if (!bonusWordsEnabled) revert BonusWordsNotEnabled();
        if (address(clanktonToken) == address(0)) revert ClanktonTokenNotSet();
        if (recipient == address(0)) revert ZeroAddress();
        if (bonusWordIndex >= BONUS_WORDS_PER_ROUND) revert InvalidBonusWordIndex();
        if (bonusWordsClaimed[currentRound][bonusWordIndex]) revert BonusWordAlreadyClaimed();

        // Check contract has enough CLANKTON
        uint256 balance = clanktonToken.balanceOf(address(this));
        if (balance < BONUS_WORD_REWARD) revert InsufficientClanktonBalance();

        // Mark as claimed before transfer (CEI pattern)
        bonusWordsClaimed[currentRound][bonusWordIndex] = true;
        totalClanktonDistributed += BONUS_WORD_REWARD;

        // Transfer CLANKTON to winner
        bool success = clanktonToken.transfer(recipient, BONUS_WORD_REWARD);
        if (!success) revert ClanktonTransferFailed();

        emit BonusWordRewardDistributed(
            currentRound,
            recipient,
            bonusWordIndex,
            BONUS_WORD_REWARD
        );
    }

    // ============ V2: View Functions ============

    /**
     * @notice Get the bonus words commitment hash for a round
     * @param _roundNumber The round number to query
     * @return The bonus words commitment hash (bytes32(0) if not set)
     */
    function getBonusWordsCommitHash(uint256 _roundNumber) external view returns (bytes32) {
        return bonusWordsCommitHashes[_roundNumber];
    }

    /**
     * @notice Check if a bonus word has been claimed for a round
     * @param _roundNumber The round number to query
     * @param _bonusWordIndex The bonus word index (0-9)
     * @return True if claimed, false otherwise
     */
    function isBonusWordClaimed(uint256 _roundNumber, uint256 _bonusWordIndex) external view returns (bool) {
        return bonusWordsClaimed[_roundNumber][_bonusWordIndex];
    }

    /**
     * @notice Get the number of unclaimed bonus words for current round
     * @return Number of bonus words still available (0-10)
     */
    function getUnclaimedBonusWordsCount() external view returns (uint256) {
        uint256 claimed = 0;
        for (uint256 i = 0; i < BONUS_WORDS_PER_ROUND; i++) {
            if (bonusWordsClaimed[currentRound][i]) {
                claimed++;
            }
        }
        return BONUS_WORDS_PER_ROUND - claimed;
    }

    /**
     * @notice Get the contract's CLANKTON balance available for rewards
     * @return Current CLANKTON balance
     */
    function getClanktonBalance() external view returns (uint256) {
        if (address(clanktonToken) == address(0)) return 0;
        return clanktonToken.balanceOf(address(this));
    }

    /**
     * @notice Get the number of rounds worth of CLANKTON rewards available
     * @return Number of full rounds (10 bonus words each) that can be funded
     */
    function getClanktonRoundsAvailable() external view returns (uint256) {
        if (address(clanktonToken) == address(0)) return 0;
        uint256 balance = clanktonToken.balanceOf(address(this));
        uint256 perRound = BONUS_WORD_REWARD * BONUS_WORDS_PER_ROUND;
        return balance / perRound;
    }

    // ============ Operator Functions (V1 - unchanged) ============

    /**
     * @notice Seeds the jackpot for a new or existing round
     * @dev Only callable by operator. If no round is active, starts a new round WITHOUT commitment.
     * @dev For provably fair rounds, use seedJackpot first then startRoundWithCommitment separately.
     */
    function seedJackpot() external payable onlyOperator {
        if (msg.value == 0) revert InsufficientPayment();

        currentJackpot += msg.value;

        // If no active round, start one if we meet minimum seed (legacy mode without commitment)
        if (currentRound == 0 || !rounds[currentRound].isActive) {
            if (currentJackpot >= MINIMUM_SEED) {
                _startNewRound(bytes32(0));
            }
        }

        emit JackpotSeeded(
            currentRound,
            msg.sender,
            msg.value,
            currentJackpot
        );
    }

    /**
     * @notice Resolves the current round and pays the winner
     * @dev Only callable by operator. Winner address must be provided by backend.
     * @param winner The wallet address to receive the jackpot payout
     */
    function resolveRound(address winner) external onlyOperator nonReentrant roundActive {
        if (winner == address(0)) revert InvalidWinnerAddress();

        Round storage round = rounds[currentRound];

        // Store final jackpot
        uint256 jackpotAmount = currentJackpot;
        round.finalJackpot = jackpotAmount;
        round.winner = winner;
        round.resolvedAt = block.timestamp;
        round.isActive = false;

        round.winnerPayout = jackpotAmount;

        // Reset jackpot for next round
        currentJackpot = 0;

        // Pay the winner
        (bool success, ) = winner.call{value: jackpotAmount}("");
        if (!success) revert PaymentFailed();

        emit RoundResolved(
            currentRound,
            winner,
            jackpotAmount,
            jackpotAmount,
            block.timestamp
        );
    }

    /**
     * @notice Resolves the current round with multiple payouts (Milestone 6.9)
     * @dev Only callable by operator. Backend calculates all payout amounts.
     * @param recipients Array of recipient wallet addresses (winner first, then others)
     * @param amounts Array of amounts to pay each recipient (in wei)
     * @param seedForNextRound Amount to keep as seed for next round (in wei)
     */
    function resolveRoundWithPayouts(
        address[] calldata recipients,
        uint256[] calldata amounts,
        uint256 seedForNextRound
    ) external onlyOperator nonReentrant roundActive {
        // Validate arrays match
        if (recipients.length != amounts.length) revert ArrayLengthMismatch();
        if (recipients.length > 20) revert TooManyRecipients();
        if (recipients.length == 0) revert InvalidWinnerAddress();

        // First recipient is always the winner
        address winner = recipients[0];
        if (winner == address(0)) revert InvalidWinnerAddress();

        Round storage round = rounds[currentRound];
        uint256 jackpotAmount = currentJackpot;

        // Calculate total payout and validate
        uint256 totalPayout = seedForNextRound;
        for (uint256 i = 0; i < amounts.length; i++) {
            totalPayout += amounts[i];
        }
        if (totalPayout > jackpotAmount) revert PayoutsExceedJackpot();

        // Update round state before transfers (CEI pattern)
        round.finalJackpot = jackpotAmount;
        round.winner = winner;
        round.winnerPayout = amounts[0]; // Winner's payout (80%)
        round.resolvedAt = block.timestamp;
        round.isActive = false;

        // Set seed for next round
        currentJackpot = seedForNextRound;

        // Execute all payouts
        uint256 actualPaidOut = 0;
        for (uint256 i = 0; i < recipients.length; i++) {
            if (recipients[i] != address(0) && amounts[i] > 0) {
                (bool success, ) = recipients[i].call{value: amounts[i]}("");
                if (!success) revert PaymentFailed();
                actualPaidOut += amounts[i];

                emit PayoutSent(
                    currentRound,
                    recipients[i],
                    amounts[i],
                    i
                );
            }
        }

        emit RoundResolvedWithPayouts(
            currentRound,
            winner,
            jackpotAmount,
            actualPaidOut,
            seedForNextRound,
            recipients.length,
            block.timestamp
        );
    }

    /**
     * @notice Starts a new round after the previous one is resolved
     * @dev DEPRECATED: Use startRoundWithCommitment or startRoundWithCommitments
     */
    function startNextRound() external onlyOperator {
        if (currentRound > 0 && rounds[currentRound].isActive) revert RoundAlreadyActive();
        if (currentJackpot < MINIMUM_SEED) revert InsufficientSeed();

        _startNewRound(bytes32(0));
    }

    /**
     * @notice Starts a new round with onchain commitment for provably fair verification
     * @dev Use startRoundWithCommitments if bonus words are enabled
     * @param _commitHash SHA-256 hash of (salt || answer)
     */
    function startRoundWithCommitment(bytes32 _commitHash) external onlyOperator {
        if (currentRound > 0 && rounds[currentRound].isActive) revert RoundAlreadyActive();
        if (currentJackpot < MINIMUM_SEED) revert InsufficientSeed();
        if (_commitHash == bytes32(0)) revert InvalidCommitHash();

        _startNewRound(_commitHash);
    }

    // ============ Player Functions ============

    /**
     * @notice Purchase guess packs for a player
     * @dev ETH split: 80% to jackpot, 20% to creator
     * @param player The wallet address of the player
     * @param quantity Number of guesses being purchased
     */
    function purchaseGuesses(
        address player,
        uint256 quantity
    ) external payable roundActive nonReentrant {
        if (player == address(0)) revert InvalidWinnerAddress();
        if (quantity == 0) revert InvalidQuantity();
        if (msg.value == 0) revert InsufficientPayment();

        // Calculate split
        uint256 toJackpot = (msg.value * JACKPOT_SHARE_BPS) / BPS_DENOMINATOR;
        uint256 toCreator = msg.value - toJackpot;

        // Add to jackpot
        currentJackpot += toJackpot;

        // Accumulate creator profit
        creatorProfitAccumulated += toCreator;

        // Track player guesses this round
        playerGuessesThisRound[player] += quantity;

        emit GuessesPurchased(
            currentRound,
            player,
            quantity,
            msg.value,
            toJackpot,
            toCreator
        );
    }

    // ============ Withdrawal Functions ============

    /**
     * @notice Withdraw accumulated creator profits
     */
    function withdrawCreatorProfit() external nonReentrant {
        if (creatorProfitAccumulated == 0) revert NoProfitToWithdraw();

        uint256 amount = creatorProfitAccumulated;
        creatorProfitAccumulated = 0;

        (bool success, ) = creatorProfitWallet.call{value: amount}("");
        if (!success) revert PaymentFailed();

        emit CreatorProfitPaid(creatorProfitWallet, amount);
    }

    /**
     * @notice Emergency withdraw CLANKTON tokens (owner only)
     * @dev For recovering tokens if needed. Does not affect ongoing round claims.
     * @param amount Amount of CLANKTON to withdraw
     * @param to Address to send tokens to
     */
    function emergencyWithdrawClankton(uint256 amount, address to) external onlyOwner {
        if (address(clanktonToken) == address(0)) revert ClanktonTokenNotSet();
        if (to == address(0)) revert ZeroAddress();

        bool success = clanktonToken.transfer(to, amount);
        if (!success) revert ClanktonTransferFailed();
    }

    // ============ Admin Functions ============

    /**
     * @notice Updates the operator wallet address
     * @param newOperator New operator wallet address
     */
    function setOperatorWallet(address newOperator) external onlyOwner {
        if (newOperator == address(0)) revert ZeroAddress();

        address oldOperator = operatorWallet;
        operatorWallet = newOperator;

        emit OperatorWalletUpdated(oldOperator, newOperator);
    }

    /**
     * @notice Updates the creator profit wallet address
     * @param newWallet New creator profit wallet address
     */
    function setCreatorProfitWallet(address newWallet) external onlyOwner {
        if (newWallet == address(0)) revert ZeroAddress();

        address oldWallet = creatorProfitWallet;
        creatorProfitWallet = newWallet;

        emit CreatorProfitWalletUpdated(oldWallet, newWallet);
    }

    /**
     * @notice Updates the prize pool wallet address
     * @param newWallet New prize pool wallet address
     */
    function setPrizePoolWallet(address newWallet) external onlyOwner {
        if (newWallet == address(0)) revert ZeroAddress();

        address oldWallet = prizePoolWallet;
        prizePoolWallet = newWallet;

        emit PrizePoolWalletUpdated(oldWallet, newWallet);
    }

    // ============ View Functions ============

    /**
     * @notice Get current round information
     */
    function getCurrentRoundInfo() external view returns (
        uint256 roundNumber,
        uint256 jackpot,
        bool isActive,
        uint256 startedAt
    ) {
        Round storage round = rounds[currentRound];
        return (
            currentRound,
            currentJackpot,
            round.isActive,
            round.startedAt
        );
    }

    /**
     * @notice Get historical round information
     * @param roundNumber The round number to query
     */
    function getRound(uint256 roundNumber) external view returns (Round memory) {
        return rounds[roundNumber];
    }

    /**
     * @notice Get player's guess count for current round
     * @param player Player wallet address
     */
    function getPlayerGuessCount(address player) external view returns (uint256) {
        return playerGuessesThisRound[player];
    }

    /**
     * @notice Check if minimum seed requirement is met
     */
    function isMinimumSeedMet() external view returns (bool) {
        return currentJackpot >= MINIMUM_SEED;
    }

    /**
     * @notice Get the onchain commitment hash for a round
     * @param _roundNumber The round number to query
     */
    function getCommitHash(uint256 _roundNumber) external view returns (bytes32) {
        return rounds[_roundNumber].commitHash;
    }

    /**
     * @notice Check if a round has an onchain commitment
     * @param _roundNumber The round number to query
     */
    function hasOnChainCommitment(uint256 _roundNumber) external view returns (bool) {
        return rounds[_roundNumber].commitHash != bytes32(0);
    }

    // ============ Oracle Functions (Milestone 6.2) ============

    /**
     * @notice Updates the CLANKTON market cap from oracle
     * @param marketCapUsd The market cap in USD (with 8 decimals)
     */
    function updateClanktonMarketCap(uint256 marketCapUsd) external onlyOperator {
        clanktonMarketCapUsd = marketCapUsd;
        lastMarketCapUpdate = block.timestamp;

        emit MarketCapUpdated(marketCapUsd, block.timestamp);
    }

    /**
     * @notice Gets the current bonus tier based on CLANKTON market cap
     */
    function getCurrentBonusTier() external view returns (BonusTier) {
        if (clanktonMarketCapUsd >= MARKET_CAP_TIER_THRESHOLD) {
            return BonusTier.HIGH;
        }
        return BonusTier.LOW;
    }

    /**
     * @notice Gets the number of free guesses for CLANKTON holders based on current tier
     */
    function getFreeGuessesForTier() external view returns (uint256) {
        if (clanktonMarketCapUsd >= MARKET_CAP_TIER_THRESHOLD) {
            return 3;
        }
        return 2;
    }

    /**
     * @notice Checks if the market cap data is stale
     */
    function isMarketCapStale() external view returns (bool) {
        if (lastMarketCapUpdate == 0) {
            return true;
        }
        return block.timestamp > lastMarketCapUpdate + MARKET_CAP_STALENESS_THRESHOLD;
    }

    /**
     * @notice Gets the full market cap info
     */
    function getMarketCapInfo() external view returns (
        uint256 marketCap,
        uint256 lastUpdate,
        bool isStale,
        BonusTier tier
    ) {
        bool stale = lastMarketCapUpdate == 0 ||
                     block.timestamp > lastMarketCapUpdate + MARKET_CAP_STALENESS_THRESHOLD;
        BonusTier currentTier = clanktonMarketCapUsd >= MARKET_CAP_TIER_THRESHOLD
                                ? BonusTier.HIGH
                                : BonusTier.LOW;
        return (clanktonMarketCapUsd, lastMarketCapUpdate, stale, currentTier);
    }

    // ============ Internal Functions ============

    /**
     * @notice Internal function to start a new round
     * @param _commitHash SHA-256 commitment hash
     */
    function _startNewRound(bytes32 _commitHash) internal {
        currentRound++;

        rounds[currentRound] = Round({
            roundNumber: currentRound,
            startingJackpot: currentJackpot,
            finalJackpot: 0,
            winner: address(0),
            winnerPayout: 0,
            startedAt: block.timestamp,
            resolvedAt: 0,
            isActive: true,
            commitHash: _commitHash
        });

        // Emit appropriate event based on whether commitment was provided
        if (_commitHash != bytes32(0)) {
            emit RoundStartedWithCommitment(currentRound, currentJackpot, _commitHash, block.timestamp);
        } else {
            emit RoundStarted(currentRound, currentJackpot, block.timestamp);
        }
    }

    /**
     * @notice Authorization for UUPS upgrades
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // ============ Receive ETH ============

    /**
     * @notice Allows contract to receive ETH directly (goes to jackpot)
     */
    receive() external payable {
        // Only add to jackpot if from prize pool wallet
        if (msg.sender == prizePoolWallet || msg.sender == operatorWallet) {
            currentJackpot += msg.value;
            emit JackpotSeeded(currentRound, msg.sender, msg.value, currentJackpot);
        }
    }
}

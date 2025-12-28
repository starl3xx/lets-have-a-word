// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title JackpotManagerFull
 * @notice Full-featured JackpotManager as a single non-upgradeable contract
 * @dev For Sepolia testnet deployment - includes all mainnet features
 *
 * Deploy via Remix:
 * 1. Compile with Solidity 0.8.24
 * 2. Deploy with constructor args:
 *    - _operator: 0xaee1ee60F8534CbFBbe856fEb9655D0c4ed35d38
 *    - _creatorProfit: 0x3Cee630075DC586D5BFdFA81F3a2d77980F0d223
 *    - _prizePool: 0xFd9716B26f3070Bc60AC409Aba13Dca2798771fB
 *
 * Features:
 * - resolveRound(winner) - simple 100% payout
 * - resolveRoundWithPayouts(recipients[], amounts[], seed) - multi-payout
 * - startNextRound() - start round with existing balance
 * - startRoundWithCommitment(hash) - provably fair round start
 * - Market cap oracle for CLANKTON bonus tiers
 */
contract JackpotManagerFull {
    // ============ Constants ============

    uint256 public constant MINIMUM_SEED = 0.03 ether;
    uint256 public constant JACKPOT_SHARE_BPS = 8000;  // 80%
    uint256 public constant CREATOR_SHARE_BPS = 2000;  // 20%
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant MARKET_CAP_TIER_THRESHOLD = 250_000 * 1e8;
    uint256 public constant MARKET_CAP_STALENESS_THRESHOLD = 1 hours;

    // ============ Enums ============

    enum BonusTier { LOW, HIGH }

    // ============ State Variables ============

    address public owner;
    address public operatorWallet;
    address public creatorProfitWallet;
    address public prizePoolWallet;

    uint256 public currentRound;
    uint256 public currentJackpot;
    uint256 public creatorProfitAccumulated;

    mapping(uint256 => Round) public rounds;
    mapping(address => uint256) public playerGuessesThisRound;

    uint256 public clanktonMarketCapUsd;
    uint256 public lastMarketCapUpdate;

    bool private _locked;

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
        bytes32 commitHash;
    }

    // ============ Events ============

    event RoundStarted(uint256 indexed roundNumber, uint256 startingJackpot, uint256 timestamp);
    event RoundStartedWithCommitment(uint256 indexed roundNumber, uint256 startingJackpot, bytes32 indexed commitHash, uint256 timestamp);
    event RoundResolved(uint256 indexed roundNumber, address indexed winner, uint256 jackpotAmount, uint256 winnerPayout, uint256 timestamp);
    event RoundResolvedWithPayouts(uint256 indexed roundNumber, address indexed winner, uint256 jackpotAmount, uint256 totalPaidOut, uint256 seedForNextRound, uint256 recipientCount, uint256 timestamp);
    event PayoutSent(uint256 indexed roundNumber, address indexed recipient, uint256 amount, uint256 index);
    event JackpotSeeded(uint256 indexed roundNumber, address indexed seeder, uint256 amount, uint256 newJackpot);
    event GuessesPurchased(uint256 indexed roundNumber, address indexed player, uint256 quantity, uint256 ethAmount, uint256 toJackpot, uint256 toCreator);
    event CreatorProfitPaid(address indexed recipient, uint256 amount);
    event OperatorWalletUpdated(address indexed oldOperator, address indexed newOperator);
    event CreatorProfitWalletUpdated(address indexed oldWallet, address indexed newWallet);
    event PrizePoolWalletUpdated(address indexed oldWallet, address indexed newWallet);
    event MarketCapUpdated(uint256 marketCapUsd, uint256 timestamp);

    // ============ Errors ============

    error OnlyOwner();
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
    error ReentrancyGuard();

    // ============ Modifiers ============

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier onlyOperator() {
        if (msg.sender != operatorWallet) revert OnlyOperator();
        _;
    }

    modifier onlyAuthorized() {
        require(
            msg.sender == operatorWallet || msg.sender == prizePoolWallet,
            "Not authorized"
        );
        _;
    }

    modifier roundActive() {
        if (currentRound == 0 || !rounds[currentRound].isActive) revert RoundNotActive();
        _;
    }

    modifier nonReentrant() {
        if (_locked) revert ReentrancyGuard();
        _locked = true;
        _;
        _locked = false;
    }

    // ============ Constructor ============

    constructor(
        address _operator,
        address _creatorProfit,
        address _prizePool
    ) {
        if (_operator == address(0)) revert ZeroAddress();
        if (_creatorProfit == address(0)) revert ZeroAddress();
        if (_prizePool == address(0)) revert ZeroAddress();

        owner = msg.sender;
        operatorWallet = _operator;
        creatorProfitWallet = _creatorProfit;
        prizePoolWallet = _prizePool;
    }

    // ============ Operator Functions ============

    function seedJackpot() external payable onlyAuthorized {
        if (msg.value == 0) revert InsufficientPayment();

        currentJackpot += msg.value;

        // If no active round, start one if we meet minimum seed (legacy mode without commitment)
        if (currentRound == 0 || !rounds[currentRound].isActive) {
            if (currentJackpot >= MINIMUM_SEED) {
                _startNewRound(bytes32(0));
            }
        }

        emit JackpotSeeded(currentRound, msg.sender, msg.value, currentJackpot);
    }

    function resolveRound(address winner) external onlyOperator nonReentrant roundActive {
        if (winner == address(0)) revert InvalidWinnerAddress();

        Round storage round = rounds[currentRound];
        uint256 jackpotAmount = currentJackpot;

        round.finalJackpot = jackpotAmount;
        round.winner = winner;
        round.winnerPayout = jackpotAmount;
        round.resolvedAt = block.timestamp;
        round.isActive = false;

        currentJackpot = 0;

        (bool success, ) = winner.call{value: jackpotAmount}("");
        if (!success) revert PaymentFailed();

        emit RoundResolved(currentRound, winner, jackpotAmount, jackpotAmount, block.timestamp);
    }

    function resolveRoundWithPayouts(
        address[] calldata recipients,
        uint256[] calldata amounts,
        uint256 seedForNextRound
    ) external onlyOperator nonReentrant roundActive {
        if (recipients.length != amounts.length) revert ArrayLengthMismatch();
        if (recipients.length > 20) revert TooManyRecipients();
        if (recipients.length == 0) revert InvalidWinnerAddress();

        address winner = recipients[0];
        if (winner == address(0)) revert InvalidWinnerAddress();

        Round storage round = rounds[currentRound];
        uint256 jackpotAmount = currentJackpot;

        // Calculate and validate total
        uint256 totalPayout = seedForNextRound;
        for (uint256 i = 0; i < amounts.length; i++) {
            totalPayout += amounts[i];
        }
        if (totalPayout > jackpotAmount) revert PayoutsExceedJackpot();

        // Update state before transfers (CEI pattern)
        round.finalJackpot = jackpotAmount;
        round.winner = winner;
        round.winnerPayout = amounts[0];
        round.resolvedAt = block.timestamp;
        round.isActive = false;

        currentJackpot = seedForNextRound;

        // Execute payouts
        uint256 actualPaidOut = 0;
        for (uint256 i = 0; i < recipients.length; i++) {
            if (recipients[i] != address(0) && amounts[i] > 0) {
                (bool success, ) = recipients[i].call{value: amounts[i]}("");
                if (!success) revert PaymentFailed();
                actualPaidOut += amounts[i];

                emit PayoutSent(currentRound, recipients[i], amounts[i], i);
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

    function startNextRound() external onlyOperator {
        if (currentRound > 0 && rounds[currentRound].isActive) revert RoundAlreadyActive();
        if (currentJackpot < MINIMUM_SEED) revert InsufficientSeed();

        _startNewRound(bytes32(0));
    }

    function startRoundWithCommitment(bytes32 _commitHash) external onlyOperator {
        if (currentRound > 0 && rounds[currentRound].isActive) revert RoundAlreadyActive();
        if (currentJackpot < MINIMUM_SEED) revert InsufficientSeed();
        if (_commitHash == bytes32(0)) revert InvalidCommitHash();

        _startNewRound(_commitHash);
    }

    // ============ Player Functions ============

    function purchaseGuesses(
        address player,
        uint256 quantity
    ) external payable roundActive nonReentrant {
        if (player == address(0)) revert InvalidWinnerAddress();
        if (quantity == 0) revert InvalidQuantity();
        if (msg.value == 0) revert InsufficientPayment();

        uint256 toJackpot = (msg.value * JACKPOT_SHARE_BPS) / BPS_DENOMINATOR;
        uint256 toCreator = msg.value - toJackpot;

        currentJackpot += toJackpot;
        creatorProfitAccumulated += toCreator;
        playerGuessesThisRound[player] += quantity;

        emit GuessesPurchased(currentRound, player, quantity, msg.value, toJackpot, toCreator);
    }

    // ============ Withdrawal Functions ============

    function withdrawCreatorProfit() external nonReentrant {
        if (creatorProfitAccumulated == 0) revert NoProfitToWithdraw();

        uint256 amount = creatorProfitAccumulated;
        creatorProfitAccumulated = 0;

        (bool success, ) = creatorProfitWallet.call{value: amount}("");
        if (!success) revert PaymentFailed();

        emit CreatorProfitPaid(creatorProfitWallet, amount);
    }

    // ============ Admin Functions ============

    function setOperatorWallet(address newOperator) external onlyOwner {
        if (newOperator == address(0)) revert ZeroAddress();
        address oldOperator = operatorWallet;
        operatorWallet = newOperator;
        emit OperatorWalletUpdated(oldOperator, newOperator);
    }

    function setCreatorProfitWallet(address newWallet) external onlyOwner {
        if (newWallet == address(0)) revert ZeroAddress();
        address oldWallet = creatorProfitWallet;
        creatorProfitWallet = newWallet;
        emit CreatorProfitWalletUpdated(oldWallet, newWallet);
    }

    function setPrizePoolWallet(address newWallet) external onlyOwner {
        if (newWallet == address(0)) revert ZeroAddress();
        address oldWallet = prizePoolWallet;
        prizePoolWallet = newWallet;
        emit PrizePoolWalletUpdated(oldWallet, newWallet);
    }

    // ============ View Functions ============

    function getCurrentRoundInfo() external view returns (
        uint256 roundNumber,
        uint256 jackpot,
        bool isActive,
        uint256 startedAt
    ) {
        Round storage round = rounds[currentRound];
        return (currentRound, currentJackpot, round.isActive, round.startedAt);
    }

    function getRound(uint256 roundNumber) external view returns (Round memory) {
        return rounds[roundNumber];
    }

    function getPlayerGuessCount(address player) external view returns (uint256) {
        return playerGuessesThisRound[player];
    }

    function isMinimumSeedMet() external view returns (bool) {
        return currentJackpot >= MINIMUM_SEED;
    }

    function getCommitHash(uint256 _roundNumber) external view returns (bytes32) {
        return rounds[_roundNumber].commitHash;
    }

    function hasOnChainCommitment(uint256 _roundNumber) external view returns (bool) {
        return rounds[_roundNumber].commitHash != bytes32(0);
    }

    // ============ Oracle Functions ============

    function updateClanktonMarketCap(uint256 marketCapUsd) external onlyOperator {
        clanktonMarketCapUsd = marketCapUsd;
        lastMarketCapUpdate = block.timestamp;
        emit MarketCapUpdated(marketCapUsd, block.timestamp);
    }

    function getCurrentBonusTier() external view returns (BonusTier) {
        return clanktonMarketCapUsd >= MARKET_CAP_TIER_THRESHOLD ? BonusTier.HIGH : BonusTier.LOW;
    }

    function getFreeGuessesForTier() external view returns (uint256) {
        return clanktonMarketCapUsd >= MARKET_CAP_TIER_THRESHOLD ? 3 : 2;
    }

    function isMarketCapStale() external view returns (bool) {
        if (lastMarketCapUpdate == 0) return true;
        return block.timestamp > lastMarketCapUpdate + MARKET_CAP_STALENESS_THRESHOLD;
    }

    function getMarketCapInfo() external view returns (
        uint256 marketCap,
        uint256 lastUpdate,
        bool isStale,
        BonusTier tier
    ) {
        bool stale = lastMarketCapUpdate == 0 ||
                     block.timestamp > lastMarketCapUpdate + MARKET_CAP_STALENESS_THRESHOLD;
        BonusTier currentTier = clanktonMarketCapUsd >= MARKET_CAP_TIER_THRESHOLD
                                ? BonusTier.HIGH : BonusTier.LOW;
        return (clanktonMarketCapUsd, lastMarketCapUpdate, stale, currentTier);
    }

    // ============ Internal Functions ============

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

        if (_commitHash != bytes32(0)) {
            emit RoundStartedWithCommitment(currentRound, currentJackpot, _commitHash, block.timestamp);
        } else {
            emit RoundStarted(currentRound, currentJackpot, block.timestamp);
        }
    }

    // ============ Receive ETH ============

    receive() external payable {
        if (msg.sender == prizePoolWallet || msg.sender == operatorWallet) {
            currentJackpot += msg.value;
            emit JackpotSeeded(currentRound, msg.sender, msg.value, currentJackpot);
        }
    }
}

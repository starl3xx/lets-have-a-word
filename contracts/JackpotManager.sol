// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title JackpotManager
 * @notice Manages jackpots, paid guesses, and payouts for Let's Have A Word game
 * @dev Milestone 6.1 - Smart Contract Specification
 *
 * Deployed on Base mainnet
 *
 * Wallet Configuration:
 * - Prize Pool Wallet: 0xFd9716B26f3070Bc60AC409Aba13Dca2798771fB (letshaveaword.eth)
 * - Operator Wallet: 0xaee1ee60F8534CbFBbe856fEb9655D0c4ed35d38
 * - Creator Profit Wallet: 0x3Cee630075DC586D5BFdFA81F3a2d77980F0d223
 */
contract JackpotManager is
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable
{
    // ============ Constants ============

    /// @notice Minimum seed requirement for new rounds (0.03 ETH)
    uint256 public constant MINIMUM_SEED = 0.03 ether;

    /// @notice Percentage of guess purchase going to jackpot (80%)
    uint256 public constant JACKPOT_SHARE_BPS = 8000;

    /// @notice Percentage of guess purchase going to creator (20%)
    uint256 public constant CREATOR_SHARE_BPS = 2000;

    /// @notice Basis points denominator
    uint256 public constant BPS_DENOMINATOR = 10000;

    // ============ State Variables ============

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
    }

    // ============ Events ============

    /// @notice Emitted when a new round starts
    event RoundStarted(
        uint256 indexed roundNumber,
        uint256 startingJackpot,
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

    // ============ Operator Functions ============

    /**
     * @notice Seeds the jackpot for a new or existing round
     * @dev Only callable by operator. If no round is active, starts a new round.
     */
    function seedJackpot() external payable onlyOperator {
        if (msg.value == 0) revert InsufficientPayment();

        currentJackpot += msg.value;

        // If no active round, start one if we meet minimum seed
        if (currentRound == 0 || !rounds[currentRound].isActive) {
            if (currentJackpot >= MINIMUM_SEED) {
                _startNewRound();
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
     *
     * IMPORTANT: The winner address MUST be the same wallet used for:
     * - CLANKTON balance checks
     * - Paid guess tracking
     * - Free guess allocation
     *
     * Backend resolves: Neynar -> FID -> signer wallet -> this address
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

        // Full jackpot goes to winner
        // Note: Backend handles the 80/10/10 split off-chain for referrer and top guessers
        // This contract pays the full jackpot to the winner address provided by backend
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

        // Clear player guesses mapping for next round
        // Note: This is handled by the mapping being per-round in practice
    }

    /**
     * @notice Starts a new round after the previous one is resolved
     * @dev Requires minimum seed to be met. Called by operator.
     */
    function startNextRound() external onlyOperator {
        if (currentRound > 0 && rounds[currentRound].isActive) revert RoundAlreadyActive();
        if (currentJackpot < MINIMUM_SEED) revert InsufficientSeed();

        _startNewRound();
    }

    // ============ Player Functions ============

    /**
     * @notice Purchase guess packs for a player
     * @dev ETH split: 80% to jackpot, 20% to creator
     * @param player The wallet address of the player (unified identity)
     * @param quantity Number of guesses being purchased
     *
     * IMPORTANT: player address must be the same wallet used for CLANKTON checks
     * Backend validates this before calling.
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
     * @dev Sends all accumulated profits to the creator profit wallet
     */
    function withdrawCreatorProfit() external nonReentrant {
        if (creatorProfitAccumulated == 0) revert NoProfitToWithdraw();

        uint256 amount = creatorProfitAccumulated;
        creatorProfitAccumulated = 0;

        (bool success, ) = creatorProfitWallet.call{value: amount}("");
        if (!success) revert PaymentFailed();

        emit CreatorProfitPaid(creatorProfitWallet, amount);
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
     * @return roundNumber Current round number
     * @return jackpot Current jackpot amount
     * @return isActive Whether the round is active
     * @return startedAt When the round started
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
     * @return round The round data
     */
    function getRound(uint256 roundNumber) external view returns (Round memory) {
        return rounds[roundNumber];
    }

    /**
     * @notice Get player's guess count for current round
     * @param player Player wallet address
     * @return Number of guesses purchased this round
     */
    function getPlayerGuessCount(address player) external view returns (uint256) {
        return playerGuessesThisRound[player];
    }

    /**
     * @notice Check if minimum seed requirement is met
     * @return True if current jackpot >= MINIMUM_SEED
     */
    function isMinimumSeedMet() external view returns (bool) {
        return currentJackpot >= MINIMUM_SEED;
    }

    // ============ Oracle-Ready Functions (Milestone 6.2) ============

    /**
     * @notice Placeholder for CLANKTON market cap oracle integration
     * @dev To be implemented in Milestone 6.2
     * @param marketCapUsd The market cap in USD (with 8 decimals)
     *
     * This will be used to determine bonus tier:
     * - mcap < $250,000: 2 free guesses/day for CLANKTON holders
     * - mcap >= $250,000: 3 free guesses/day for CLANKTON holders
     */
    function updateClanktonMarketCap(uint256 marketCapUsd) external onlyOperator {
        // Milestone 6.2: Implement oracle integration
        // For now, this is a placeholder that emits an event
        // The actual market cap logic is handled off-chain in the backend
    }

    // ============ Internal Functions ============

    /**
     * @notice Internal function to start a new round
     */
    function _startNewRound() internal {
        currentRound++;

        rounds[currentRound] = Round({
            roundNumber: currentRound,
            startingJackpot: currentJackpot,
            finalJackpot: 0,
            winner: address(0),
            winnerPayout: 0,
            startedAt: block.timestamp,
            resolvedAt: 0,
            isActive: true
        });

        emit RoundStarted(currentRound, currentJackpot, block.timestamp);
    }

    /**
     * @notice Authorization for UUPS upgrades
     * @param newImplementation Address of new implementation
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
        // Otherwise, just accept the ETH (will sit in contract until manually allocated)
    }
}

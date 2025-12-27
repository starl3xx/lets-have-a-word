// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * JackpotManager Simple (Non-Upgradeable)
 * For testnet deployment only - simpler to deploy via Remix
 *
 * Deploy via Remix:
 * 1. Compile with Solidity 0.8.24
 * 2. Deploy with constructor args:
 *    - operator: 0xaee1ee60F8534CbFBbe856fEb9655D0c4ed35d38
 *    - creatorProfit: 0x3Cee630075DC586D5BFdFA81F3a2d77980F0d223
 *    - prizePool: 0xFd9716B26f3070Bc60AC409Aba13Dca2798771fB
 */
contract JackpotManagerSimple {
    // =============================================================================
    // Constants
    // =============================================================================

    uint256 public constant MINIMUM_SEED = 0.03 ether;
    uint256 public constant JACKPOT_SPLIT_PERCENTAGE = 80;
    uint256 public constant CREATOR_SPLIT_PERCENTAGE = 20;

    // =============================================================================
    // State Variables
    // =============================================================================

    address public owner;
    address public operatorWallet;
    address public creatorProfitWallet;
    address public prizePoolWallet;

    uint256 public currentRound;
    uint256 public currentJackpot;
    uint256 public creatorProfitAccumulated;

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

    mapping(uint256 => Round) public rounds;
    mapping(address => uint256) public playerGuessCount;

    // =============================================================================
    // Events
    // =============================================================================

    event RoundStarted(uint256 indexed roundNumber, uint256 startingJackpot, uint256 timestamp);
    event RoundStartedWithCommitment(uint256 indexed roundNumber, uint256 startingJackpot, bytes32 indexed commitHash, uint256 timestamp);
    event RoundResolved(uint256 indexed roundNumber, address indexed winner, uint256 jackpotAmount, uint256 winnerPayout, uint256 timestamp);
    event JackpotSeeded(uint256 indexed roundNumber, address indexed seeder, uint256 amount, uint256 newJackpot);
    event GuessesPurchased(uint256 indexed roundNumber, address indexed player, uint256 quantity, uint256 ethAmount, uint256 toJackpot, uint256 toCreator);
    event CreatorProfitPaid(address indexed recipient, uint256 amount);
    event MarketCapUpdated(uint256 marketCapUsd, uint256 timestamp);

    // =============================================================================
    // Modifiers
    // =============================================================================

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyOperator() {
        require(msg.sender == operatorWallet, "Only operator");
        _;
    }

    modifier onlyAuthorized() {
        require(
            msg.sender == operatorWallet || msg.sender == prizePoolWallet,
            "Not authorized"
        );
        _;
    }

    // =============================================================================
    // Constructor
    // =============================================================================

    constructor(
        address _operator,
        address _creatorProfit,
        address _prizePool
    ) {
        require(_operator != address(0), "Invalid operator");
        require(_creatorProfit != address(0), "Invalid creator profit");
        require(_prizePool != address(0), "Invalid prize pool");

        owner = msg.sender;
        operatorWallet = _operator;
        creatorProfitWallet = _creatorProfit;
        prizePoolWallet = _prizePool;
    }

    // =============================================================================
    // Core Functions
    // =============================================================================

    receive() external payable {
        currentJackpot += msg.value;
        emit JackpotSeeded(currentRound, msg.sender, msg.value, currentJackpot);
    }

    function seedJackpot() external payable onlyAuthorized {
        require(msg.value > 0, "Must send ETH");
        currentJackpot += msg.value;
        emit JackpotSeeded(currentRound, msg.sender, msg.value, currentJackpot);
    }

    function isMinimumSeedMet() public view returns (bool) {
        return currentJackpot >= MINIMUM_SEED;
    }

    function startRoundWithCommitment(bytes32 commitHash) external onlyOperator {
        require(currentJackpot >= MINIMUM_SEED, "Minimum seed not met");
        require(currentRound == 0 || !rounds[currentRound].isActive, "Round already active");

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
            commitHash: commitHash
        });

        emit RoundStartedWithCommitment(currentRound, currentJackpot, commitHash, block.timestamp);
    }

    function purchaseGuesses(address player, uint256 quantity) external payable {
        require(rounds[currentRound].isActive, "No active round");
        require(msg.value > 0, "Must send ETH");
        require(player != address(0), "Invalid player");

        uint256 toJackpot = (msg.value * JACKPOT_SPLIT_PERCENTAGE) / 100;
        uint256 toCreator = msg.value - toJackpot;

        currentJackpot += toJackpot;
        creatorProfitAccumulated += toCreator;
        playerGuessCount[player] += quantity;

        emit GuessesPurchased(currentRound, player, quantity, msg.value, toJackpot, toCreator);
    }

    function resolveRound(address winner) external onlyOperator {
        require(rounds[currentRound].isActive, "No active round");
        require(winner != address(0), "Invalid winner");

        Round storage round = rounds[currentRound];
        round.isActive = false;
        round.resolvedAt = block.timestamp;
        round.finalJackpot = currentJackpot;
        round.winner = winner;
        round.winnerPayout = currentJackpot;

        uint256 payout = currentJackpot;
        currentJackpot = 0;

        (bool success, ) = winner.call{value: payout}("");
        require(success, "Transfer failed");

        emit RoundResolved(currentRound, winner, round.finalJackpot, payout, block.timestamp);
    }

    function withdrawCreatorProfit() external {
        require(creatorProfitAccumulated > 0, "No profit to withdraw");

        uint256 amount = creatorProfitAccumulated;
        creatorProfitAccumulated = 0;

        (bool success, ) = creatorProfitWallet.call{value: amount}("");
        require(success, "Transfer failed");

        emit CreatorProfitPaid(creatorProfitWallet, amount);
    }

    // =============================================================================
    // View Functions
    // =============================================================================

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

    function getCommitHash(uint256 roundNumber) external view returns (bytes32) {
        return rounds[roundNumber].commitHash;
    }

    function hasOnChainCommitment(uint256 roundNumber) external view returns (bool) {
        return rounds[roundNumber].commitHash != bytes32(0);
    }

    // =============================================================================
    // Admin Functions
    // =============================================================================

    function updateOperatorWallet(address newOperator) external onlyOwner {
        require(newOperator != address(0), "Invalid address");
        operatorWallet = newOperator;
    }

    function updateCreatorProfitWallet(address newWallet) external onlyOwner {
        require(newWallet != address(0), "Invalid address");
        creatorProfitWallet = newWallet;
    }

    function updatePrizePoolWallet(address newWallet) external onlyOwner {
        require(newWallet != address(0), "Invalid address");
        prizePoolWallet = newWallet;
    }
}

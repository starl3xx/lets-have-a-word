// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title WordManagerV2
 * @notice Manages $WORD token game mechanics with onchain commitment verification
 * @dev Extends the original WordManager pattern with per-word hash commitments
 *      so bonus word rewards and burn word destruction are provably fair.
 *
 *      Access control:
 *      - Owner: can set operator, emergency withdraw
 *      - Operator: server-side key that commits rounds and executes claims
 *
 *      Commitment flow:
 *      1. Server selects 16 words (1 secret + 10 bonus + 5 burn)
 *      2. Server calls commitRound() with keccak256(abi.encodePacked(word, salt)) for each
 *      3. When a player finds a bonus/burn word, server calls claimBonusReward/claimBurnWord
 *         passing the plaintext word + salt for onchain verification
 *      4. Contract verifies hash matches before executing the token transfer/burn
 */
contract WordManagerV2 is Ownable {
    // =========================================================================
    // State
    // =========================================================================

    IERC20 public wordToken;

    /// @notice Operator address (server-side key for game operations)
    address public operator;

    struct RoundCommitment {
        bytes32 secretHash;
        bytes32[10] bonusWordHashes;
        bytes32[5] burnWordHashes;
        uint256 committedAt;
    }

    /// @notice Round commitments: roundId => RoundCommitment
    mapping(uint256 => RoundCommitment) public roundCommitments;

    /// @notice Track claimed bonus words: roundId => wordIndex => claimed
    mapping(uint256 => mapping(uint256 => bool)) public bonusWordClaimed;

    /// @notice Track claimed burn words: roundId => wordIndex => claimed
    mapping(uint256 => mapping(uint256 => bool)) public burnWordClaimed;

    /// @notice Total $WORD tokens burned across all rounds
    uint256 public totalBurned;

    /// @notice Total $WORD tokens distributed as bonus rewards
    uint256 public totalDistributed;

    // =========================================================================
    // Staking (preserved from WordManager V1)
    // =========================================================================

    struct StakeDeposit {
        uint256 amount;
        uint256 depositedAt;
    }

    mapping(address => StakeDeposit[]) public deposits;
    mapping(address => uint256) public stakedBalance;
    mapping(address => uint256) public unclaimedRewards;
    uint256 public totalStaked;

    // =========================================================================
    // Events
    // =========================================================================

    event RoundCommitted(
        uint256 indexed roundId,
        bytes32 secretHash,
        uint256 timestamp
    );

    event BonusRewardClaimed(
        uint256 indexed roundId,
        uint256 indexed wordIndex,
        address indexed player,
        uint256 amount
    );

    event BurnWordClaimed(
        uint256 indexed roundId,
        uint256 indexed wordIndex,
        uint256 amount
    );

    event OperatorUpdated(address indexed oldOperator, address indexed newOperator);

    // =========================================================================
    // Errors
    // =========================================================================

    error RoundAlreadyCommitted(uint256 roundId);
    error RoundNotCommitted(uint256 roundId);
    error BonusWordAlreadyClaimed(uint256 roundId, uint256 wordIndex);
    error BurnWordAlreadyClaimed(uint256 roundId, uint256 wordIndex);
    error InvalidWordIndex();
    error HashMismatch();
    error InsufficientBalance();
    error NotOperator();

    // =========================================================================
    // Modifiers
    // =========================================================================

    /// @notice Restrict to operator or owner
    modifier onlyOperator() {
        if (msg.sender != operator && msg.sender != owner()) {
            revert NotOperator();
        }
        _;
    }

    // =========================================================================
    // Constructor
    // =========================================================================

    constructor(address _wordToken, address _operator) Ownable(msg.sender) {
        wordToken = IERC20(_wordToken);
        operator = _operator;
        emit OperatorUpdated(address(0), _operator);
    }

    // =========================================================================
    // Admin
    // =========================================================================

    /**
     * @notice Update the operator address (owner only)
     * @param _operator New operator address
     */
    function setOperator(address _operator) external onlyOwner {
        address old = operator;
        operator = _operator;
        emit OperatorUpdated(old, _operator);
    }

    /**
     * @notice Emergency withdraw $WORD tokens (owner only)
     * @param to Recipient address
     * @param amount Amount to withdraw
     */
    function emergencyWithdraw(address to, uint256 amount) external onlyOwner {
        require(wordToken.transfer(to, amount), "Transfer failed");
    }

    // =========================================================================
    // Commitment
    // =========================================================================

    /**
     * @notice Commit all 16 word hashes for a round
     * @param roundId The round identifier
     * @param secretHash keccak256(abi.encodePacked(secretWord, salt))
     * @param bonusWordHashes 10 hashes for bonus words
     * @param burnWordHashes 5 hashes for burn words
     */
    function commitRound(
        uint256 roundId,
        bytes32 secretHash,
        bytes32[10] calldata bonusWordHashes,
        bytes32[5] calldata burnWordHashes
    ) external onlyOperator {
        if (roundCommitments[roundId].committedAt != 0) {
            revert RoundAlreadyCommitted(roundId);
        }

        RoundCommitment storage commitment = roundCommitments[roundId];
        commitment.secretHash = secretHash;
        commitment.committedAt = block.timestamp;

        for (uint256 i = 0; i < 10; i++) {
            commitment.bonusWordHashes[i] = bonusWordHashes[i];
        }
        for (uint256 i = 0; i < 5; i++) {
            commitment.burnWordHashes[i] = burnWordHashes[i];
        }

        emit RoundCommitted(roundId, secretHash, block.timestamp);
    }

    // =========================================================================
    // Bonus Word Claims (with verification)
    // =========================================================================

    /**
     * @notice Claim a bonus word reward after verifying the word hash
     * @param roundId The round this bonus word belongs to
     * @param wordIndex Index of the bonus word (0-9)
     * @param word The plaintext word (uppercase)
     * @param salt The salt used when committing
     * @param player The player who found the word
     * @param amount The $WORD reward amount
     */
    function claimBonusReward(
        uint256 roundId,
        uint256 wordIndex,
        string calldata word,
        bytes32 salt,
        address player,
        uint256 amount
    ) external onlyOperator {
        if (roundCommitments[roundId].committedAt == 0) {
            revert RoundNotCommitted(roundId);
        }
        if (wordIndex >= 10) {
            revert InvalidWordIndex();
        }
        if (bonusWordClaimed[roundId][wordIndex]) {
            revert BonusWordAlreadyClaimed(roundId, wordIndex);
        }

        // Verify: keccak256(abi.encodePacked(word, salt)) == stored hash
        bytes32 computedHash = keccak256(abi.encodePacked(word, salt));
        if (computedHash != roundCommitments[roundId].bonusWordHashes[wordIndex]) {
            revert HashMismatch();
        }

        bonusWordClaimed[roundId][wordIndex] = true;

        // Transfer $WORD tokens to the player
        if (!wordToken.transfer(player, amount)) {
            revert InsufficientBalance();
        }

        totalDistributed += amount;

        emit BonusRewardClaimed(roundId, wordIndex, player, amount);
    }

    // =========================================================================
    // Burn Word Claims (with verification)
    // =========================================================================

    /**
     * @notice Execute a verified burn word destruction
     * @param roundId The round this burn word belongs to
     * @param wordIndex Index of the burn word (0-4)
     * @param word The plaintext word (uppercase)
     * @param salt The salt used when committing
     * @param amount The $WORD amount to burn
     */
    function claimBurnWord(
        uint256 roundId,
        uint256 wordIndex,
        string calldata word,
        bytes32 salt,
        uint256 amount
    ) external onlyOperator {
        if (roundCommitments[roundId].committedAt == 0) {
            revert RoundNotCommitted(roundId);
        }
        if (wordIndex >= 5) {
            revert InvalidWordIndex();
        }
        if (burnWordClaimed[roundId][wordIndex]) {
            revert BurnWordAlreadyClaimed(roundId, wordIndex);
        }

        // Verify: keccak256(abi.encodePacked(word, salt)) == stored hash
        bytes32 computedHash = keccak256(abi.encodePacked(word, salt));
        if (computedHash != roundCommitments[roundId].burnWordHashes[wordIndex]) {
            revert HashMismatch();
        }

        burnWordClaimed[roundId][wordIndex] = true;

        // Burn by sending to dead address (0x000...dead)
        address burnAddress = address(0xdead);
        if (!wordToken.transfer(burnAddress, amount)) {
            revert InsufficientBalance();
        }

        totalBurned += amount;

        emit BurnWordClaimed(roundId, wordIndex, amount);
    }

    // =========================================================================
    // Legacy compatibility functions (preserved from V1)
    // =========================================================================

    /**
     * @notice Distribute bonus reward without verification (legacy, for pre-commitment rounds)
     */
    function distributeBonusReward(address player, uint256 amount) external onlyOperator {
        require(wordToken.transfer(player, amount), "Transfer failed");
        totalDistributed += amount;
    }

    /**
     * @notice Burn tokens without verification (legacy, for pre-commitment rounds)
     */
    function burnWord(uint256 /*roundId*/, address /*discoverer*/, uint256 amount) external onlyOperator {
        address burnAddress = address(0xdead);
        require(wordToken.transfer(burnAddress, amount), "Burn transfer failed");
        totalBurned += amount;
    }

    /**
     * @notice Distribute top-10 rewards in batch
     */
    function distributeTop10Rewards(
        uint256 /*roundId*/,
        address[] calldata players,
        uint256[] calldata amounts
    ) external onlyOperator {
        require(players.length == amounts.length, "Length mismatch");
        for (uint256 i = 0; i < players.length; i++) {
            require(wordToken.transfer(players[i], amounts[i]), "Transfer failed");
            totalDistributed += amounts[i];
        }
    }

    // =========================================================================
    // Staking (preserved from V1)
    // =========================================================================

    function stake(uint256 amount) external {
        require(wordToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        deposits[msg.sender].push(StakeDeposit(amount, block.timestamp));
        stakedBalance[msg.sender] += amount;
        totalStaked += amount;
    }

    function withdraw(uint256 depositId) external {
        require(depositId < deposits[msg.sender].length, "Invalid deposit");
        StakeDeposit storage dep = deposits[msg.sender][depositId];
        require(dep.amount > 0, "Already withdrawn");

        uint256 amount = dep.amount;
        dep.amount = 0;
        stakedBalance[msg.sender] -= amount;
        totalStaked -= amount;
        require(wordToken.transfer(msg.sender, amount), "Transfer failed");
    }

    function claimRewards() external {
        uint256 rewards = unclaimedRewards[msg.sender];
        require(rewards > 0, "No rewards");
        unclaimedRewards[msg.sender] = 0;
        require(wordToken.transfer(msg.sender, rewards), "Transfer failed");
    }

    function depositRewards(uint256 amount) external onlyOperator {
        require(wordToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");
    }

    function getEffectiveBalance(address user) external view returns (uint256) {
        return stakedBalance[user];
    }

    // =========================================================================
    // Read functions
    // =========================================================================

    /**
     * @notice Check if a round has been committed
     */
    function isRoundCommitted(uint256 roundId) external view returns (bool) {
        return roundCommitments[roundId].committedAt != 0;
    }

    /**
     * @notice Get the secret hash for a round
     */
    function getSecretHash(uint256 roundId) external view returns (bytes32) {
        return roundCommitments[roundId].secretHash;
    }

    /**
     * @notice Get a bonus word hash for a round
     */
    function getBonusWordHash(uint256 roundId, uint256 index) external view returns (bytes32) {
        require(index < 10, "Invalid index");
        return roundCommitments[roundId].bonusWordHashes[index];
    }

    /**
     * @notice Get a burn word hash for a round
     */
    function getBurnWordHash(uint256 roundId, uint256 index) external view returns (bytes32) {
        require(index < 5, "Invalid index");
        return roundCommitments[roundId].burnWordHashes[index];
    }
}

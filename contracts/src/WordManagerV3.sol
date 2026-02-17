// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title WordManagerV3
 * @notice Manages $WORD staking with Synthetix-style streaming rewards + game mechanics
 * @dev Fresh UUPS proxy deployment (not an upgrade from V2). V2 had zero stakers
 *      and staking was never enabled in production, so no migration needed.
 *
 *      Staking model: Single-balance per user (no deposit IDs).
 *      Rewards: Global accumulator (rewardPerTokenStored) tracks cumulative reward
 *      per staked token. Each user records a snapshot on interaction. O(1) gas.
 *
 *      Same-token design: $WORD is both staking token and reward token.
 *      notifyRewardAmount checks balance minus staked to prevent over-promising.
 *
 *      Game mechanics (commitRound, claimBonusReward, claimBurnWord, etc.)
 *      are preserved from V2.
 */
contract WordManagerV3 is
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable
{
    // =========================================================================
    // State — Core
    // =========================================================================

    IERC20 public wordToken;
    address public operator;

    // =========================================================================
    // State — Synthetix Streaming Rewards
    // =========================================================================

    uint256 public rewardRate;              // $WORD per second (in wei)
    uint256 public rewardsDuration;         // Default: 30 days = 2592000
    uint256 public periodFinish;            // Timestamp when current reward period ends
    uint256 public lastUpdateTime;          // Last global checkpoint
    uint256 public rewardPerTokenStored;    // Cumulative reward per staked token (1e18 scaled)

    mapping(address => uint256) public userRewardPerTokenPaid;  // Per-user snapshot
    mapping(address => uint256) public rewards;                 // Accrued unclaimed rewards

    uint256 private _totalSupply;
    mapping(address => uint256) private _balances;

    // =========================================================================
    // State — Game Mechanics (from V2)
    // =========================================================================

    struct RoundCommitment {
        bytes32 secretHash;
        bytes32[10] bonusWordHashes;
        bytes32[5] burnWordHashes;
        uint256 committedAt;
    }

    mapping(uint256 => RoundCommitment) public roundCommitments;
    mapping(uint256 => mapping(uint256 => bool)) public bonusWordClaimed;
    mapping(uint256 => mapping(uint256 => bool)) public burnWordClaimed;

    uint256 public totalBurned;
    uint256 public totalDistributed;

    // =========================================================================
    // Events
    // =========================================================================

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardAdded(uint256 reward);
    event RewardsDurationUpdated(uint256 newDuration);
    event OperatorUpdated(address indexed oldOperator, address indexed newOperator);

    event RoundCommitted(uint256 indexed roundId, bytes32 secretHash, uint256 timestamp);
    event BonusRewardClaimed(uint256 indexed roundId, uint256 indexed wordIndex, address indexed player, uint256 amount);
    event BurnWordClaimed(uint256 indexed roundId, uint256 indexed wordIndex, uint256 amount);

    // =========================================================================
    // Errors
    // =========================================================================

    error NotOperator();
    error ZeroAmount();
    error InsufficientStake();
    error RewardTooHigh();
    error RewardPeriodNotFinished();
    error RoundAlreadyCommitted(uint256 roundId);
    error RoundNotCommitted(uint256 roundId);
    error BonusWordAlreadyClaimed(uint256 roundId, uint256 wordIndex);
    error BurnWordAlreadyClaimed(uint256 roundId, uint256 wordIndex);
    error InvalidWordIndex();
    error HashMismatch();
    error InsufficientBalance();

    // =========================================================================
    // Modifiers
    // =========================================================================

    modifier onlyOperator() {
        if (msg.sender != operator && msg.sender != owner()) {
            revert NotOperator();
        }
        _;
    }

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    // =========================================================================
    // Initializer (replaces constructor for UUPS proxy)
    // =========================================================================

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the contract (called once via proxy)
     * @param _wordToken $WORD ERC-20 token address
     * @param _operator Server-side operator wallet
     * @param _rewardsDuration Duration of reward periods in seconds (e.g. 2592000 for 30 days)
     */
    function initialize(
        address _wordToken,
        address _operator,
        uint256 _rewardsDuration
    ) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        wordToken = IERC20(_wordToken);
        operator = _operator;
        rewardsDuration = _rewardsDuration;

        emit OperatorUpdated(address(0), _operator);
    }

    // =========================================================================
    // UUPS Authorization
    // =========================================================================

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // =========================================================================
    // Synthetix Views
    // =========================================================================

    function totalStaked() external view returns (uint256) {
        return _totalSupply;
    }

    function stakedBalance(address account) external view returns (uint256) {
        return _balances[account];
    }

    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    function rewardPerToken() public view returns (uint256) {
        if (_totalSupply == 0) {
            return rewardPerTokenStored;
        }
        return rewardPerTokenStored + (
            (lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * 1e18 / _totalSupply
        );
    }

    function earned(address account) public view returns (uint256) {
        return (
            _balances[account] * (rewardPerToken() - userRewardPerTokenPaid[account]) / 1e18
        ) + rewards[account];
    }

    function getRewardForDuration() external view returns (uint256) {
        return rewardRate * rewardsDuration;
    }

    // =========================================================================
    // User Actions — Staking
    // =========================================================================

    function stake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        if (amount == 0) revert ZeroAmount();

        _totalSupply += amount;
        _balances[msg.sender] += amount;

        require(wordToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        emit Staked(msg.sender, amount);
    }

    function withdraw(uint256 amount) external nonReentrant updateReward(msg.sender) {
        if (amount == 0) revert ZeroAmount();
        if (_balances[msg.sender] < amount) revert InsufficientStake();

        _totalSupply -= amount;
        _balances[msg.sender] -= amount;

        require(wordToken.transfer(msg.sender, amount), "Transfer failed");

        emit Withdrawn(msg.sender, amount);
    }

    function getReward() public nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            require(wordToken.transfer(msg.sender, reward), "Transfer failed");
            emit RewardPaid(msg.sender, reward);
        }
    }

    /**
     * @notice Withdraw all staked tokens and claim all rewards in one call
     */
    function exit() external {
        // Withdraw calls updateReward internally via modifier
        uint256 bal = _balances[msg.sender];
        if (bal > 0) {
            // Inline the logic to avoid double nonReentrant
            rewardPerTokenStored = rewardPerToken();
            lastUpdateTime = lastTimeRewardApplicable();
            rewards[msg.sender] = earned(msg.sender);
            userRewardPerTokenPaid[msg.sender] = rewardPerTokenStored;

            _totalSupply -= bal;
            _balances[msg.sender] = 0;
            require(wordToken.transfer(msg.sender, bal), "Transfer failed");
            emit Withdrawn(msg.sender, bal);
        }
        // Claim rewards
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            require(wordToken.transfer(msg.sender, reward), "Transfer failed");
            emit RewardPaid(msg.sender, reward);
        }
    }

    // =========================================================================
    // Backward Compatibility Aliases
    // =========================================================================

    /**
     * @notice Alias for getReward() — matches V2 interface
     */
    function claimRewards() external {
        // Inline updateReward + getReward to avoid reentrancy issues
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        rewards[msg.sender] = earned(msg.sender);
        userRewardPerTokenPaid[msg.sender] = rewardPerTokenStored;

        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            require(wordToken.transfer(msg.sender, reward), "Transfer failed");
            emit RewardPaid(msg.sender, reward);
        }
    }

    /**
     * @notice Alias for earned() — matches V2 interface
     */
    function unclaimedRewards(address account) external view returns (uint256) {
        return earned(account);
    }

    /**
     * @notice Alias for stakedBalance — matches V2 interface
     */
    function getEffectiveBalance(address user) external view returns (uint256) {
        return _balances[user];
    }

    // =========================================================================
    // Operator — Reward Distribution
    // =========================================================================

    /**
     * @notice Start or extend a reward period. Tokens must already be in the contract.
     * @dev If called mid-period, rolls remaining undistributed tokens into the new period.
     *      Safety check: ensures rewardRate won't promise more than available non-staked balance.
     * @param reward Amount of $WORD to distribute over rewardsDuration
     */
    function notifyRewardAmount(uint256 reward) external onlyOperator updateReward(address(0)) {
        if (block.timestamp >= periodFinish) {
            rewardRate = reward / rewardsDuration;
        } else {
            uint256 remaining = (periodFinish - block.timestamp) * rewardRate;
            rewardRate = (reward + remaining) / rewardsDuration;
        }

        // Safety: ensure we have enough non-staked balance to cover the full period
        uint256 balance = wordToken.balanceOf(address(this));
        if (rewardRate > (balance - _totalSupply) / rewardsDuration) {
            revert RewardTooHigh();
        }

        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + rewardsDuration;

        emit RewardAdded(reward);
    }

    /**
     * @notice Update the reward period duration (only between periods)
     * @param _rewardsDuration New duration in seconds
     */
    function setRewardsDuration(uint256 _rewardsDuration) external onlyOwner {
        if (block.timestamp < periodFinish) {
            revert RewardPeriodNotFinished();
        }
        rewardsDuration = _rewardsDuration;
        emit RewardsDurationUpdated(_rewardsDuration);
    }

    // =========================================================================
    // Admin
    // =========================================================================

    function setOperator(address _operator) external onlyOwner {
        address old = operator;
        operator = _operator;
        emit OperatorUpdated(old, _operator);
    }

    function emergencyWithdraw(address to, uint256 amount) external onlyOwner {
        require(wordToken.transfer(to, amount), "Transfer failed");
    }

    // =========================================================================
    // Game Mechanics — Round Commitment (from V2)
    // =========================================================================

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
    // Game Mechanics — Bonus Word Claims (from V2)
    // =========================================================================

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
        if (wordIndex >= 10) revert InvalidWordIndex();
        if (bonusWordClaimed[roundId][wordIndex]) {
            revert BonusWordAlreadyClaimed(roundId, wordIndex);
        }

        bytes32 computedHash = keccak256(abi.encodePacked(word, salt));
        if (computedHash != roundCommitments[roundId].bonusWordHashes[wordIndex]) {
            revert HashMismatch();
        }

        bonusWordClaimed[roundId][wordIndex] = true;

        if (!wordToken.transfer(player, amount)) {
            revert InsufficientBalance();
        }

        totalDistributed += amount;
        emit BonusRewardClaimed(roundId, wordIndex, player, amount);
    }

    // =========================================================================
    // Game Mechanics — Burn Word Claims (from V2)
    // =========================================================================

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
        if (wordIndex >= 5) revert InvalidWordIndex();
        if (burnWordClaimed[roundId][wordIndex]) {
            revert BurnWordAlreadyClaimed(roundId, wordIndex);
        }

        bytes32 computedHash = keccak256(abi.encodePacked(word, salt));
        if (computedHash != roundCommitments[roundId].burnWordHashes[wordIndex]) {
            revert HashMismatch();
        }

        burnWordClaimed[roundId][wordIndex] = true;

        address burnAddress = address(0xdead);
        if (!wordToken.transfer(burnAddress, amount)) {
            revert InsufficientBalance();
        }

        totalBurned += amount;
        emit BurnWordClaimed(roundId, wordIndex, amount);
    }

    // =========================================================================
    // Legacy Compatibility (from V2)
    // =========================================================================

    function distributeBonusReward(address player, uint256 amount) external onlyOperator {
        require(wordToken.transfer(player, amount), "Transfer failed");
        totalDistributed += amount;
    }

    function burnWord(uint256, address, uint256 amount) external onlyOperator {
        address burnAddress = address(0xdead);
        require(wordToken.transfer(burnAddress, amount), "Burn transfer failed");
        totalBurned += amount;
    }

    function distributeTop10Rewards(
        uint256,
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
    // Read Functions (from V2)
    // =========================================================================

    function isRoundCommitted(uint256 roundId) external view returns (bool) {
        return roundCommitments[roundId].committedAt != 0;
    }

    function getSecretHash(uint256 roundId) external view returns (bytes32) {
        return roundCommitments[roundId].secretHash;
    }

    function getBonusWordHash(uint256 roundId, uint256 index) external view returns (bytes32) {
        require(index < 10, "Invalid index");
        return roundCommitments[roundId].bonusWordHashes[index];
    }

    function getBurnWordHash(uint256 roundId, uint256 index) external view returns (bytes32) {
        require(index < 5, "Invalid index");
        return roundCommitments[roundId].burnWordHashes[index];
    }
}

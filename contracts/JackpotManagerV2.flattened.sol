// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// OpenZeppelin Contracts (last updated v5.0.0) (token/ERC20/IERC20.sol)
interface IERC20 {
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

// OpenZeppelin Contracts (last updated v5.0.0) (proxy/utils/Initializable.sol)
abstract contract Initializable {
    struct InitializableStorage {
        uint64 _initialized;
        bool _initializing;
    }
    bytes32 private constant INITIALIZABLE_STORAGE = 0xf0c57e16840df040f15088dc2f81fe391c3923bec73e23a9662efc9c229c6a00;
    error InvalidInitialization();
    error NotInitializing();
    event Initialized(uint64 version);
    modifier initializer() {
        InitializableStorage storage $ = _getInitializableStorage();
        bool isTopLevelCall = !$._initializing;
        uint64 initialized = $._initialized;
        bool initialSetup = initialized == 0 && isTopLevelCall;
        bool construction = initialized == 1 && address(this).code.length == 0;
        if (!initialSetup && !construction) {
            revert InvalidInitialization();
        }
        $._initialized = 1;
        if (isTopLevelCall) {
            $._initializing = true;
        }
        _;
        if (isTopLevelCall) {
            $._initializing = false;
            emit Initialized(1);
        }
    }
    modifier reinitializer(uint64 version) {
        InitializableStorage storage $ = _getInitializableStorage();
        if ($._initializing || $._initialized >= version) {
            revert InvalidInitialization();
        }
        $._initialized = version;
        $._initializing = true;
        _;
        $._initializing = false;
        emit Initialized(version);
    }
    modifier onlyInitializing() {
        _checkInitializing();
        _;
    }
    function _checkInitializing() internal view virtual {
        if (!_isInitializing()) {
            revert NotInitializing();
        }
    }
    function _disableInitializers() internal virtual {
        InitializableStorage storage $ = _getInitializableStorage();
        if ($._initializing) {
            revert InvalidInitialization();
        }
        if ($._initialized != type(uint64).max) {
            $._initialized = type(uint64).max;
            emit Initialized(type(uint64).max);
        }
    }
    function _getInitializedVersion() internal view returns (uint64) {
        return _getInitializableStorage()._initialized;
    }
    function _isInitializing() internal view returns (bool) {
        return _getInitializableStorage()._initializing;
    }
    function _getInitializableStorage() private pure returns (InitializableStorage storage $) {
        assembly {
            $.slot := INITIALIZABLE_STORAGE
        }
    }
}

// OpenZeppelin Contracts (last updated v5.0.0) (utils/ContextUpgradeable.sol)
abstract contract ContextUpgradeable is Initializable {
    function __Context_init() internal onlyInitializing {}
    function __Context_init_unchained() internal onlyInitializing {}
    function _msgSender() internal view virtual returns (address) {
        return msg.sender;
    }
    function _msgData() internal view virtual returns (bytes calldata) {
        return msg.data;
    }
    function _contextSuffixLength() internal view virtual returns (uint256) {
        return 0;
    }
}

// OpenZeppelin Contracts (last updated v5.0.0) (access/OwnableUpgradeable.sol)
abstract contract OwnableUpgradeable is Initializable, ContextUpgradeable {
    struct OwnableStorage {
        address _owner;
    }
    bytes32 private constant OwnableStorageLocation = 0x9016d09d72d40fdae2fd8ceac6b6234c7706214fd39c1cd1e609a0528c199300;
    function _getOwnableStorage() private pure returns (OwnableStorage storage $) {
        assembly {
            $.slot := OwnableStorageLocation
        }
    }
    error OwnableUnauthorizedAccount(address account);
    error OwnableInvalidOwner(address owner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    modifier onlyOwner() {
        _checkOwner();
        _;
    }
    function __Ownable_init(address initialOwner) internal onlyInitializing {
        __Ownable_init_unchained(initialOwner);
    }
    function __Ownable_init_unchained(address initialOwner) internal onlyInitializing {
        if (initialOwner == address(0)) {
            revert OwnableInvalidOwner(address(0));
        }
        _transferOwnership(initialOwner);
    }
    function owner() public view virtual returns (address) {
        OwnableStorage storage $ = _getOwnableStorage();
        return $._owner;
    }
    function _checkOwner() internal view virtual {
        if (owner() != _msgSender()) {
            revert OwnableUnauthorizedAccount(_msgSender());
        }
    }
    function renounceOwnership() public virtual onlyOwner {
        _transferOwnership(address(0));
    }
    function transferOwnership(address newOwner) public virtual onlyOwner {
        if (newOwner == address(0)) {
            revert OwnableInvalidOwner(address(0));
        }
        _transferOwnership(newOwner);
    }
    function _transferOwnership(address newOwner) internal virtual {
        OwnableStorage storage $ = _getOwnableStorage();
        address oldOwner = $._owner;
        $._owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }
}

// OpenZeppelin Contracts (last updated v5.0.0) (interfaces/draft-IERC1822.sol)
interface IERC1822Proxiable {
    function proxiableUUID() external view returns (bytes32);
}

// OpenZeppelin Contracts (last updated v5.0.0) (proxy/beacon/IBeacon.sol)
interface IBeacon {
    function implementation() external view returns (address);
}

// OpenZeppelin Contracts (last updated v5.0.0) (utils/StorageSlot.sol)
library StorageSlot {
    struct AddressSlot {
        address value;
    }
    struct BooleanSlot {
        bool value;
    }
    struct Bytes32Slot {
        bytes32 value;
    }
    struct Uint256Slot {
        uint256 value;
    }
    struct StringSlot {
        string value;
    }
    struct BytesSlot {
        bytes value;
    }
    function getAddressSlot(bytes32 slot) internal pure returns (AddressSlot storage r) {
        assembly {
            r.slot := slot
        }
    }
    function getBooleanSlot(bytes32 slot) internal pure returns (BooleanSlot storage r) {
        assembly {
            r.slot := slot
        }
    }
    function getBytes32Slot(bytes32 slot) internal pure returns (Bytes32Slot storage r) {
        assembly {
            r.slot := slot
        }
    }
    function getUint256Slot(bytes32 slot) internal pure returns (Uint256Slot storage r) {
        assembly {
            r.slot := slot
        }
    }
    function getStringSlot(bytes32 slot) internal pure returns (StringSlot storage r) {
        assembly {
            r.slot := slot
        }
    }
    function getStringSlot(string storage store) internal pure returns (StringSlot storage r) {
        assembly {
            r.slot := store.slot
        }
    }
    function getBytesSlot(bytes32 slot) internal pure returns (BytesSlot storage r) {
        assembly {
            r.slot := slot
        }
    }
    function getBytesSlot(bytes storage store) internal pure returns (BytesSlot storage r) {
        assembly {
            r.slot := store.slot
        }
    }
}

// OpenZeppelin Contracts (last updated v5.0.0) (utils/Address.sol)
library Address {
    error AddressInsufficientBalance(address account);
    error AddressEmptyCode(address target);
    error FailedInnerCall();
    function sendValue(address payable recipient, uint256 amount) internal {
        if (address(this).balance < amount) {
            revert AddressInsufficientBalance(address(this));
        }
        (bool success, ) = recipient.call{value: amount}("");
        if (!success) {
            revert FailedInnerCall();
        }
    }
    function functionCall(address target, bytes memory data) internal returns (bytes memory) {
        return functionCallWithValue(target, data, 0);
    }
    function functionCallWithValue(address target, bytes memory data, uint256 value) internal returns (bytes memory) {
        if (address(this).balance < value) {
            revert AddressInsufficientBalance(address(this));
        }
        (bool success, bytes memory returndata) = target.call{value: value}(data);
        return verifyCallResultFromTarget(target, success, returndata);
    }
    function functionStaticCall(address target, bytes memory data) internal view returns (bytes memory) {
        (bool success, bytes memory returndata) = target.staticcall(data);
        return verifyCallResultFromTarget(target, success, returndata);
    }
    function functionDelegateCall(address target, bytes memory data) internal returns (bytes memory) {
        (bool success, bytes memory returndata) = target.delegatecall(data);
        return verifyCallResultFromTarget(target, success, returndata);
    }
    function verifyCallResultFromTarget(address target, bool success, bytes memory returndata) internal view returns (bytes memory) {
        if (!success) {
            _revert(returndata);
        } else {
            if (returndata.length == 0 && target.code.length == 0) {
                revert AddressEmptyCode(target);
            }
            return returndata;
        }
    }
    function verifyCallResult(bool success, bytes memory returndata) internal pure returns (bytes memory) {
        if (!success) {
            _revert(returndata);
        } else {
            return returndata;
        }
    }
    function _revert(bytes memory returndata) private pure {
        if (returndata.length > 0) {
            assembly {
                let returndata_size := mload(returndata)
                revert(add(32, returndata), returndata_size)
            }
        } else {
            revert FailedInnerCall();
        }
    }
}

// OpenZeppelin Contracts (last updated v5.0.0) (proxy/ERC1967/ERC1967Utils.sol)
library ERC1967Utils {
    bytes32 internal constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    bytes32 internal constant ADMIN_SLOT = 0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;
    bytes32 internal constant BEACON_SLOT = 0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50;
    error ERC1967InvalidImplementation(address implementation);
    error ERC1967InvalidAdmin(address admin);
    error ERC1967InvalidBeacon(address beacon);
    error ERC1967NonPayable();
    event Upgraded(address indexed implementation);
    event AdminChanged(address previousAdmin, address newAdmin);
    event BeaconUpgraded(address indexed beacon);
    function getImplementation() internal view returns (address) {
        return StorageSlot.getAddressSlot(IMPLEMENTATION_SLOT).value;
    }
    function _setImplementation(address newImplementation) private {
        if (newImplementation.code.length == 0) {
            revert ERC1967InvalidImplementation(newImplementation);
        }
        StorageSlot.getAddressSlot(IMPLEMENTATION_SLOT).value = newImplementation;
    }
    function upgradeToAndCall(address newImplementation, bytes memory data) internal {
        _setImplementation(newImplementation);
        emit Upgraded(newImplementation);
        if (data.length > 0) {
            Address.functionDelegateCall(newImplementation, data);
        } else {
            _checkNonPayable();
        }
    }
    function getAdmin() internal view returns (address) {
        return StorageSlot.getAddressSlot(ADMIN_SLOT).value;
    }
    function _setAdmin(address newAdmin) private {
        if (newAdmin == address(0)) {
            revert ERC1967InvalidAdmin(address(0));
        }
        StorageSlot.getAddressSlot(ADMIN_SLOT).value = newAdmin;
    }
    function changeAdmin(address newAdmin) internal {
        emit AdminChanged(getAdmin(), newAdmin);
        _setAdmin(newAdmin);
    }
    function getBeacon() internal view returns (address) {
        return StorageSlot.getAddressSlot(BEACON_SLOT).value;
    }
    function _setBeacon(address newBeacon) private {
        if (newBeacon.code.length == 0) {
            revert ERC1967InvalidBeacon(newBeacon);
        }
        StorageSlot.getAddressSlot(BEACON_SLOT).value = newBeacon;
        address beaconImplementation = IBeacon(newBeacon).implementation();
        if (beaconImplementation.code.length == 0) {
            revert ERC1967InvalidImplementation(beaconImplementation);
        }
    }
    function upgradeBeaconToAndCall(address newBeacon, bytes memory data) internal {
        _setBeacon(newBeacon);
        emit BeaconUpgraded(newBeacon);
        if (data.length > 0) {
            Address.functionDelegateCall(IBeacon(newBeacon).implementation(), data);
        } else {
            _checkNonPayable();
        }
    }
    function _checkNonPayable() private {
        if (msg.value > 0) {
            revert ERC1967NonPayable();
        }
    }
}

// OpenZeppelin Contracts (last updated v5.0.0) (proxy/utils/UUPSUpgradeable.sol)
abstract contract UUPSUpgradeable is Initializable, IERC1822Proxiable {
    bytes32 internal constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    address private immutable __self = address(this);
    error UUPSUnauthorizedCallContext();
    error UUPSUnsupportedProxiableUUID(bytes32 slot);
    modifier onlyProxy() {
        _checkProxy();
        _;
    }
    modifier notDelegated() {
        _checkNotDelegated();
        _;
    }
    function __UUPSUpgradeable_init() internal onlyInitializing {}
    function __UUPSUpgradeable_init_unchained() internal onlyInitializing {}
    function proxiableUUID() external view virtual notDelegated returns (bytes32) {
        return IMPLEMENTATION_SLOT;
    }
    function upgradeToAndCall(address newImplementation, bytes memory data) public payable virtual onlyProxy {
        _authorizeUpgrade(newImplementation);
        _upgradeToAndCallUUPS(newImplementation, data);
    }
    function _checkProxy() internal view virtual {
        if (address(this) == __self || ERC1967Utils.getImplementation() != __self) {
            revert UUPSUnauthorizedCallContext();
        }
    }
    function _checkNotDelegated() internal view virtual {
        if (address(this) != __self) {
            revert UUPSUnauthorizedCallContext();
        }
    }
    function _authorizeUpgrade(address newImplementation) internal virtual;
    function _upgradeToAndCallUUPS(address newImplementation, bytes memory data) private {
        try IERC1822Proxiable(newImplementation).proxiableUUID() returns (bytes32 slot) {
            if (slot != IMPLEMENTATION_SLOT) {
                revert UUPSUnsupportedProxiableUUID(slot);
            }
            ERC1967Utils.upgradeToAndCall(newImplementation, data);
        } catch {
            revert ERC1967Utils.ERC1967InvalidImplementation(newImplementation);
        }
    }
}

// OpenZeppelin Contracts (last updated v5.0.0) (utils/ReentrancyGuardUpgradeable.sol)
abstract contract ReentrancyGuardUpgradeable is Initializable {
    struct ReentrancyGuardStorage {
        uint256 _status;
    }
    bytes32 private constant ReentrancyGuardStorageLocation = 0x9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00;
    function _getReentrancyGuardStorage() private pure returns (ReentrancyGuardStorage storage $) {
        assembly {
            $.slot := ReentrancyGuardStorageLocation
        }
    }
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;
    error ReentrancyGuardReentrantCall();
    function __ReentrancyGuard_init() internal onlyInitializing {
        __ReentrancyGuard_init_unchained();
    }
    function __ReentrancyGuard_init_unchained() internal onlyInitializing {
        ReentrancyGuardStorage storage $ = _getReentrancyGuardStorage();
        $._status = NOT_ENTERED;
    }
    modifier nonReentrant() {
        _nonReentrantBefore();
        _;
        _nonReentrantAfter();
    }
    function _nonReentrantBefore() private {
        ReentrancyGuardStorage storage $ = _getReentrancyGuardStorage();
        if ($._status == ENTERED) {
            revert ReentrancyGuardReentrantCall();
        }
        $._status = ENTERED;
    }
    function _nonReentrantAfter() private {
        ReentrancyGuardStorage storage $ = _getReentrancyGuardStorage();
        $._status = NOT_ENTERED;
    }
    function _reentrancyGuardEntered() internal view returns (bool) {
        return _getReentrancyGuardStorage()._status == ENTERED;
    }
}

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

    uint256 public constant MINIMUM_SEED = 0.03 ether;
    uint256 public constant JACKPOT_SHARE_BPS = 8000;
    uint256 public constant CREATOR_SHARE_BPS = 2000;
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant MARKET_CAP_TIER_THRESHOLD = 250_000 * 1e8;
    uint256 public constant MARKET_CAP_STALENESS_THRESHOLD = 1 hours;
    uint256 public constant BONUS_WORD_REWARD = 5_000_000 * 1e18;
    uint256 public constant BONUS_WORDS_PER_ROUND = 10;

    // ============ Enums ============

    enum BonusTier { LOW, HIGH }

    // ============ State Variables (V1 - DO NOT REORDER) ============

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

    // ============ State Variables (V2 - NEW, added at end) ============

    IERC20 public clanktonToken;
    mapping(uint256 => bytes32) public bonusWordsCommitHashes;
    mapping(uint256 => mapping(uint256 => bool)) public bonusWordsClaimed;
    uint256 public totalClanktonDistributed;
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
        bytes32 commitHash;
    }

    // ============ Events ============

    event RoundStarted(uint256 indexed roundNumber, uint256 startingJackpot, uint256 timestamp);
    event RoundStartedWithCommitment(uint256 indexed roundNumber, uint256 startingJackpot, bytes32 indexed commitHash, uint256 timestamp);
    event RoundStartedWithBonusWords(uint256 indexed roundNumber, uint256 startingJackpot, bytes32 indexed secretWordCommitHash, bytes32 indexed bonusWordsCommitHash, uint256 timestamp);
    event RoundResolved(uint256 indexed roundNumber, address indexed winner, uint256 jackpotAmount, uint256 winnerPayout, uint256 timestamp);
    event JackpotSeeded(uint256 indexed roundNumber, address indexed seeder, uint256 amount, uint256 newJackpot);
    event GuessesPurchased(uint256 indexed roundNumber, address indexed player, uint256 quantity, uint256 ethAmount, uint256 toJackpot, uint256 toCreator);
    event CreatorProfitPaid(address indexed recipient, uint256 amount);
    event OperatorWalletUpdated(address indexed oldOperator, address indexed newOperator);
    event CreatorProfitWalletUpdated(address indexed oldWallet, address indexed newWallet);
    event PrizePoolWalletUpdated(address indexed oldWallet, address indexed newWallet);
    event MarketCapUpdated(uint256 marketCapUsd, uint256 timestamp);
    event RoundResolvedWithPayouts(uint256 indexed roundNumber, address indexed winner, uint256 jackpotAmount, uint256 totalPaidOut, uint256 seedForNextRound, uint256 recipientCount, uint256 timestamp);
    event PayoutSent(uint256 indexed roundNumber, address indexed recipient, uint256 amount, uint256 index);
    event ClanktonTokenSet(address indexed tokenAddress);
    event BonusWordRewardDistributed(uint256 indexed roundNumber, address indexed recipient, uint256 bonusWordIndex, uint256 amount);
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

    modifier onlyOperator() {
        if (msg.sender != operatorWallet) revert OnlyOperator();
        _;
    }

    modifier roundActive() {
        if (currentRound == 0 || !rounds[currentRound].isActive) revert RoundNotActive();
        _;
    }

    // ============ Initialization ============

    constructor() {
        _disableInitializers();
    }

    function initialize(address _operatorWallet, address _creatorProfitWallet, address _prizePoolWallet) external initializer {
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

    function initializeV2() external onlyOwner {
        bonusWordsEnabled = false;
    }

    // ============ V2: CLANKTON Token Setup ============

    function setClanktonToken(address _clanktonToken) external onlyOwner {
        if (_clanktonToken == address(0)) revert ZeroAddress();
        clanktonToken = IERC20(_clanktonToken);
        emit ClanktonTokenSet(_clanktonToken);
    }

    function setBonusWordsEnabled(bool _enabled) external onlyOwner {
        if (_enabled && address(clanktonToken) == address(0)) revert ClanktonTokenNotSet();
        bonusWordsEnabled = _enabled;
        emit BonusWordsToggled(_enabled);
    }

    // ============ V2: Round Start with Bonus Words ============

    function startRoundWithCommitments(bytes32 _secretWordCommitHash, bytes32 _bonusWordsCommitHash) external onlyOperator {
        if (currentRound > 0 && rounds[currentRound].isActive) revert RoundAlreadyActive();
        if (currentJackpot < MINIMUM_SEED) revert InsufficientSeed();
        if (_secretWordCommitHash == bytes32(0)) revert InvalidCommitHash();
        if (_bonusWordsCommitHash == bytes32(0)) revert InvalidCommitHash();
        _startNewRound(_secretWordCommitHash);
        bonusWordsCommitHashes[currentRound] = _bonusWordsCommitHash;
        emit RoundStartedWithBonusWords(currentRound, currentJackpot, _secretWordCommitHash, _bonusWordsCommitHash, block.timestamp);
    }

    // ============ V2: Bonus Word CLANKTON Distribution ============

    function distributeBonusWordReward(address recipient, uint256 bonusWordIndex) external onlyOperator nonReentrant roundActive {
        if (!bonusWordsEnabled) revert BonusWordsNotEnabled();
        if (address(clanktonToken) == address(0)) revert ClanktonTokenNotSet();
        if (recipient == address(0)) revert ZeroAddress();
        if (bonusWordIndex >= BONUS_WORDS_PER_ROUND) revert InvalidBonusWordIndex();
        if (bonusWordsClaimed[currentRound][bonusWordIndex]) revert BonusWordAlreadyClaimed();
        uint256 balance = clanktonToken.balanceOf(address(this));
        if (balance < BONUS_WORD_REWARD) revert InsufficientClanktonBalance();
        bonusWordsClaimed[currentRound][bonusWordIndex] = true;
        totalClanktonDistributed += BONUS_WORD_REWARD;
        bool success = clanktonToken.transfer(recipient, BONUS_WORD_REWARD);
        if (!success) revert ClanktonTransferFailed();
        emit BonusWordRewardDistributed(currentRound, recipient, bonusWordIndex, BONUS_WORD_REWARD);
    }

    // ============ V2: View Functions ============

    function getBonusWordsCommitHash(uint256 _roundNumber) external view returns (bytes32) {
        return bonusWordsCommitHashes[_roundNumber];
    }

    function isBonusWordClaimed(uint256 _roundNumber, uint256 _bonusWordIndex) external view returns (bool) {
        return bonusWordsClaimed[_roundNumber][_bonusWordIndex];
    }

    function getUnclaimedBonusWordsCount() external view returns (uint256) {
        uint256 claimed = 0;
        for (uint256 i = 0; i < BONUS_WORDS_PER_ROUND; i++) {
            if (bonusWordsClaimed[currentRound][i]) {
                claimed++;
            }
        }
        return BONUS_WORDS_PER_ROUND - claimed;
    }

    function getClanktonBalance() external view returns (uint256) {
        if (address(clanktonToken) == address(0)) return 0;
        return clanktonToken.balanceOf(address(this));
    }

    function getClanktonRoundsAvailable() external view returns (uint256) {
        if (address(clanktonToken) == address(0)) return 0;
        uint256 balance = clanktonToken.balanceOf(address(this));
        uint256 perRound = BONUS_WORD_REWARD * BONUS_WORDS_PER_ROUND;
        return balance / perRound;
    }

    // ============ Operator Functions ============

    function seedJackpot() external payable onlyOperator {
        if (msg.value == 0) revert InsufficientPayment();
        currentJackpot += msg.value;
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
        round.resolvedAt = block.timestamp;
        round.isActive = false;
        round.winnerPayout = jackpotAmount;
        currentJackpot = 0;
        (bool success, ) = winner.call{value: jackpotAmount}("");
        if (!success) revert PaymentFailed();
        emit RoundResolved(currentRound, winner, jackpotAmount, jackpotAmount, block.timestamp);
    }

    function resolveRoundWithPayouts(address[] calldata recipients, uint256[] calldata amounts, uint256 seedForNextRound) external onlyOperator nonReentrant roundActive {
        if (recipients.length != amounts.length) revert ArrayLengthMismatch();
        if (recipients.length > 20) revert TooManyRecipients();
        if (recipients.length == 0) revert InvalidWinnerAddress();
        address winner = recipients[0];
        if (winner == address(0)) revert InvalidWinnerAddress();
        Round storage round = rounds[currentRound];
        uint256 jackpotAmount = currentJackpot;
        uint256 totalPayout = seedForNextRound;
        for (uint256 i = 0; i < amounts.length; i++) {
            totalPayout += amounts[i];
        }
        if (totalPayout > jackpotAmount) revert PayoutsExceedJackpot();
        round.finalJackpot = jackpotAmount;
        round.winner = winner;
        round.winnerPayout = amounts[0];
        round.resolvedAt = block.timestamp;
        round.isActive = false;
        currentJackpot = seedForNextRound;
        uint256 actualPaidOut = 0;
        for (uint256 i = 0; i < recipients.length; i++) {
            if (recipients[i] != address(0) && amounts[i] > 0) {
                (bool success, ) = recipients[i].call{value: amounts[i]}("");
                if (!success) revert PaymentFailed();
                actualPaidOut += amounts[i];
                emit PayoutSent(currentRound, recipients[i], amounts[i], i);
            }
        }
        emit RoundResolvedWithPayouts(currentRound, winner, jackpotAmount, actualPaidOut, seedForNextRound, recipients.length, block.timestamp);
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

    function purchaseGuesses(address player, uint256 quantity) external payable roundActive nonReentrant {
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

    function emergencyWithdrawClankton(uint256 amount, address to) external onlyOwner {
        if (address(clanktonToken) == address(0)) revert ClanktonTokenNotSet();
        if (to == address(0)) revert ZeroAddress();
        bool success = clanktonToken.transfer(to, amount);
        if (!success) revert ClanktonTransferFailed();
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

    function getCurrentRoundInfo() external view returns (uint256 roundNumber, uint256 jackpot, bool isActive, uint256 startedAt) {
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
        if (clanktonMarketCapUsd >= MARKET_CAP_TIER_THRESHOLD) {
            return BonusTier.HIGH;
        }
        return BonusTier.LOW;
    }

    function getFreeGuessesForTier() external view returns (uint256) {
        if (clanktonMarketCapUsd >= MARKET_CAP_TIER_THRESHOLD) {
            return 3;
        }
        return 2;
    }

    function isMarketCapStale() external view returns (bool) {
        if (lastMarketCapUpdate == 0) {
            return true;
        }
        return block.timestamp > lastMarketCapUpdate + MARKET_CAP_STALENESS_THRESHOLD;
    }

    function getMarketCapInfo() external view returns (uint256 marketCap, uint256 lastUpdate, bool isStale, BonusTier tier) {
        bool stale = lastMarketCapUpdate == 0 || block.timestamp > lastMarketCapUpdate + MARKET_CAP_STALENESS_THRESHOLD;
        BonusTier currentTier = clanktonMarketCapUsd >= MARKET_CAP_TIER_THRESHOLD ? BonusTier.HIGH : BonusTier.LOW;
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

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // ============ Receive ETH ============

    receive() external payable {
        if (msg.sender == prizePoolWallet || msg.sender == operatorWallet) {
            currentJackpot += msg.value;
            emit JackpotSeeded(currentRound, msg.sender, msg.value, currentJackpot);
        }
    }
}

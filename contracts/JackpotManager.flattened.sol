// Sources flattened with hardhat v2.27.0 https://hardhat.org

// SPDX-License-Identifier: MIT

// File @openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol@v5.4.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.3.0) (proxy/utils/Initializable.sol)

pragma solidity ^0.8.20;

/**
 * @dev This is a base contract to aid in writing upgradeable contracts, or any kind of contract that will be deployed
 * behind a proxy. Since proxied contracts do not make use of a constructor, it's common to move constructor logic to an
 * external initializer function, usually called `initialize`. It then becomes necessary to protect this initializer
 * function so it can only be called once. The {initializer} modifier provided by this contract will have this effect.
 *
 * The initialization functions use a version number. Once a version number is used, it is consumed and cannot be
 * reused. This mechanism prevents re-execution of each "step" but allows the creation of new initialization steps in
 * case an upgrade adds a module that needs to be initialized.
 *
 * For example:
 *
 * [.hljs-theme-light.nopadding]
 * ```solidity
 * contract MyToken is ERC20Upgradeable {
 *     function initialize() initializer public {
 *         __ERC20_init("MyToken", "MTK");
 *     }
 * }
 *
 * contract MyTokenV2 is MyToken, ERC20PermitUpgradeable {
 *     function initializeV2() reinitializer(2) public {
 *         __ERC20Permit_init("MyToken");
 *     }
 * }
 * ```
 *
 * TIP: To avoid leaving the proxy in an uninitialized state, the initializer function should be called as early as
 * possible by providing the encoded function call as the `_data` argument to {ERC1967Proxy-constructor}.
 *
 * CAUTION: When used with inheritance, manual care must be taken to not invoke a parent initializer twice, or to ensure
 * that all initializers are idempotent. This is not verified automatically as constructors are by Solidity.
 *
 * [CAUTION]
 * ====
 * Avoid leaving a contract uninitialized.
 *
 * An uninitialized contract can be taken over by an attacker. This applies to both a proxy and its implementation
 * contract, which may impact the proxy. To prevent the implementation contract from being used, you should invoke
 * the {_disableInitializers} function in the constructor to automatically lock it when it is deployed:
 *
 * [.hljs-theme-light.nopadding]
 * ```
 * /// @custom:oz-upgrades-unsafe-allow constructor
 * constructor() {
 *     _disableInitializers();
 * }
 * ```
 * ====
 */
abstract contract Initializable {
    /**
     * @dev Storage of the initializable contract.
     *
     * It's implemented on a custom ERC-7201 namespace to reduce the risk of storage collisions
     * when using with upgradeable contracts.
     *
     * @custom:storage-location erc7201:openzeppelin.storage.Initializable
     */
    struct InitializableStorage {
        /**
         * @dev Indicates that the contract has been initialized.
         */
        uint64 _initialized;
        /**
         * @dev Indicates that the contract is in the process of being initialized.
         */
        bool _initializing;
    }

    // keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.Initializable")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant INITIALIZABLE_STORAGE = 0xf0c57e16840df040f15088dc2f81fe391c3923bec73e23a9662efc9c229c6a00;

    /**
     * @dev The contract is already initialized.
     */
    error InvalidInitialization();

    /**
     * @dev The contract is not initializing.
     */
    error NotInitializing();

    /**
     * @dev Triggered when the contract has been initialized or reinitialized.
     */
    event Initialized(uint64 version);

    /**
     * @dev A modifier that defines a protected initializer function that can be invoked at most once. In its scope,
     * `onlyInitializing` functions can be used to initialize parent contracts.
     *
     * Similar to `reinitializer(1)`, except that in the context of a constructor an `initializer` may be invoked any
     * number of times. This behavior in the constructor can be useful during testing and is not expected to be used in
     * production.
     *
     * Emits an {Initialized} event.
     */
    modifier initializer() {
        // solhint-disable-next-line var-name-mixedcase
        InitializableStorage storage $ = _getInitializableStorage();

        // Cache values to avoid duplicated sloads
        bool isTopLevelCall = !$._initializing;
        uint64 initialized = $._initialized;

        // Allowed calls:
        // - initialSetup: the contract is not in the initializing state and no previous version was
        //                 initialized
        // - construction: the contract is initialized at version 1 (no reinitialization) and the
        //                 current contract is just being deployed
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

    /**
     * @dev A modifier that defines a protected reinitializer function that can be invoked at most once, and only if the
     * contract hasn't been initialized to a greater version before. In its scope, `onlyInitializing` functions can be
     * used to initialize parent contracts.
     *
     * A reinitializer may be used after the original initialization step. This is essential to configure modules that
     * are added through upgrades and that require initialization.
     *
     * When `version` is 1, this modifier is similar to `initializer`, except that functions marked with `reinitializer`
     * cannot be nested. If one is invoked in the context of another, execution will revert.
     *
     * Note that versions can jump in increments greater than 1; this implies that if multiple reinitializers coexist in
     * a contract, executing them in the right order is up to the developer or operator.
     *
     * WARNING: Setting the version to 2**64 - 1 will prevent any future reinitialization.
     *
     * Emits an {Initialized} event.
     */
    modifier reinitializer(uint64 version) {
        // solhint-disable-next-line var-name-mixedcase
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

    /**
     * @dev Modifier to protect an initialization function so that it can only be invoked by functions with the
     * {initializer} and {reinitializer} modifiers, directly or indirectly.
     */
    modifier onlyInitializing() {
        _checkInitializing();
        _;
    }

    /**
     * @dev Reverts if the contract is not in an initializing state. See {onlyInitializing}.
     */
    function _checkInitializing() internal view virtual {
        if (!_isInitializing()) {
            revert NotInitializing();
        }
    }

    /**
     * @dev Locks the contract, preventing any future reinitialization. This cannot be part of an initializer call.
     * Calling this in the constructor of a contract will prevent that contract from being initialized or reinitialized
     * to any version. It is recommended to use this to lock implementation contracts that are designed to be called
     * through proxies.
     *
     * Emits an {Initialized} event the first time it is successfully executed.
     */
    function _disableInitializers() internal virtual {
        // solhint-disable-next-line var-name-mixedcase
        InitializableStorage storage $ = _getInitializableStorage();

        if ($._initializing) {
            revert InvalidInitialization();
        }
        if ($._initialized != type(uint64).max) {
            $._initialized = type(uint64).max;
            emit Initialized(type(uint64).max);
        }
    }

    /**
     * @dev Returns the highest version that has been initialized. See {reinitializer}.
     */
    function _getInitializedVersion() internal view returns (uint64) {
        return _getInitializableStorage()._initialized;
    }

    /**
     * @dev Returns `true` if the contract is currently initializing. See {onlyInitializing}.
     */
    function _isInitializing() internal view returns (bool) {
        return _getInitializableStorage()._initializing;
    }

    /**
     * @dev Pointer to storage slot. Allows integrators to override it with a custom storage location.
     *
     * NOTE: Consider following the ERC-7201 formula to derive storage locations.
     */
    function _initializableStorageSlot() internal pure virtual returns (bytes32) {
        return INITIALIZABLE_STORAGE;
    }

    /**
     * @dev Returns a pointer to the storage namespace.
     */
    // solhint-disable-next-line var-name-mixedcase
    function _getInitializableStorage() private pure returns (InitializableStorage storage $) {
        bytes32 slot = _initializableStorageSlot();
        assembly {
            $.slot := slot
        }
    }
}


// File @openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol@v5.4.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.0.1) (utils/Context.sol)

pragma solidity ^0.8.20;

/**
 * @dev Provides information about the current execution context, including the
 * sender of the transaction and its data. While these are generally available
 * via msg.sender and msg.data, they should not be accessed in such a direct
 * manner, since when dealing with meta-transactions the account sending and
 * paying for execution may not be the actual sender (as far as an application
 * is concerned).
 *
 * This contract is only required for intermediate, library-like contracts.
 */
abstract contract ContextUpgradeable is Initializable {
    function __Context_init() internal onlyInitializing {
    }

    function __Context_init_unchained() internal onlyInitializing {
    }
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


// File @openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol@v5.4.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.0.0) (access/Ownable.sol)

pragma solidity ^0.8.20;


/**
 * @dev Contract module which provides a basic access control mechanism, where
 * there is an account (an owner) that can be granted exclusive access to
 * specific functions.
 *
 * The initial owner is set to the address provided by the deployer. This can
 * later be changed with {transferOwnership}.
 *
 * This module is used through inheritance. It will make available the modifier
 * `onlyOwner`, which can be applied to your functions to restrict their use to
 * the owner.
 */
abstract contract OwnableUpgradeable is Initializable, ContextUpgradeable {
    /// @custom:storage-location erc7201:openzeppelin.storage.Ownable
    struct OwnableStorage {
        address _owner;
    }

    // keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.Ownable")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant OwnableStorageLocation = 0x9016d09d72d40fdae2fd8ceac6b6234c7706214fd39c1cd1e609a0528c199300;

    function _getOwnableStorage() private pure returns (OwnableStorage storage $) {
        assembly {
            $.slot := OwnableStorageLocation
        }
    }

    /**
     * @dev The caller account is not authorized to perform an operation.
     */
    error OwnableUnauthorizedAccount(address account);

    /**
     * @dev The owner is not a valid owner account. (eg. `address(0)`)
     */
    error OwnableInvalidOwner(address owner);

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /**
     * @dev Initializes the contract setting the address provided by the deployer as the initial owner.
     */
    function __Ownable_init(address initialOwner) internal onlyInitializing {
        __Ownable_init_unchained(initialOwner);
    }

    function __Ownable_init_unchained(address initialOwner) internal onlyInitializing {
        if (initialOwner == address(0)) {
            revert OwnableInvalidOwner(address(0));
        }
        _transferOwnership(initialOwner);
    }

    /**
     * @dev Throws if called by any account other than the owner.
     */
    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    /**
     * @dev Returns the address of the current owner.
     */
    function owner() public view virtual returns (address) {
        OwnableStorage storage $ = _getOwnableStorage();
        return $._owner;
    }

    /**
     * @dev Throws if the sender is not the owner.
     */
    function _checkOwner() internal view virtual {
        if (owner() != _msgSender()) {
            revert OwnableUnauthorizedAccount(_msgSender());
        }
    }

    /**
     * @dev Leaves the contract without owner. It will not be possible to call
     * `onlyOwner` functions. Can only be called by the current owner.
     *
     * NOTE: Renouncing ownership will leave the contract without an owner,
     * thereby disabling any functionality that is only available to the owner.
     */
    function renounceOwnership() public virtual onlyOwner {
        _transferOwnership(address(0));
    }

    /**
     * @dev Transfers ownership of the contract to a new account (`newOwner`).
     * Can only be called by the current owner.
     */
    function transferOwnership(address newOwner) public virtual onlyOwner {
        if (newOwner == address(0)) {
            revert OwnableInvalidOwner(address(0));
        }
        _transferOwnership(newOwner);
    }

    /**
     * @dev Transfers ownership of the contract to a new account (`newOwner`).
     * Internal function without access restriction.
     */
    function _transferOwnership(address newOwner) internal virtual {
        OwnableStorage storage $ = _getOwnableStorage();
        address oldOwner = $._owner;
        $._owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }
}


// File @openzeppelin/contracts/interfaces/draft-IERC1822.sol@v5.4.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.4.0) (interfaces/draft-IERC1822.sol)

pragma solidity >=0.4.16;

/**
 * @dev ERC-1822: Universal Upgradeable Proxy Standard (UUPS) documents a method for upgradeability through a simplified
 * proxy whose upgrades are fully controlled by the current implementation.
 */
interface IERC1822Proxiable {
    /**
     * @dev Returns the storage slot that the proxiable contract assumes is being used to store the implementation
     * address.
     *
     * IMPORTANT: A proxy pointing at a proxiable contract should not be considered proxiable itself, because this risks
     * bricking a proxy that upgrades to it, by delegating to itself until out of gas. Thus it is critical that this
     * function revert if invoked through a proxy.
     */
    function proxiableUUID() external view returns (bytes32);
}


// File @openzeppelin/contracts/interfaces/IERC1967.sol@v5.4.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.4.0) (interfaces/IERC1967.sol)

pragma solidity >=0.4.11;

/**
 * @dev ERC-1967: Proxy Storage Slots. This interface contains the events defined in the ERC.
 */
interface IERC1967 {
    /**
     * @dev Emitted when the implementation is upgraded.
     */
    event Upgraded(address indexed implementation);

    /**
     * @dev Emitted when the admin account has changed.
     */
    event AdminChanged(address previousAdmin, address newAdmin);

    /**
     * @dev Emitted when the beacon is changed.
     */
    event BeaconUpgraded(address indexed beacon);
}


// File @openzeppelin/contracts/proxy/beacon/IBeacon.sol@v5.4.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.4.0) (proxy/beacon/IBeacon.sol)

pragma solidity >=0.4.16;

/**
 * @dev This is the interface that {BeaconProxy} expects of its beacon.
 */
interface IBeacon {
    /**
     * @dev Must return an address that can be used as a delegate call target.
     *
     * {UpgradeableBeacon} will check that this address is a contract.
     */
    function implementation() external view returns (address);
}


// File @openzeppelin/contracts/utils/Errors.sol@v5.4.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.1.0) (utils/Errors.sol)

pragma solidity ^0.8.20;

/**
 * @dev Collection of common custom errors used in multiple contracts
 *
 * IMPORTANT: Backwards compatibility is not guaranteed in future versions of the library.
 * It is recommended to avoid relying on the error API for critical functionality.
 *
 * _Available since v5.1._
 */
library Errors {
    /**
     * @dev The ETH balance of the account is not enough to perform the operation.
     */
    error InsufficientBalance(uint256 balance, uint256 needed);

    /**
     * @dev A call to an address target failed. The target may have reverted.
     */
    error FailedCall();

    /**
     * @dev The deployment failed.
     */
    error FailedDeployment();

    /**
     * @dev A necessary precompile is missing.
     */
    error MissingPrecompile(address);
}


// File @openzeppelin/contracts/utils/Address.sol@v5.4.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.4.0) (utils/Address.sol)

pragma solidity ^0.8.20;

/**
 * @dev Collection of functions related to the address type
 */
library Address {
    /**
     * @dev There's no code at `target` (it is not a contract).
     */
    error AddressEmptyCode(address target);

    /**
     * @dev Replacement for Solidity's `transfer`: sends `amount` wei to
     * `recipient`, forwarding all available gas and reverting on errors.
     *
     * https://eips.ethereum.org/EIPS/eip-1884[EIP1884] increases the gas cost
     * of certain opcodes, possibly making contracts go over the 2300 gas limit
     * imposed by `transfer`, making them unable to receive funds via
     * `transfer`. {sendValue} removes this limitation.
     *
     * https://consensys.net/diligence/blog/2019/09/stop-using-soliditys-transfer-now/[Learn more].
     *
     * IMPORTANT: because control is transferred to `recipient`, care must be
     * taken to not create reentrancy vulnerabilities. Consider using
     * {ReentrancyGuard} or the
     * https://solidity.readthedocs.io/en/v0.8.20/security-considerations.html#use-the-checks-effects-interactions-pattern[checks-effects-interactions pattern].
     */
    function sendValue(address payable recipient, uint256 amount) internal {
        if (address(this).balance < amount) {
            revert Errors.InsufficientBalance(address(this).balance, amount);
        }

        (bool success, bytes memory returndata) = recipient.call{value: amount}("");
        if (!success) {
            _revert(returndata);
        }
    }

    /**
     * @dev Performs a Solidity function call using a low level `call`. A
     * plain `call` is an unsafe replacement for a function call: use this
     * function instead.
     *
     * If `target` reverts with a revert reason or custom error, it is bubbled
     * up by this function (like regular Solidity function calls). However, if
     * the call reverted with no returned reason, this function reverts with a
     * {Errors.FailedCall} error.
     *
     * Returns the raw returned data. To convert to the expected return value,
     * use https://solidity.readthedocs.io/en/latest/units-and-global-variables.html?highlight=abi.decode#abi-encoding-and-decoding-functions[`abi.decode`].
     *
     * Requirements:
     *
     * - `target` must be a contract.
     * - calling `target` with `data` must not revert.
     */
    function functionCall(address target, bytes memory data) internal returns (bytes memory) {
        return functionCallWithValue(target, data, 0);
    }

    /**
     * @dev Same as {xref-Address-functionCall-address-bytes-}[`functionCall`],
     * but also transferring `value` wei to `target`.
     *
     * Requirements:
     *
     * - the calling contract must have an ETH balance of at least `value`.
     * - the called Solidity function must be `payable`.
     */
    function functionCallWithValue(address target, bytes memory data, uint256 value) internal returns (bytes memory) {
        if (address(this).balance < value) {
            revert Errors.InsufficientBalance(address(this).balance, value);
        }
        (bool success, bytes memory returndata) = target.call{value: value}(data);
        return verifyCallResultFromTarget(target, success, returndata);
    }

    /**
     * @dev Same as {xref-Address-functionCall-address-bytes-}[`functionCall`],
     * but performing a static call.
     */
    function functionStaticCall(address target, bytes memory data) internal view returns (bytes memory) {
        (bool success, bytes memory returndata) = target.staticcall(data);
        return verifyCallResultFromTarget(target, success, returndata);
    }

    /**
     * @dev Same as {xref-Address-functionCall-address-bytes-}[`functionCall`],
     * but performing a delegate call.
     */
    function functionDelegateCall(address target, bytes memory data) internal returns (bytes memory) {
        (bool success, bytes memory returndata) = target.delegatecall(data);
        return verifyCallResultFromTarget(target, success, returndata);
    }

    /**
     * @dev Tool to verify that a low level call to smart-contract was successful, and reverts if the target
     * was not a contract or bubbling up the revert reason (falling back to {Errors.FailedCall}) in case
     * of an unsuccessful call.
     */
    function verifyCallResultFromTarget(
        address target,
        bool success,
        bytes memory returndata
    ) internal view returns (bytes memory) {
        if (!success) {
            _revert(returndata);
        } else {
            // only check if target is a contract if the call was successful and the return data is empty
            // otherwise we already know that it was a contract
            if (returndata.length == 0 && target.code.length == 0) {
                revert AddressEmptyCode(target);
            }
            return returndata;
        }
    }

    /**
     * @dev Tool to verify that a low level call was successful, and reverts if it wasn't, either by bubbling the
     * revert reason or with a default {Errors.FailedCall} error.
     */
    function verifyCallResult(bool success, bytes memory returndata) internal pure returns (bytes memory) {
        if (!success) {
            _revert(returndata);
        } else {
            return returndata;
        }
    }

    /**
     * @dev Reverts with returndata if present. Otherwise reverts with {Errors.FailedCall}.
     */
    function _revert(bytes memory returndata) private pure {
        // Look for revert reason and bubble it up if present
        if (returndata.length > 0) {
            // The easiest way to bubble the revert reason is using memory via assembly
            assembly ("memory-safe") {
                revert(add(returndata, 0x20), mload(returndata))
            }
        } else {
            revert Errors.FailedCall();
        }
    }
}


// File @openzeppelin/contracts/utils/StorageSlot.sol@v5.4.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.1.0) (utils/StorageSlot.sol)
// This file was procedurally generated from scripts/generate/templates/StorageSlot.js.

pragma solidity ^0.8.20;

/**
 * @dev Library for reading and writing primitive types to specific storage slots.
 *
 * Storage slots are often used to avoid storage conflict when dealing with upgradeable contracts.
 * This library helps with reading and writing to such slots without the need for inline assembly.
 *
 * The functions in this library return Slot structs that contain a `value` member that can be used to read or write.
 *
 * Example usage to set ERC-1967 implementation slot:
 * ```solidity
 * contract ERC1967 {
 *     // Define the slot. Alternatively, use the SlotDerivation library to derive the slot.
 *     bytes32 internal constant _IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
 *
 *     function _getImplementation() internal view returns (address) {
 *         return StorageSlot.getAddressSlot(_IMPLEMENTATION_SLOT).value;
 *     }
 *
 *     function _setImplementation(address newImplementation) internal {
 *         require(newImplementation.code.length > 0);
 *         StorageSlot.getAddressSlot(_IMPLEMENTATION_SLOT).value = newImplementation;
 *     }
 * }
 * ```
 *
 * TIP: Consider using this library along with {SlotDerivation}.
 */
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

    struct Int256Slot {
        int256 value;
    }

    struct StringSlot {
        string value;
    }

    struct BytesSlot {
        bytes value;
    }

    /**
     * @dev Returns an `AddressSlot` with member `value` located at `slot`.
     */
    function getAddressSlot(bytes32 slot) internal pure returns (AddressSlot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns a `BooleanSlot` with member `value` located at `slot`.
     */
    function getBooleanSlot(bytes32 slot) internal pure returns (BooleanSlot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns a `Bytes32Slot` with member `value` located at `slot`.
     */
    function getBytes32Slot(bytes32 slot) internal pure returns (Bytes32Slot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns a `Uint256Slot` with member `value` located at `slot`.
     */
    function getUint256Slot(bytes32 slot) internal pure returns (Uint256Slot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns a `Int256Slot` with member `value` located at `slot`.
     */
    function getInt256Slot(bytes32 slot) internal pure returns (Int256Slot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns a `StringSlot` with member `value` located at `slot`.
     */
    function getStringSlot(bytes32 slot) internal pure returns (StringSlot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns an `StringSlot` representation of the string storage pointer `store`.
     */
    function getStringSlot(string storage store) internal pure returns (StringSlot storage r) {
        assembly ("memory-safe") {
            r.slot := store.slot
        }
    }

    /**
     * @dev Returns a `BytesSlot` with member `value` located at `slot`.
     */
    function getBytesSlot(bytes32 slot) internal pure returns (BytesSlot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns an `BytesSlot` representation of the bytes storage pointer `store`.
     */
    function getBytesSlot(bytes storage store) internal pure returns (BytesSlot storage r) {
        assembly ("memory-safe") {
            r.slot := store.slot
        }
    }
}


// File @openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol@v5.4.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.4.0) (proxy/ERC1967/ERC1967Utils.sol)

pragma solidity ^0.8.21;




/**
 * @dev This library provides getters and event emitting update functions for
 * https://eips.ethereum.org/EIPS/eip-1967[ERC-1967] slots.
 */
library ERC1967Utils {
    /**
     * @dev Storage slot with the address of the current implementation.
     * This is the keccak-256 hash of "eip1967.proxy.implementation" subtracted by 1.
     */
    // solhint-disable-next-line private-vars-leading-underscore
    bytes32 internal constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    /**
     * @dev The `implementation` of the proxy is invalid.
     */
    error ERC1967InvalidImplementation(address implementation);

    /**
     * @dev The `admin` of the proxy is invalid.
     */
    error ERC1967InvalidAdmin(address admin);

    /**
     * @dev The `beacon` of the proxy is invalid.
     */
    error ERC1967InvalidBeacon(address beacon);

    /**
     * @dev An upgrade function sees `msg.value > 0` that may be lost.
     */
    error ERC1967NonPayable();

    /**
     * @dev Returns the current implementation address.
     */
    function getImplementation() internal view returns (address) {
        return StorageSlot.getAddressSlot(IMPLEMENTATION_SLOT).value;
    }

    /**
     * @dev Stores a new address in the ERC-1967 implementation slot.
     */
    function _setImplementation(address newImplementation) private {
        if (newImplementation.code.length == 0) {
            revert ERC1967InvalidImplementation(newImplementation);
        }
        StorageSlot.getAddressSlot(IMPLEMENTATION_SLOT).value = newImplementation;
    }

    /**
     * @dev Performs implementation upgrade with additional setup call if data is nonempty.
     * This function is payable only if the setup call is performed, otherwise `msg.value` is rejected
     * to avoid stuck value in the contract.
     *
     * Emits an {IERC1967-Upgraded} event.
     */
    function upgradeToAndCall(address newImplementation, bytes memory data) internal {
        _setImplementation(newImplementation);
        emit IERC1967.Upgraded(newImplementation);

        if (data.length > 0) {
            Address.functionDelegateCall(newImplementation, data);
        } else {
            _checkNonPayable();
        }
    }

    /**
     * @dev Storage slot with the admin of the contract.
     * This is the keccak-256 hash of "eip1967.proxy.admin" subtracted by 1.
     */
    // solhint-disable-next-line private-vars-leading-underscore
    bytes32 internal constant ADMIN_SLOT = 0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;

    /**
     * @dev Returns the current admin.
     *
     * TIP: To get this value clients can read directly from the storage slot shown below (specified by ERC-1967) using
     * the https://eth.wiki/json-rpc/API#eth_getstorageat[`eth_getStorageAt`] RPC call.
     * `0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103`
     */
    function getAdmin() internal view returns (address) {
        return StorageSlot.getAddressSlot(ADMIN_SLOT).value;
    }

    /**
     * @dev Stores a new address in the ERC-1967 admin slot.
     */
    function _setAdmin(address newAdmin) private {
        if (newAdmin == address(0)) {
            revert ERC1967InvalidAdmin(address(0));
        }
        StorageSlot.getAddressSlot(ADMIN_SLOT).value = newAdmin;
    }

    /**
     * @dev Changes the admin of the proxy.
     *
     * Emits an {IERC1967-AdminChanged} event.
     */
    function changeAdmin(address newAdmin) internal {
        emit IERC1967.AdminChanged(getAdmin(), newAdmin);
        _setAdmin(newAdmin);
    }

    /**
     * @dev The storage slot of the UpgradeableBeacon contract which defines the implementation for this proxy.
     * This is the keccak-256 hash of "eip1967.proxy.beacon" subtracted by 1.
     */
    // solhint-disable-next-line private-vars-leading-underscore
    bytes32 internal constant BEACON_SLOT = 0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50;

    /**
     * @dev Returns the current beacon.
     */
    function getBeacon() internal view returns (address) {
        return StorageSlot.getAddressSlot(BEACON_SLOT).value;
    }

    /**
     * @dev Stores a new beacon in the ERC-1967 beacon slot.
     */
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

    /**
     * @dev Change the beacon and trigger a setup call if data is nonempty.
     * This function is payable only if the setup call is performed, otherwise `msg.value` is rejected
     * to avoid stuck value in the contract.
     *
     * Emits an {IERC1967-BeaconUpgraded} event.
     *
     * CAUTION: Invoking this function has no effect on an instance of {BeaconProxy} since v5, since
     * it uses an immutable beacon without looking at the value of the ERC-1967 beacon slot for
     * efficiency.
     */
    function upgradeBeaconToAndCall(address newBeacon, bytes memory data) internal {
        _setBeacon(newBeacon);
        emit IERC1967.BeaconUpgraded(newBeacon);

        if (data.length > 0) {
            Address.functionDelegateCall(IBeacon(newBeacon).implementation(), data);
        } else {
            _checkNonPayable();
        }
    }

    /**
     * @dev Reverts if `msg.value` is not zero. It can be used to avoid `msg.value` stuck in the contract
     * if an upgrade doesn't perform an initialization call.
     */
    function _checkNonPayable() private {
        if (msg.value > 0) {
            revert ERC1967NonPayable();
        }
    }
}


// File @openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol@v5.4.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.3.0) (proxy/utils/UUPSUpgradeable.sol)

pragma solidity ^0.8.22;



/**
 * @dev An upgradeability mechanism designed for UUPS proxies. The functions included here can perform an upgrade of an
 * {ERC1967Proxy}, when this contract is set as the implementation behind such a proxy.
 *
 * A security mechanism ensures that an upgrade does not turn off upgradeability accidentally, although this risk is
 * reinstated if the upgrade retains upgradeability but removes the security mechanism, e.g. by replacing
 * `UUPSUpgradeable` with a custom implementation of upgrades.
 *
 * The {_authorizeUpgrade} function must be overridden to include access restriction to the upgrade mechanism.
 */
abstract contract UUPSUpgradeable is Initializable, IERC1822Proxiable {
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    address private immutable __self = address(this);

    /**
     * @dev The version of the upgrade interface of the contract. If this getter is missing, both `upgradeTo(address)`
     * and `upgradeToAndCall(address,bytes)` are present, and `upgradeTo` must be used if no function should be called,
     * while `upgradeToAndCall` will invoke the `receive` function if the second argument is the empty byte string.
     * If the getter returns `"5.0.0"`, only `upgradeToAndCall(address,bytes)` is present, and the second argument must
     * be the empty byte string if no function should be called, making it impossible to invoke the `receive` function
     * during an upgrade.
     */
    string public constant UPGRADE_INTERFACE_VERSION = "5.0.0";

    /**
     * @dev The call is from an unauthorized context.
     */
    error UUPSUnauthorizedCallContext();

    /**
     * @dev The storage `slot` is unsupported as a UUID.
     */
    error UUPSUnsupportedProxiableUUID(bytes32 slot);

    /**
     * @dev Check that the execution is being performed through a delegatecall call and that the execution context is
     * a proxy contract with an implementation (as defined in ERC-1967) pointing to self. This should only be the case
     * for UUPS and transparent proxies that are using the current contract as their implementation. Execution of a
     * function through ERC-1167 minimal proxies (clones) would not normally pass this test, but is not guaranteed to
     * fail.
     */
    modifier onlyProxy() {
        _checkProxy();
        _;
    }

    /**
     * @dev Check that the execution is not being performed through a delegate call. This allows a function to be
     * callable on the implementing contract but not through proxies.
     */
    modifier notDelegated() {
        _checkNotDelegated();
        _;
    }

    function __UUPSUpgradeable_init() internal onlyInitializing {
    }

    function __UUPSUpgradeable_init_unchained() internal onlyInitializing {
    }
    /**
     * @dev Implementation of the ERC-1822 {proxiableUUID} function. This returns the storage slot used by the
     * implementation. It is used to validate the implementation's compatibility when performing an upgrade.
     *
     * IMPORTANT: A proxy pointing at a proxiable contract should not be considered proxiable itself, because this risks
     * bricking a proxy that upgrades to it, by delegating to itself until out of gas. Thus it is critical that this
     * function revert if invoked through a proxy. This is guaranteed by the `notDelegated` modifier.
     */
    function proxiableUUID() external view virtual notDelegated returns (bytes32) {
        return ERC1967Utils.IMPLEMENTATION_SLOT;
    }

    /**
     * @dev Upgrade the implementation of the proxy to `newImplementation`, and subsequently execute the function call
     * encoded in `data`.
     *
     * Calls {_authorizeUpgrade}.
     *
     * Emits an {Upgraded} event.
     *
     * @custom:oz-upgrades-unsafe-allow-reachable delegatecall
     */
    function upgradeToAndCall(address newImplementation, bytes memory data) public payable virtual onlyProxy {
        _authorizeUpgrade(newImplementation);
        _upgradeToAndCallUUPS(newImplementation, data);
    }

    /**
     * @dev Reverts if the execution is not performed via delegatecall or the execution
     * context is not of a proxy with an ERC-1967 compliant implementation pointing to self.
     */
    function _checkProxy() internal view virtual {
        if (
            address(this) == __self || // Must be called through delegatecall
            ERC1967Utils.getImplementation() != __self // Must be called through an active proxy
        ) {
            revert UUPSUnauthorizedCallContext();
        }
    }

    /**
     * @dev Reverts if the execution is performed via delegatecall.
     * See {notDelegated}.
     */
    function _checkNotDelegated() internal view virtual {
        if (address(this) != __self) {
            // Must not be called through delegatecall
            revert UUPSUnauthorizedCallContext();
        }
    }

    /**
     * @dev Function that should revert when `msg.sender` is not authorized to upgrade the contract. Called by
     * {upgradeToAndCall}.
     *
     * Normally, this function will use an xref:access.adoc[access control] modifier such as {Ownable-onlyOwner}.
     *
     * ```solidity
     * function _authorizeUpgrade(address) internal onlyOwner {}
     * ```
     */
    function _authorizeUpgrade(address newImplementation) internal virtual;

    /**
     * @dev Performs an implementation upgrade with a security check for UUPS proxies, and additional setup call.
     *
     * As a security check, {proxiableUUID} is invoked in the new implementation, and the return value
     * is expected to be the implementation slot in ERC-1967.
     *
     * Emits an {IERC1967-Upgraded} event.
     */
    function _upgradeToAndCallUUPS(address newImplementation, bytes memory data) private {
        try IERC1822Proxiable(newImplementation).proxiableUUID() returns (bytes32 slot) {
            if (slot != ERC1967Utils.IMPLEMENTATION_SLOT) {
                revert UUPSUnsupportedProxiableUUID(slot);
            }
            ERC1967Utils.upgradeToAndCall(newImplementation, data);
        } catch {
            // The implementation is not UUPS
            revert ERC1967Utils.ERC1967InvalidImplementation(newImplementation);
        }
    }
}


// File @openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol@v5.4.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.1.0) (utils/ReentrancyGuard.sol)

pragma solidity ^0.8.20;

/**
 * @dev Contract module that helps prevent reentrant calls to a function.
 *
 * Inheriting from `ReentrancyGuard` will make the {nonReentrant} modifier
 * available, which can be applied to functions to make sure there are no nested
 * (reentrant) calls to them.
 *
 * Note that because there is a single `nonReentrant` guard, functions marked as
 * `nonReentrant` may not call one another. This can be worked around by making
 * those functions `private`, and then adding `external` `nonReentrant` entry
 * points to them.
 *
 * TIP: If EIP-1153 (transient storage) is available on the chain you're deploying at,
 * consider using {ReentrancyGuardTransient} instead.
 *
 * TIP: If you would like to learn more about reentrancy and alternative ways
 * to protect against it, check out our blog post
 * https://blog.openzeppelin.com/reentrancy-after-istanbul/[Reentrancy After Istanbul].
 */
abstract contract ReentrancyGuardUpgradeable is Initializable {
    // Booleans are more expensive than uint256 or any type that takes up a full
    // word because each write operation emits an extra SLOAD to first read the
    // slot's contents, replace the bits taken up by the boolean, and then write
    // back. This is the compiler's defense against contract upgrades and
    // pointer aliasing, and it cannot be disabled.

    // The values being non-zero value makes deployment a bit more expensive,
    // but in exchange the refund on every call to nonReentrant will be lower in
    // amount. Since refunds are capped to a percentage of the total
    // transaction's gas, it is best to keep them low in cases like this one, to
    // increase the likelihood of the full refund coming into effect.
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;

    /// @custom:storage-location erc7201:openzeppelin.storage.ReentrancyGuard
    struct ReentrancyGuardStorage {
        uint256 _status;
    }

    // keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.ReentrancyGuard")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant ReentrancyGuardStorageLocation = 0x9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00;

    function _getReentrancyGuardStorage() private pure returns (ReentrancyGuardStorage storage $) {
        assembly {
            $.slot := ReentrancyGuardStorageLocation
        }
    }

    /**
     * @dev Unauthorized reentrant call.
     */
    error ReentrancyGuardReentrantCall();

    function __ReentrancyGuard_init() internal onlyInitializing {
        __ReentrancyGuard_init_unchained();
    }

    function __ReentrancyGuard_init_unchained() internal onlyInitializing {
        ReentrancyGuardStorage storage $ = _getReentrancyGuardStorage();
        $._status = NOT_ENTERED;
    }

    /**
     * @dev Prevents a contract from calling itself, directly or indirectly.
     * Calling a `nonReentrant` function from another `nonReentrant`
     * function is not supported. It is possible to prevent this from happening
     * by making the `nonReentrant` function external, and making it call a
     * `private` function that does the actual work.
     */
    modifier nonReentrant() {
        _nonReentrantBefore();
        _;
        _nonReentrantAfter();
    }

    function _nonReentrantBefore() private {
        ReentrancyGuardStorage storage $ = _getReentrancyGuardStorage();
        // On the first call to nonReentrant, _status will be NOT_ENTERED
        if ($._status == ENTERED) {
            revert ReentrancyGuardReentrantCall();
        }

        // Any calls to nonReentrant after this point will fail
        $._status = ENTERED;
    }

    function _nonReentrantAfter() private {
        ReentrancyGuardStorage storage $ = _getReentrancyGuardStorage();
        // By storing the original value once again, a refund is triggered (see
        // https://eips.ethereum.org/EIPS/eip-2200)
        $._status = NOT_ENTERED;
    }

    /**
     * @dev Returns true if the reentrancy guard is currently set to "entered", which indicates there is a
     * `nonReentrant` function in the call stack.
     */
    function _reentrancyGuardEntered() internal view returns (bool) {
        ReentrancyGuardStorage storage $ = _getReentrancyGuardStorage();
        return $._status == ENTERED;
    }
}


// File src/JackpotManager.sol

// Original license: SPDX_License_Identifier: MIT
pragma solidity ^0.8.24;




/**
 * @title JackpotManager
 * @notice Manages jackpots, paid guesses, and payouts for Let's Have A Word game
 * @dev Milestone 6.1 - Smart Contract Specification
 *      Milestone 6.2 - CLANKTON Market Cap Oracle Integration
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

    /// @notice Market cap threshold for HIGH bonus tier ($250,000 with 8 decimals)
    uint256 public constant MARKET_CAP_TIER_THRESHOLD = 250_000 * 1e8;

    /// @notice Maximum age for market cap data before considered stale (1 hour)
    uint256 public constant MARKET_CAP_STALENESS_THRESHOLD = 1 hours;

    // ============ Enums ============

    /// @notice Bonus tier based on CLANKTON market cap
    enum BonusTier {
        LOW,  // 2 free guesses per day for CLANKTON holders
        HIGH  // 3 free guesses per day for CLANKTON holders
    }

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

    /// @notice CLANKTON market cap in USD (8 decimals precision)
    uint256 public clanktonMarketCapUsd;

    /// @notice Timestamp of last market cap update
    uint256 public lastMarketCapUpdate;

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
     * @notice Resolves the current round with multiple payouts (Milestone 6.9)
     * @dev Only callable by operator. Backend calculates all payout amounts.
     *
     * Distribution logic (handled by backend):
     * - Winner always receives 80% of jackpot
     * - Top 10 guessers split 10% (or 17.5% if no referrer)
     * - Referrer receives 10% (if winner has one)
     * - If no referrer: 7.5% added to top guessers, 2.5% to seed
     *
     * @param recipients Array of recipient wallet addresses (winner first, then others)
     * @param amounts Array of amounts to pay each recipient (in wei)
     * @param seedForNextRound Amount to keep as seed for next round (in wei)
     *
     * Requirements:
     * - recipients.length == amounts.length
     * - sum(amounts) + seedForNextRound <= currentJackpot
     * - recipients.length <= 20 (gas limit safety)
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
     * @dev Requires minimum seed to be met. Called by operator.
     * @dev DEPRECATED: Use startRoundWithCommitment for provably fair rounds
     */
    function startNextRound() external onlyOperator {
        if (currentRound > 0 && rounds[currentRound].isActive) revert RoundAlreadyActive();
        if (currentJackpot < MINIMUM_SEED) revert InsufficientSeed();

        _startNewRound(bytes32(0));
    }

    /**
     * @notice Starts a new round with onchain commitment for provably fair verification
     * @dev Requires minimum seed to be met. Called by operator.
     * @param _commitHash SHA-256 hash of (salt || answer) - committed before any guesses
     *
     * The commitment scheme works as follows:
     * 1. Backend generates random salt (32 bytes) and selects answer word
     * 2. Backend computes commitHash = SHA-256(salt || answer)
     * 3. Backend calls this function with commitHash (stored immutably onchain)
     * 4. Round plays out - players make guesses
     * 5. When round resolves, backend reveals salt and answer
     * 6. Anyone can verify: SHA-256(salt || answer) == onchain commitHash
     *
     * This proves the answer was locked before any guesses were made.
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

    /**
     * @notice Get the onchain commitment hash for a round
     * @dev Returns bytes32(0) for rounds created before onchain commitment was implemented
     * @param _roundNumber The round number to query
     * @return The SHA-256 commitment hash (salt || answer)
     */
    function getCommitHash(uint256 _roundNumber) external view returns (bytes32) {
        return rounds[_roundNumber].commitHash;
    }

    /**
     * @notice Check if a round has an onchain commitment
     * @param _roundNumber The round number to query
     * @return True if the round has a non-zero commitment hash
     */
    function hasOnChainCommitment(uint256 _roundNumber) external view returns (bool) {
        return rounds[_roundNumber].commitHash != bytes32(0);
    }

    // ============ Oracle Functions (Milestone 6.2) ============

    /**
     * @notice Updates the CLANKTON market cap from oracle
     * @dev Only callable by operator. Used to determine bonus tier for CLANKTON holders.
     * @param marketCapUsd The market cap in USD (with 8 decimals)
     *
     * Bonus tiers:
     * - mcap < $250,000: LOW tier (2 free guesses/day for CLANKTON holders)
     * - mcap >= $250,000: HIGH tier (3 free guesses/day for CLANKTON holders)
     */
    function updateClanktonMarketCap(uint256 marketCapUsd) external onlyOperator {
        clanktonMarketCapUsd = marketCapUsd;
        lastMarketCapUpdate = block.timestamp;

        emit MarketCapUpdated(marketCapUsd, block.timestamp);
    }

    /**
     * @notice Gets the current bonus tier based on CLANKTON market cap
     * @return tier The current bonus tier (LOW or HIGH)
     */
    function getCurrentBonusTier() external view returns (BonusTier) {
        if (clanktonMarketCapUsd >= MARKET_CAP_TIER_THRESHOLD) {
            return BonusTier.HIGH;
        }
        return BonusTier.LOW;
    }

    /**
     * @notice Gets the number of free guesses for CLANKTON holders based on current tier
     * @return Number of free guesses per day (2 for LOW, 3 for HIGH)
     */
    function getFreeGuessesForTier() external view returns (uint256) {
        if (clanktonMarketCapUsd >= MARKET_CAP_TIER_THRESHOLD) {
            return 3;
        }
        return 2;
    }

    /**
     * @notice Checks if the market cap data is stale (older than 1 hour)
     * @return True if market cap data is stale or never set
     */
    function isMarketCapStale() external view returns (bool) {
        if (lastMarketCapUpdate == 0) {
            return true;
        }
        return block.timestamp > lastMarketCapUpdate + MARKET_CAP_STALENESS_THRESHOLD;
    }

    /**
     * @notice Gets the full market cap info
     * @return marketCap Current market cap in USD (8 decimals)
     * @return lastUpdate Timestamp of last update
     * @return isStale Whether the data is stale
     * @return tier Current bonus tier
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
     * @param _commitHash SHA-256 commitment hash (bytes32(0) for legacy rounds without commitment)
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

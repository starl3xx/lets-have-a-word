// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @dev Test-only contract standing in for a recipient that cannot receive the
 *      token — the case that reverts JackpotManagerV3's entire payout batch.
 *
 * It holds no receive/fallback, so it also serves as a recipient that would
 * reject ETH if the payout were ever ETH-denominated again.
 */
contract RejectingReceiver {
    address public immutable token;

    constructor(address _token) {
        token = _token;
    }
}

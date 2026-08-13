// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @dev Test-only $WORD stand-in.
 *
 * `setBlocked` makes transfers to an address fail, which is how the payout
 * batch's failure path is exercised. A real ERC-20 can fail a transfer for
 * many reasons (blocklists, hooks, non-standard returns); this reproduces the
 * effect without needing any of them.
 */
contract MockWordToken is ERC20 {
    mapping(address => bool) public blocked;

    constructor() ERC20("Mock WORD", "WORD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlocked(address account, bool value) external {
        blocked[account] = value;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!blocked[to], "MockWordToken: recipient blocked");
        super._update(from, to, value);
    }
}

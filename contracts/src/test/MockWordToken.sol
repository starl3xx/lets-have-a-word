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

    /**
     * @dev Mirrors ERC20Burnable.burn on the real $WORD token: burns from the
     * caller and REDUCES totalSupply. The distinction matters — the pre-2026
     * implementation transferred to 0xdead instead, which leaves supply
     * unchanged, so a mock that only transferred would let a regression back to
     * that behaviour pass silently.
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!blocked[to], "MockWordToken: recipient blocked");
        super._update(from, to, value);
    }
}

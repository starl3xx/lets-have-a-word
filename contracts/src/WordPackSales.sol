// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title WordPackSales
 * @notice Takes ETH for guess packs and records who paid.
 *
 * Players keep paying ETH; the treasury converts to $WORD in batches and tops
 * up WordJackpot. This contract exists only to make a purchase attributable.
 *
 * Why a contract rather than a plain transfer to a treasury wallet: Farcaster
 * users are largely on ERC-4337 smart accounts, so a plain value transfer
 * shows up as an *internal* call and getTransactionReceipt returns no logs —
 * the backend cannot tell who paid without tracing. The current flow only
 * works because JackpotManagerV3 emits GuessesPurchased. This preserves that
 * property in ~30 lines.
 *
 * Why purchases move off JackpotManagerV3 at all: its purchaseGuesses carries
 * a roundActive modifier, so selling a pack requires an active round there,
 * which requires meeting its 0.02 ETH MINIMUM_SEED. Keeping the pack rail on
 * that contract would mean paying the full ETH seed every round purely for the
 * right to sell packs, while the prize lived elsewhere.
 *
 * Two deliberate differences from purchaseGuesses:
 *
 * - The payer is msg.sender, not a caller-supplied argument. purchaseGuesses
 *   takes `player` as a parameter, so the event records whatever the caller
 *   passes.
 * - Price is not checked here. quantity is a label; the server prices the
 *   purchase and is the only thing that grants credit. An onchain price check
 *   would need a signed quote and buys nothing, since the server gates credit
 *   regardless.
 */
contract WordPackSales {
    /// Fixed at construction: ETH can never be directed anywhere else.
    address public immutable treasury;

    event PacksPurchased(
        address indexed payer,
        uint256 indexed roundId,
        uint32 packCount,
        uint256 amount
    );
    event Withdrawn(address indexed treasury, uint256 amount);

    error ZeroTreasury();
    error ZeroPayment();
    error ZeroPackCount();
    error NothingToWithdraw();
    error WithdrawFailed();

    constructor(address _treasury) {
        if (_treasury == address(0)) revert ZeroTreasury();
        treasury = _treasury;
    }

    /**
     * @notice Buy guess packs. Emits the record the backend verifies against.
     *
     * ETH accumulates here rather than forwarding per purchase. Forwarding
     * would be tidier, but it makes every purchase depend on the treasury
     * accepting a transfer — and the treasury is an EIP-7702 delegated EOA
     * whose delegate can change. A treasury that stopped accepting ETH would
     * fail every purchase in the game. Accumulating means a treasury problem
     * delays a withdrawal instead of breaking revenue.
     */
    function buyPacks(uint32 packCount, uint256 roundId) external payable {
        if (msg.value == 0) revert ZeroPayment();
        if (packCount == 0) revert ZeroPackCount();
        emit PacksPurchased(msg.sender, roundId, packCount, msg.value);
    }

    /**
     * @notice Send the balance to the treasury.
     *
     * Permissionless: there is no privileged key because the destination is
     * immutable, so anyone calling this can only move funds where they were
     * always going. Same shape as JackpotManagerV3.withdrawCreatorProfit.
     */
    function withdraw() external {
        uint256 amount = address(this).balance;
        if (amount == 0) revert NothingToWithdraw();

        (bool ok, ) = treasury.call{value: amount}("");
        if (!ok) revert WithdrawFailed();

        emit Withdrawn(treasury, amount);
    }

    // Deliberately no receive() and no fallback(): ETH sent without calling
    // buyPacks reverts rather than arriving unattributed, since an unattributed
    // payment is one the backend can never credit to anybody.
}

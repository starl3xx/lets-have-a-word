// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title GuessLog
 * @notice Append-only Merkle commitments over the ordered guess log of a round.
 *
 * The game already commits the answer onchain before a round opens, and
 * /verify lets anyone check H(salt || answer) after the reveal. That covers the
 * word. It does not cover the guesses — and the guesses are what decide the
 * money: the first correct one wins, and positions 1..850 set the top-10
 * payouts. Those live only in Postgres, so a server that dropped, delayed or
 * reordered a guess would change who got paid and nothing would show it.
 *
 * This contract closes that. The operator posts a Merkle root over each
 * contiguous block of guesses as the round runs. Once a root is in, the
 * contents of that block are fixed: any later attempt to tell a different story
 * about what was guessed, by whom, in what order, produces a different root.
 *
 * WHAT THIS PROVES, AND WHAT IT DOES NOT
 *
 * Proves: nothing already committed can be rewritten afterwards. A player
 * holding their leaf can show it was recorded at a given index, and the
 * contiguity rule below means the operator cannot quietly renumber around it.
 *
 * Does not prove: that a guess was submitted at all. The server still decides
 * what enters the log, and a guess dropped before the next checkpoint leaves no
 * trace here. Making omission detectable needs the player to hold a signed
 * receipt from the server at guess time, which is a client change; this
 * contract is the half that makes such a receipt worth holding, because without
 * an immutable log there would be nothing to check a receipt against.
 *
 * No upgradeability and no funds. This sits deliberately outside the prize
 * contracts: it holds nothing, so there is nothing to steal, and an immutable
 * log is worth more than an upgradeable one — a log whose rules can be changed
 * after the fact is a log you have to trust rather than check.
 */
contract GuessLog {
    /// @notice One committed block of the guess log.
    struct Checkpoint {
        /// First guess index covered, inclusive.
        uint64 fromIndex;
        /// Last guess index covered, inclusive.
        uint64 toIndex;
        /// Block timestamp at which this was committed.
        uint64 postedAt;
        /// Merkle root over the leaves in [fromIndex, toIndex].
        bytes32 root;
    }

    /// Owner may rotate the operator. Set at construction, transferable.
    address public owner;

    /// The only address permitted to post roots. Rotatable so a leaked
    /// operator key does not require redeploying the log.
    address public operator;

    /// roundId => checkpoints, in the order they were posted.
    mapping(uint256 => Checkpoint[]) private _checkpoints;

    /// roundId => the next guess index expected. Enforces contiguity.
    mapping(uint256 => uint64) public nextIndex;

    event RootPosted(
        uint256 indexed roundId,
        uint256 indexed checkpointId,
        uint64 fromIndex,
        uint64 toIndex,
        bytes32 root
    );
    event OperatorChanged(address indexed previous, address indexed next);
    event OwnershipTransferred(address indexed previous, address indexed next);

    error NotOwner();
    error NotOperator();
    error ZeroAddress();
    error EmptyRange();
    error NonContiguous(uint64 expected, uint64 got);
    error ZeroRoot();
    error NoSuchCheckpoint();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyOperator() {
        if (msg.sender != operator && msg.sender != owner) revert NotOperator();
        _;
    }

    constructor(address _operator) {
        if (_operator == address(0)) revert ZeroAddress();
        owner = msg.sender;
        operator = _operator;
        emit OwnershipTransferred(address(0), msg.sender);
        emit OperatorChanged(address(0), _operator);
    }

    /**
     * @notice Commit a Merkle root over guesses [fromIndex, toIndex] of a round.
     *
     * Contiguity is enforced rather than assumed: `fromIndex` must be exactly
     * where the previous checkpoint for this round left off. That is what stops
     * the log being rewritten by omission — an operator cannot skip a range it
     * would rather not commit to, nor go back and re-post over one already
     * committed, because indices only ever move forward and never repeat.
     *
     * There is deliberately no way to amend or delete a checkpoint. If a root
     * is posted in error it stays, and the error is part of the public record.
     */
    function postRoot(
        uint256 roundId,
        uint64 fromIndex,
        uint64 toIndex,
        bytes32 root
    ) external onlyOperator returns (uint256 checkpointId) {
        if (toIndex < fromIndex) revert EmptyRange();
        if (root == bytes32(0)) revert ZeroRoot();

        uint64 expected = nextIndex[roundId];
        if (fromIndex != expected) revert NonContiguous(expected, fromIndex);

        _checkpoints[roundId].push(
            Checkpoint({
                fromIndex: fromIndex,
                toIndex: toIndex,
                postedAt: uint64(block.timestamp),
                root: root
            })
        );
        nextIndex[roundId] = toIndex + 1;

        checkpointId = _checkpoints[roundId].length - 1;
        emit RootPosted(roundId, checkpointId, fromIndex, toIndex, root);
    }

    /// @notice How many checkpoints exist for a round.
    function checkpointCount(uint256 roundId) external view returns (uint256) {
        return _checkpoints[roundId].length;
    }

    /// @notice Read a single checkpoint.
    function getCheckpoint(uint256 roundId, uint256 checkpointId)
        external
        view
        returns (Checkpoint memory)
    {
        if (checkpointId >= _checkpoints[roundId].length) revert NoSuchCheckpoint();
        return _checkpoints[roundId][checkpointId];
    }

    /// @notice Read every checkpoint for a round.
    function getCheckpoints(uint256 roundId) external view returns (Checkpoint[] memory) {
        return _checkpoints[roundId];
    }

    /**
     * @notice Verify that `leaf` sits under the root of a given checkpoint.
     *
     * The leaf must already be double-hashed by the caller — see
     * `hashLeaf`. Offered onchain so anything else on Base can check a
     * player's claim without trusting this project's API.
     */
    function verifyInclusion(
        uint256 roundId,
        uint256 checkpointId,
        bytes32 leaf,
        bytes32[] calldata proof
    ) external view returns (bool) {
        if (checkpointId >= _checkpoints[roundId].length) revert NoSuchCheckpoint();
        return MerkleProof.verify(proof, _checkpoints[roundId][checkpointId].root, leaf);
    }

    /**
     * @notice Canonical leaf hash for a guess.
     *
     * Double-hashed, which is the standard defence against second-preimage
     * attacks on Merkle trees: without it, a 64-byte internal node could be
     * presented as though it were a leaf and "proved" to be in the tree.
     *
     * abi.encode rather than abi.encodePacked because `word` is dynamic —
     * packed encoding of dynamic types is ambiguous and two different guesses
     * could otherwise hash identically.
     */
    function hashLeaf(
        uint256 roundId,
        uint64 index,
        uint256 fid,
        string calldata word,
        uint64 guessedAt
    ) public pure returns (bytes32) {
        return keccak256(
            bytes.concat(keccak256(abi.encode(roundId, index, fid, word, guessedAt)))
        );
    }

    function setOperator(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit OperatorChanged(operator, next);
        operator = next;
    }

    function transferOwnership(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, next);
        owner = next;
    }
}

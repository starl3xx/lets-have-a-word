// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155Burnable} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Burnable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/**
 * Wordmarks: the game's achievements, onchain.
 *
 * WHY THE PLAYER SENDS THE TRANSACTION. The house could airdrop these from the
 * operator wallet in one batch, and it would be cheaper and simpler. It would
 * also be worthless for attribution: one operator address transacting is one
 * transacting user. A Wordmark is the player's, so the player mints it, and the
 * ERC-8021 suffix on that call is what credits the app.
 *
 * WHY A VOUCHER AND NOT A MERKLE ROOT. Wordmarks are awarded continuously, by
 * eleven different rules in src/lib/wordmarks.ts. A root would have to be
 * republished every time anyone earned anything, and a player who earned one an
 * hour ago could not mint until the next publish. A signed voucher is issued on
 * demand and needs no onchain state to change.
 *
 * WHY THE VOUCHER CARRIES AN FID. A player may prove several addresses
 * (user_addresses exists precisely because a Farcaster EOA and a Base Account
 * are different wallets). Keyed on the address alone, one player could mint the
 * same Wordmark once per wallet they control. The mint ledger is therefore
 * keyed on the fid, which is the thing the game actually awards to, while the
 * token still lands in whichever wallet they are holding.
 *
 * SOULBOUND. An achievement that can be sold is a collectible, not an
 * achievement, and the Early Adopter Wordmark gates reward-gate grandfathering.
 * Transfers revert. Minting and burning do not, so a player can always walk
 * away from one.
 */
contract Wordmarks is ERC1155, ERC1155Burnable, EIP712, Ownable {
    /**
     * The key that attests "this fid earned this Wordmark".
     *
     * DELIBERATELY NOT the operator key. That one signs round resolution and
     * moves prize money; this one only ever says who earned a badge, so it is
     * separated to bound what a leak costs, and it is rotatable without
     * touching anything else.
     */
    address public attestor;

    /** fid => wordmark id => already minted. The replay guard. */
    mapping(uint256 => mapping(uint256 => bool)) public mintedByFid;

    string private _baseUri;

    bytes32 private constant CLAIM_TYPEHASH =
        keccak256("Claim(uint256 fid,address to,uint256 id,uint256 deadline)");

    event WordmarkMinted(uint256 indexed fid, address indexed to, uint256 indexed id);
    event AttestorChanged(address indexed previous, address indexed current);
    event BaseUriChanged(string uri);

    error VoucherExpired();
    error BadSignature();
    error AlreadyMinted();
    error Soulbound();
    error ZeroAddress();

    constructor(address initialOwner, address initialAttestor, string memory baseUri_)
        ERC1155(baseUri_)
        EIP712("LetsHaveAWordWordmarks", "1")
        Ownable(initialOwner)
    {
        if (initialAttestor == address(0)) revert ZeroAddress();
        attestor = initialAttestor;
        _baseUri = baseUri_;
    }

    /**
     * Mint a Wordmark the caller has been attested to have earned.
     *
     * `to` is bound into the signature rather than read from msg.sender so a
     * voucher cannot be lifted out of one player's network response and
     * redeemed by another. The caller still pays the gas, which is the point,
     * but they can only ever mint to the address the attestor named.
     */
    function mint(uint256 fid, address to, uint256 id, uint256 deadline, bytes calldata signature)
        external
    {
        if (block.timestamp > deadline) revert VoucherExpired();
        if (mintedByFid[fid][id]) revert AlreadyMinted();

        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(CLAIM_TYPEHASH, fid, to, id, deadline))
        );
        if (ECDSA.recover(digest, signature) != attestor) revert BadSignature();

        // Set before minting. _update is reached during _mint, and a
        // reentrant ERC-1155 receiver must not find this flag still false.
        mintedByFid[fid][id] = true;

        _mint(to, id, 1, "");
        emit WordmarkMinted(fid, to, id);
    }

    /**
     * Non-transferable. Mint (from == 0) and burn (to == 0) still work.
     *
     * Burning needs ERC1155Burnable to be reachable at all: plain ERC-1155
     * rejects a transfer to the zero address in safeTransferFrom, before this
     * hook is ever called, so without burn() the "you can walk away" half of
     * soulbound would have been a comment describing something impossible.
     *
     * A burn does NOT clear mintedByFid. Re-minting after burning would make
     * the ledger a lie about what was awarded, and the point of burning is to
     * stop holding it, not to reset it.
     */
    function _update(address from, address to, uint256[] memory ids, uint256[] memory values)
        internal
        override(ERC1155)
    {
        if (from != address(0) && to != address(0)) revert Soulbound();
        super._update(from, to, ids, values);
    }

    function setAttestor(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit AttestorChanged(attestor, next);
        attestor = next;
    }

    function setBaseUri(string calldata next) external onlyOwner {
        _baseUri = next;
        _setURI(next);
        emit BaseUriChanged(next);
    }

    /**
     * ERC-1155 substitutes {id} client-side, which the app's own metadata route
     * does not do, so the id is interpolated here instead. Twelve ids, one per
     * WordmarkType in src/lib/wordmarks.ts.
     */
    function uri(uint256 id) public view override returns (string memory) {
        return string.concat(_baseUri, Strings.toString(id), ".json");
    }
}

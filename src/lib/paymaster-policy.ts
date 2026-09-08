/**
 * What this project is willing to pay gas for.
 *
 * An ERC-7677 paymaster endpoint is a public URL that spends money. Without a
 * policy in front of it, anyone who finds the URL can have arbitrary
 * transactions sponsored until the balance is gone — the endpoint is the
 * spending authority, not the wallet calling it. So the rule here is an
 * allowlist of exactly one thing: buying guess packs.
 *
 * The user operation's callData is the smart account's own encoding, not the
 * inner call, so it has to be unwrapped first. Two shapes cover the accounts
 * Farcaster users actually arrive with:
 *
 *   execute(address dest, uint256 value, bytes func)     — most ERC-4337 accounts
 *   executeBatch(Call[] calls)                           — Coinbase Smart Wallet
 *
 * Anything else — an unrecognised wrapper, a call to a different contract, a
 * different function on ours, or a batch with one disallowed call in it — is
 * refused. Failing closed on an encoding we do not recognise is the only safe
 * default: an unknown wrapper could be hiding anything.
 */
import { ethers } from 'ethers';

/** buyPacks(uint32,uint256) */
export const BUY_PACKS_SELECTOR = '0x6a19e8b7';

/** mint(uint256,address,uint256,uint256,bytes) on the Wordmarks contract. */
export const WORDMARK_MINT_SELECTOR = ethers.id(
  'mint(uint256,address,uint256,uint256,bytes)'
).slice(0, 10);

/** execute(address,uint256,bytes) */
const EXECUTE_SELECTOR = '0xb61d27f6';

/** executeBatch((address,uint256,bytes)[]) */
const EXECUTE_BATCH_SELECTOR = '0x34fcd5be';

/** A decoded Wordmark mint the caller must independently authorise. */
export interface MintClaim {
  fid: bigint;
  to: string;
  id: bigint;
  deadline: bigint;
  signature: string;
}

export interface SponsorDecision {
  allowed: boolean;
  reason: string;
  /**
   * Set when the decision is conditional: for each of these decoded mints the
   * caller must confirm (1) the attestor really signed the voucher and (2) the
   * (fid, id) budget /api/wordmarks/voucher wrote still has spend left,
   * before forwarding.
   *
   * A reverting transaction still consumes gas the paymaster pays for, and the
   * contract reverts on any replayed mint, so "targets our contract, calls
   * mint" is NOT sufficient on its own — anybody could loop failed mints and
   * drain sponsorship without ever receiving a token. The Redis lookup and the
   * signature recovery live in the endpoint so this function stays pure and
   * testable; the price of that is that a caller ignoring this field silently
   * reopens the hole. Hence a field that must be read rather than an
   * `allowed: true` that looks finished.
   */
  requiresMints?: MintClaim[];
}

interface InnerCall {
  target: string;
  data: string;
}

function decodeInnerCalls(callData: string): InnerCall[] | null {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const selector = callData.slice(0, 10).toLowerCase();
  const payload = '0x' + callData.slice(10);

  try {
    if (selector === EXECUTE_SELECTOR) {
      const [target, , data] = coder.decode(['address', 'uint256', 'bytes'], payload);
      return [{ target, data }];
    }
    if (selector === EXECUTE_BATCH_SELECTOR) {
      const [calls] = coder.decode(['tuple(address,uint256,bytes)[]'], payload);
      return (calls as unknown[]).map((c) => {
        const tuple = c as [string, bigint, string];
        return { target: tuple[0], data: tuple[2] };
      });
    }
  } catch {
    // Malformed for the selector it claims to be.
    return null;
  }

  return null;
}

/**
 * Decide whether to sponsor a user operation.
 *
 * `salesAddress` is passed in rather than read from the environment here so
 * this stays pure and testable — the decision that guards the money should not
 * depend on process state.
 */
export function willSponsor(
  callData: string,
  salesAddress: string | null,
  wordmarksAddress: string | null = null
): SponsorDecision {
  if (!salesAddress || !ethers.isAddress(salesAddress)) {
    return { allowed: false, reason: 'Pack sales contract not configured' };
  }
  // typeof first: callData arrives from an unauthenticated JSON body, and a
  // number or object here would throw on .startsWith and 500 the route.
  if (typeof callData !== 'string' || !callData.startsWith('0x') || callData.length < 10) {
    return { allowed: false, reason: 'Missing or malformed callData' };
  }

  const calls = decodeInnerCalls(callData);
  if (calls === null) {
    return {
      allowed: false,
      reason: 'Unrecognised account callData — only execute and executeBatch are sponsored',
    };
  }
  if (calls.length === 0) {
    return { allowed: false, reason: 'No calls to sponsor' };
  }
  // No honest flow batches more than a purchase and a mint or two. A wide
  // batch is someone maximising what one sponsorship pays for.
  if (calls.length > 4) {
    return { allowed: false, reason: 'Batch too large to sponsor' };
  }

  const wordmarks =
    wordmarksAddress && ethers.isAddress(wordmarksAddress)
      ? wordmarksAddress.toLowerCase()
      : null;
  const mints: MintClaim[] = [];

  for (const call of calls) {
    const target = call.target.toLowerCase();
    const selector = call.data.slice(0, 10).toLowerCase();

    if (target === salesAddress.toLowerCase()) {
      if (selector !== BUY_PACKS_SELECTOR) {
        return { allowed: false, reason: 'Only buyPacks is sponsored on the sales contract' };
      }
      continue;
    }

    if (wordmarks && target === wordmarks) {
      if (selector !== WORDMARK_MINT_SELECTOR) {
        return { allowed: false, reason: 'Only mint is sponsored on the Wordmarks contract' };
      }
      const claim = decodeMintClaim(call.data);
      if (!claim) {
        return { allowed: false, reason: 'Malformed Wordmark mint call' };
      }
      // One voucher authorises one mint. A batch repeating the same signature
      // is asking to be paid for N-1 guaranteed reverts, since the contract
      // rejects the replay: exactly the drain the voucher check exists to stop,
      // wearing a single valid voucher as cover (Bugbot, PR #300).
      if (mints.some((m) => m.signature === claim.signature)) {
        return { allowed: false, reason: 'A batch cannot reuse one Wordmark voucher' };
      }
      mints.push(claim);
      continue;
    }

    return {
      allowed: false,
      reason: `Call targets ${call.target}, which is not a sponsored contract`,
    };
  }

  if (mints.length > 0) {
    return {
      allowed: true,
      reason: `Sponsoring ${calls.length} call(s), ${mints.length} needing a voucher`,
      requiresMints: mints,
    };
  }

  return { allowed: true, reason: `Sponsoring ${calls.length} pack purchase call(s)` };
}

/**
 * Decode the full mint claim back out of a mint call, so the endpoint can
 * recover the voucher's signer and key its budget by (fid, id) — the
 * entitlement, not the signature, since re-signing yields a fresh signature
 * every second but never a fresh entitlement.
 */
function decodeMintClaim(data: string): MintClaim | null {
  try {
    const [fid, to, id, deadline, signature] = ethers.AbiCoder.defaultAbiCoder().decode(
      ['uint256', 'address', 'uint256', 'uint256', 'bytes'],
      '0x' + data.slice(10)
    );
    // 65 bytes of hex plus '0x'. Anything else can never recover to the
    // attestor, so refuse it a layer early and keep junk out of the logs.
    if (typeof signature !== 'string' || signature.length !== 132) return null;
    return { fid, to, id, deadline, signature };
  } catch {
    return null;
  }
}

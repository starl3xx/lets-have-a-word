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

/** execute(address,uint256,bytes) */
const EXECUTE_SELECTOR = '0xb61d27f6';

/** executeBatch((address,uint256,bytes)[]) */
const EXECUTE_BATCH_SELECTOR = '0x34fcd5be';

export interface SponsorDecision {
  allowed: boolean;
  reason: string;
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
export function willSponsor(callData: string, salesAddress: string | null): SponsorDecision {
  if (!salesAddress || !ethers.isAddress(salesAddress)) {
    return { allowed: false, reason: 'Pack sales contract not configured' };
  }
  if (!callData || !callData.startsWith('0x') || callData.length < 10) {
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

  for (const call of calls) {
    if (call.target.toLowerCase() !== salesAddress.toLowerCase()) {
      return {
        allowed: false,
        reason: `Call targets ${call.target}, only the pack sales contract is sponsored`,
      };
    }
    if (call.data.slice(0, 10).toLowerCase() !== BUY_PACKS_SELECTOR) {
      return {
        allowed: false,
        reason: 'Only buyPacks is sponsored',
      };
    }
  }

  return { allowed: true, reason: `Sponsoring ${calls.length} pack purchase call(s)` };
}

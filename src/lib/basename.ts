/**
 * Basename resolution — who a wallet-native player actually is.
 *
 * ## What this is for
 *
 * A Base App player has no Farcaster account, so Neynar has never heard of them
 * and every name surface fell back to "fid:1000000001" with a generated
 * placeholder — in the stats panel and in the permanent public archive. But
 * they are not anonymous: their address usually carries a basename
 * (starl3xx.base.eth), and SIWE has already proved they control that address.
 *
 * ## How the reverse record works
 *
 * Basenames are ENS-shaped, on Base, resolved by the L2 resolver below. The
 * reverse name is `<lowercase-hex-without-0x>.80002105.reverse`, where
 * 80002105 is Base's coin type (0x80000000 | 8453) in hex.
 *
 * ONE SUBTLETY WORTH THE COMMENT: ENS hashes the ASCII LABEL, not the raw
 * address bytes. `keccak256(toBytes('0fc0…'))` and `keccak256('0x0fc0…')` are
 * different values, and only the first resolves. Getting this wrong returns a
 * confident empty string rather than an error, which reads exactly like "this
 * player has no basename" — verified against a real address on 2026-08-27,
 * where the wrong hashing returned "" and the right hashing returned
 * "starl3xx.base.eth".
 *
 * ## Avatars are NOT reliably available
 *
 * The `avatar` text record is frequently unset even for players who clearly
 * have a picture in Base App — that image comes from Coinbase's own profile
 * service, not from the chain. Measured on a real Base App account: name
 * resolved, avatar record empty. So the avatar here is best-effort and callers
 * MUST have a fallback.
 *
 * ## Failure is always silent
 *
 * Every function returns null rather than throwing, and never blocks a
 * sign-in: a player whose basename lookup times out is a player with a
 * truncated address for a name, not a player who cannot log in. Same posture
 * as walletlink.ts.
 */

import { createPublicClient, http, encodePacked, keccak256, namehash, toBytes } from 'viem';
import { base } from 'viem/chains';

/** Basenames L2 resolver on Base mainnet. */
const L2_RESOLVER = '0xC6d566A56A1aFf6508b41f6c90ff131615583BCD' as const;

/**
 * Short on purpose. This sits on the sign-in path, where a slow answer is worth
 * far less than a prompt session: the fallback is a truncated address, which is
 * perfectly serviceable.
 */
const TIMEOUT_MS = 3_000;

const RESOLVER_ABI = [
  {
    inputs: [{ name: 'node', type: 'bytes32' }],
    name: 'name',
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'node', type: 'bytes32' }],
    name: 'addr',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
    ],
    name: 'text',
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export interface BasenameIdentity {
  /** e.g. "starl3xx.base.eth". Null when the address has no reverse record. */
  name: string | null;
  /** From the `avatar` text record. Frequently null even when a name exists. */
  avatar: string | null;
}

/** The reverse-resolution node for an address on Base. See the note above. */
export function baseReverseNode(address: string): `0x${string}` {
  const label = address.toLowerCase().replace(/^0x/, '');
  const addressNode = keccak256(toBytes(label));
  const baseReverse = namehash('80002105.reverse');
  return keccak256(encodePacked(['bytes32', 'bytes32'], [baseReverse, addressNode]));
}

/**
 * Shorten an address for display: 0x0Fc0…2F6E.
 *
 * The fallback when there is no basename. True, verifiable, and recognisable to
 * the player who owns it — unlike an invented pseudonym, and unlike
 * "fid:1000000001", which is both meaningless to them and the exact shape the
 * round-28 farm accounts carried.
 */
export function shortenAddress(address: string): string {
  if (!address || address.length < 10) return address || '';
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Does a name's forward `addr` record point back at the address we started
 * from? Exported so the rule can be tested without a chain.
 *
 * Address comparison is case-insensitive because the two sides arrive in
 * different casings — checksummed from the contract, whatever the caller had
 * on the other. A missing or zero forward record is a NON-match: an
 * unresolvable name proves nothing about who owns it.
 */
export function forwardMatches(
  forwardAddr: string | null | undefined,
  address: string
): boolean {
  if (!forwardAddr || !address) return false;
  if (/^0x0{40}$/i.test(forwardAddr)) return false;
  return forwardAddr.toLowerCase() === address.toLowerCase();
}

function client() {
  return createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL || 'https://mainnet.base.org'),
  });
}

/**
 * Resolve an address to its basename and avatar. Never throws.
 *
 * Returns `{ name: null, avatar: null }` both when the address has no basename
 * and when the lookup failed — the caller cannot act differently on the two,
 * and the `display_checked_at` column records that a look happened.
 */
export async function resolveBasename(address: string): Promise<BasenameIdentity> {
  const empty: BasenameIdentity = { name: null, avatar: null };
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) return empty;

  // Set by the test setup. Sign-in resolves a basename per created wallet
  // player, and several suites create them, so an unguarded run would fire a
  // real RPC per row: slow, flaky and rate-limited. The empty answer is
  // identical in shape to a real address with no reverse record.
  if (process.env.BASENAME_RESOLUTION_DISABLED === 'true') return empty;

  try {
    const publicClient = client();
    const node = baseReverseNode(address);

    const name = await withTimeout(
      publicClient.readContract({
        address: L2_RESOLVER,
        abi: RESOLVER_ABI,
        functionName: 'name',
        args: [node],
      })
    );

    if (!name || typeof name !== 'string') return empty;

    // FORWARD VERIFICATION. A reverse record is set by whoever controls the
    // address and is claimed, not proven: anyone can point theirs at any string,
    // including somebody else's basename. Trusting it unchecked would let a
    // player appear as another person in the stats panel, on the leaderboards
    // and in the PERMANENT PUBLIC ARCHIVE of a game that pays out money.
    //
    // The name is only real if the name's own `addr` record points back at the
    // address we started from — the standard ENS round-trip. A name that does
    // not resolve back is discarded entirely rather than shown with a caveat;
    // the truncated-address fallback is honest, and a half-trusted name is not.
    // (Bugbot, PR #290.)
    const forward = await withTimeout(
      publicClient.readContract({
        address: L2_RESOLVER,
        abi: RESOLVER_ABI,
        functionName: 'addr',
        args: [namehash(name)],
      })
    );

    if (!forwardMatches(forward as string | null, address)) {
      console.warn(
        `[basename] reverse record "${name}" on ${address} does not resolve back; ignoring`
      );
      return empty;
    }

    // Best-effort only, and never allowed to cost us the name we already have.
    let avatar: string | null = null;
    try {
      const value = await withTimeout(
        publicClient.readContract({
          address: L2_RESOLVER,
          abi: RESOLVER_ABI,
          functionName: 'text',
          args: [namehash(name), 'avatar'],
        })
      );
      if (value && typeof value === 'string') avatar = value;
    } catch {
      // No avatar record, or the second call failed. The name still stands.
    }

    return { name, avatar };
  } catch (error) {
    console.warn(
      `[basename] lookup failed for ${address}:`,
      error instanceof Error ? error.message : error
    );
    return empty;
  }
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('basename lookup timed out')), TIMEOUT_MS);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

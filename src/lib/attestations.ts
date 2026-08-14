/**
 * Coinbase onchain Verifications (EAS on Base)
 *
 * Reads whether a wallet holds a valid Coinbase "Verified Account"
 * attestation. Used by the wallet-cluster gate as a *bypass*, never as a
 * requirement — see the rationale in `wallet-cluster.ts`.
 *
 * Why a bypass rather than a gate: requiring an attestation to play would
 * exclude every honest player who has not verified with Coinbase, which is
 * most of them. Treating one as proof of personhood inverts the cost of a
 * false positive instead: verified players become immune to the co-mint
 * heuristic, so the heuristic can be tuned aggressively at the farm without
 * the collateral damage that is the whole reason it still ships disabled.
 *
 * Trust model, per Coinbase's own guidance: the indexer is a convenience for
 * finding the attestation UID and is NOT trusted to say anything about
 * validity. Everything that matters — schema, attester, recipient, expiry,
 * revocation — is re-read from the EAS contract itself and checked here. A
 * compromised or buggy indexer can at worst point us at an attestation we
 * then reject.
 *
 * Addresses and schema UIDs are from github.com/coinbase/verifications.
 */
import { ethers } from 'ethers';
import { getBaseProvider } from './word-token';

/** EAS on Base mainnet (a predeploy — same address across OP-stack chains). */
const EAS_ADDRESS = '0x4200000000000000000000000000000000000021';

/** Coinbase's attestation indexer on Base mainnet. */
const INDEXER_ADDRESS = '0x2c7eE1E5f416dfF40054c27A62f7B357C4E8619C';

/** The only attester whose Verified Account attestations we accept. */
const COINBASE_ATTESTER = '0x357458739F90461b99789350868CD7CF330Dd7EE';

/** Coinbase "Verified Account" schema on Base mainnet. */
const VERIFIED_ACCOUNT_SCHEMA =
  '0xf8b05c79f090979bf4a80270aba232dff11a10d9ca55c4f88de95317970f0de9';

const INDEXER_ABI = [
  'function getAttestationUid(address recipient, bytes32 schemaUid) view returns (bytes32)',
];

const EAS_ABI = [
  'function getAttestation(bytes32 uid) view returns (tuple(bytes32 uid, bytes32 schema, uint64 time, uint64 expirationTime, uint64 revocationTime, bytes32 refUID, address recipient, address attester, bool revocable, bytes data))',
];

/**
 * Budget for the two reads together. The gate runs on the guess path, so a
 * slow RPC must not hold a player's guess open; the caller treats a timeout
 * as "not verified", which costs the user their bypass but never blocks them
 * on its own.
 */
const LOOKUP_TIMEOUT_MS = 4000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

/** The fields of an EAS attestation this module makes decisions on. */
export interface AttestationFields {
  schema: string;
  attester: string;
  recipient: string;
  revocationTime: bigint;
  expirationTime: bigint;
}

/**
 * Is this attestation a valid Coinbase Verified Account for `wallet`?
 *
 * Pure, and separated from the reads above so the rules that decide who
 * bypasses a sybil gate are testable without standing up an RPC mock. Every
 * check here is a way the indexer could hand us something that looks right
 * and is not.
 */
export function isValidVerifiedAccount(
  attestation: AttestationFields,
  wallet: string,
  nowSeconds: bigint
): boolean {
  // Not the schema we asked for.
  if (attestation.schema.toLowerCase() !== VERIFIED_ACCOUNT_SCHEMA.toLowerCase()) {
    return false;
  }
  // Anyone can attest anything under any schema; only Coinbase's signature
  // means what we want it to mean here.
  if (attestation.attester.toLowerCase() !== COINBASE_ATTESTER.toLowerCase()) {
    return false;
  }
  // Guards against an attestation issued to someone else being credited here.
  if (attestation.recipient.toLowerCase() !== wallet.toLowerCase()) {
    return false;
  }
  if (attestation.revocationTime !== 0n) {
    return false;
  }
  // In EAS, expirationTime 0 means "never expires".
  if (attestation.expirationTime !== 0n && attestation.expirationTime <= nowSeconds) {
    return false;
  }
  return true;
}

/**
 * Does this wallet hold a currently-valid Coinbase Verified Account attestation?
 *
 * Throws on RPC failure rather than returning false, so callers can tell
 * "definitely not verified" apart from "could not check" — conflating them
 * would let an RPC outage silently change gating behaviour.
 */
export async function hasCoinbaseVerifiedAccount(wallet: string): Promise<boolean> {
  if (!wallet || !ethers.isAddress(wallet)) {
    return false;
  }

  const provider = getBaseProvider();

  const indexer = new ethers.Contract(INDEXER_ADDRESS, INDEXER_ABI, provider);
  const uid: string = await withTimeout(
    indexer.getAttestationUid(wallet, VERIFIED_ACCOUNT_SCHEMA),
    LOOKUP_TIMEOUT_MS,
    'attestation indexer lookup'
  );

  // Never indexed, or no such attestation.
  if (!uid || uid === ethers.ZeroHash) {
    return false;
  }

  const eas = new ethers.Contract(EAS_ADDRESS, EAS_ABI, provider);
  const attestation = await withTimeout(
    eas.getAttestation(uid),
    LOOKUP_TIMEOUT_MS,
    'EAS getAttestation'
  );

  // A UID the indexer gave us proves nothing on its own.
  return isValidVerifiedAccount(
    {
      schema: attestation.schema,
      attester: attestation.attester,
      recipient: attestation.recipient,
      revocationTime: attestation.revocationTime,
      expirationTime: attestation.expirationTime,
    },
    wallet,
    BigInt(Math.floor(Date.now() / 1000))
  );
}

export const ATTESTATION_CONSTANTS = {
  EAS_ADDRESS,
  INDEXER_ADDRESS,
  COINBASE_ATTESTER,
  VERIFIED_ACCOUNT_SCHEMA,
} as const;

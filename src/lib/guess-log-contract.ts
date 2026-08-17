/**
 * GuessLog contract client.
 *
 * Dormant until GUESS_LOG_ADDRESS is set, in the same way the $WORD economy is
 * dormant until its addresses are set: `isGuessLogConfigured()` gates every
 * caller, so nothing changes in production until the contract is deployed.
 */
import { ethers } from 'ethers';
import { getBaseProvider } from './word-token';
import { db } from '../db';
import { guessLogCheckpoints } from '../db/schema';
import { eq } from 'drizzle-orm';
import { collectPendingGuesses, lastCommittedIndex } from './guess-log';

const GUESS_LOG_ABI = [
  'function postRoot(uint256 roundId, uint64 fromIndex, uint64 toIndex, bytes32 root) returns (uint256)',
  'function nextIndex(uint256 roundId) view returns (uint64)',
  'function checkpointCount(uint256 roundId) view returns (uint256)',
  // Declared so reverts decode into something readable rather than a raw
  // 4-byte selector in the logs.
  'error NotOperator()',
  'error EmptyRange()',
  'error NonContiguous(uint64 expected, uint64 got)',
  'error ZeroRoot()',
];

export function getGuessLogAddress(): string | null {
  const address = process.env.GUESS_LOG_ADDRESS;
  return address && ethers.isAddress(address) ? address : null;
}

export function isGuessLogConfigured(): boolean {
  return getGuessLogAddress() !== null && !!process.env.OPERATOR_PRIVATE_KEY;
}

function getContract(signer?: ethers.Signer): ethers.Contract {
  const address = getGuessLogAddress();
  if (!address) throw new Error('GUESS_LOG_ADDRESS not configured');
  return new ethers.Contract(address, GUESS_LOG_ABI, signer ?? getBaseProvider());
}

function getOperator(): ethers.Wallet {
  const key = process.env.OPERATOR_PRIVATE_KEY;
  if (!key) throw new Error('OPERATOR_PRIVATE_KEY not configured');
  return new ethers.Wallet(key, getBaseProvider());
}

export interface PostResult {
  posted: boolean;
  reason?: string;
  roundId?: number;
  fromIndex?: number;
  toIndex?: number;
  root?: string;
  txHash?: string;
  checkpointId?: number;
}

/**
 * Commit the next block of a round's guess log.
 *
 * Reconciles against the contract's own `nextIndex` before sending rather than
 * trusting the local checkpoint table. The two can disagree — a send that
 * landed onchain but failed to record locally would otherwise make us build the
 * next root over a range already committed, and the contract would reject it.
 * Comparing first turns that into a clear message instead of a revert.
 */
export async function postNextCheckpoint(roundId: number): Promise<PostResult> {
  if (!isGuessLogConfigured()) {
    return { posted: false, reason: 'GuessLog not configured' };
  }

  const readOnly = getContract();
  const onchainNext = Number(await readOnly.nextIndex(roundId));
  const localCommitted = await lastCommittedIndex(roundId);

  // INDEX BASES DIFFER, deliberately handled only at this boundary: the DB's
  // guess_index_in_round is 1-BASED (first guess = 1), the contract's
  // contiguity is 0-BASED (first checkpoint must start at nextIndex = 0).
  // That makes the contract's nextIndex equal to the COUNT of leaves
  // committed — which is exactly the local "last 1-based index committed".
  // Round 34's first checkpoint proved this the hard way: posting the
  // 1-based fromIndex raw produced NonContiguous(expected 0, got 1) on
  // every cron run.
  if (onchainNext !== localCommitted) {
    return {
      posted: false,
      reason:
        `Checkpoint table and contract disagree for round ${roundId}: ` +
        `contract has ${onchainNext} leaves committed, local table has ${localCommitted}. ` +
        `Not posting until this is reconciled.`,
    };
  }

  const pending = await collectPendingGuesses(roundId);
  if (!pending) {
    return { posted: false, reason: 'No new guesses to commit' };
  }

  const contract = getContract(getOperator());
  // 1-based local indices → 0-based onchain range (see the base note above).
  // The Merkle root itself is unaffected: leaves hash the 1-based indices,
  // and verification recomputes from the same local data.
  const tx = await contract.postRoot(
    roundId,
    pending.fromIndex - 1,
    pending.toIndex - 1,
    pending.root
  );
  const receipt = await tx.wait();

  const checkpointId = Number(await readOnly.checkpointCount(roundId)) - 1;

  await db.insert(guessLogCheckpoints).values({
    roundId,
    checkpointId,
    fromIndex: pending.fromIndex,
    toIndex: pending.toIndex,
    fromGuessId: pending.fromGuessId,
    toGuessId: pending.toGuessId,
    root: pending.root,
    txHash: tx.hash,
    postedAt: new Date(),
  });

  console.log(
    `[guess-log] Round ${roundId}: committed indices ${pending.fromIndex}-${pending.toIndex} ` +
      `(${pending.leaves.length} guesses) as checkpoint ${checkpointId}, root ${pending.root}, tx ${tx.hash}` +
      (receipt ? ` in block ${receipt.blockNumber}` : '')
  );

  return {
    posted: true,
    roundId,
    fromIndex: pending.fromIndex,
    toIndex: pending.toIndex,
    root: pending.root,
    txHash: tx.hash,
    checkpointId,
  };
}

/** Checkpoints recorded locally for a round, oldest first. */
export async function getCheckpointsForRound(roundId: number) {
  return db
    .select()
    .from(guessLogCheckpoints)
    .where(eq(guessLogCheckpoints.roundId, roundId));
}

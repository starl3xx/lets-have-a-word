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
import {
  collectPendingGuesses,
  lastCommittedIndex,
  planCheckpointReconcile,
  rebuildCheckpointRange,
  type OnchainCheckpoint,
} from './guess-log';

const GUESS_LOG_ABI = [
  'function postRoot(uint256 roundId, uint64 fromIndex, uint64 toIndex, bytes32 root) returns (uint256)',
  'function nextIndex(uint256 roundId) view returns (uint64)',
  'function checkpointCount(uint256 roundId) view returns (uint256)',
  'function getCheckpoints(uint256 roundId) view returns (tuple(uint64 fromIndex, uint64 toIndex, uint64 postedAt, bytes32 root)[])',
  'event RootPosted(uint256 indexed roundId, uint256 indexed checkpointId, uint64 fromIndex, uint64 toIndex, bytes32 root)',
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
  /**
   * Why nothing was posted, as something other than prose.
   *
   * Callers have to tell "nothing new to commit", which is the healthy state
   * most of the time, apart from "the table and the contract disagree", which
   * means the log has stopped advancing and a person has to look. Both used to
   * come back as `posted:false` with a sentence in `reason`, and the cron
   * reported HTTP 200 for both.
   *
   * There is no `'failed'` member, deliberately. A genuine failure — an RPC
   * error, a revert, or a gap in the index sequence — THROWS out of
   * `postNextCheckpoint` rather than returning a result, and the call site
   * classifies it with `instanceof GuessLogGapError`. A member no return path
   * can produce invites a consumer to branch on it and get a branch that never
   * runs.
   */
  reasonCode?: 'not-configured' | 'nothing-pending' | 'index-mismatch';
  roundId?: number;
  fromIndex?: number;
  toIndex?: number;
  root?: string;
  txHash?: string;
  checkpointId?: number;
  /** Leaves the contract says it holds, on a mismatch. */
  onchainLeaves?: number;
  /** Leaves the local checkpoint table says it holds, on a mismatch. */
  localLeaves?: number;
  /** Checkpoint rows this call copied in or renumbered from the contract first. */
  reconciled?: { inserted: number[]; renumbered: Array<{ from: number; to: number }> };
}

/**
 * What the contract itself says about a round's log.
 *
 * `nextIndex` is the COUNT of leaves committed, for the 0-based/1-based reason
 * spelled out in `postNextCheckpoint`. Exposed so the admin health check can
 * show the contract's number next to the local table's without duplicating the
 * ABI or that base-conversion note anywhere else.
 */
export async function getOnchainLogState(
  roundId: number
): Promise<{ leaves: number; checkpoints: number }> {
  const readOnly = getContract();
  const [leaves, checkpoints] = await Promise.all([
    readOnly.nextIndex(roundId),
    readOnly.checkpointCount(roundId),
  ]);
  return { leaves: Number(leaves), checkpoints: Number(checkpoints) };
}

/**
 * Commit the next block of a round's guess log.
 *
 * Reconciles against the contract's own `nextIndex` before sending rather than
 * trusting the local checkpoint table. The two can disagree — a send that
 * landed onchain but failed to record locally would otherwise make us build the
 * next root over a range already committed, and the contract would reject it.
 * When the contract is ahead, the table is first repaired from it (see
 * reconcileWithContract); anything the repair cannot prove is refused with a
 * clear message instead of a revert.
 */
export async function postNextCheckpoint(roundId: number): Promise<PostResult> {
  if (!isGuessLogConfigured()) {
    return { posted: false, reasonCode: 'not-configured', reason: 'GuessLog not configured' };
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
  let reconciled: PostResult['reconciled'];
  if (onchainNext !== localCommitted) {
    // The contract AHEAD of the table is the known drift: a root that landed
    // onchain without its row. Try to repair it. The table ahead of the
    // contract is not something a repair can explain, so it still refuses.
    const repair =
      onchainNext > localCommitted ? await reconcileWithContract(roundId, readOnly) : null;
    const repairedTo = repair?.ok ? await lastCommittedIndex(roundId) : localCommitted;

    if (!repair?.ok || repairedTo !== onchainNext) {
      return {
        posted: false,
        reasonCode: 'index-mismatch',
        roundId,
        onchainLeaves: onchainNext,
        localLeaves: repairedTo,
        reason:
          `Checkpoint table and contract disagree for round ${roundId}: ` +
          `contract has ${onchainNext} leaves committed, local table has ${repairedTo}. ` +
          (repair && !repair.ok ? `Repair refused: ${repair.reason} ` : '') +
          `Not posting until this is reconciled.`,
      };
    }
    reconciled = { inserted: repair.inserted, renumbered: repair.renumbered };
  }

  const pending = await collectPendingGuesses(roundId);
  if (!pending) {
    return {
      posted: false,
      reasonCode: 'nothing-pending',
      roundId,
      reason: 'No new guesses to commit',
      ...(reconciled ? { reconciled } : {}),
    };
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

  // The id comes from the receipt's own RootPosted event, never from a second
  // read: a read after tx.wait() can reach a node one block behind and return
  // the count from before this post. That is how rounds 34 to 37 each lost a
  // row (see planCheckpointReconcile).
  const checkpointId = checkpointIdFromReceipt(receipt, roundId);
  if (checkpointId === null) {
    // Landed, but the receipt does not say where. Recording a guessed id is
    // what broke the table before. The next tick's repair inserts this row
    // from the contract, with its real id.
    throw new Error(
      `Round ${roundId}: postRoot ${tx.hash} has no RootPosted event in its receipt. ` +
        'The next tick reconciles the table from the contract.'
    );
  }

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
    ...(reconciled ? { reconciled } : {}),
  };
}

const GUESS_LOG_INTERFACE = new ethers.Interface(GUESS_LOG_ABI);

/** The checkpoint id this round's RootPosted event reports, or null. */
export function checkpointIdFromReceipt(
  receipt: Pick<ethers.TransactionReceipt, 'logs'> | null,
  roundId: number
): number | null {
  const address = getGuessLogAddress()?.toLowerCase();
  for (const log of receipt?.logs ?? []) {
    if (log.address.toLowerCase() !== address) continue;
    const parsed = GUESS_LOG_INTERFACE.parseLog(log);
    if (parsed?.name === 'RootPosted' && Number(parsed.args.roundId) === roundId) {
      return Number(parsed.args.checkpointId);
    }
  }
  return null;
}

/**
 * Bring the local checkpoint table in line with the contract: add the rows for
 * roots that landed onchain without one, and correct ids recorded wrong.
 *
 * Writes nothing unless EVERY missing root, rebuilt from the guesses table,
 * equals the root the contract holds. A row is only ever a copy of something
 * already public and already provable, so the table cannot gain a claim the
 * chain does not back.
 *
 * Sends no transaction. The contract is append-only, so a mismatch that is the
 * contract's side cannot be fixed from here, and is refused instead.
 */
async function reconcileWithContract(
  roundId: number,
  readOnly: ethers.Contract
): Promise<
  | { ok: true; inserted: number[]; renumbered: Array<{ from: number; to: number }> }
  | { ok: false; reason: string }
> {
  const raw: Array<{ fromIndex: bigint; toIndex: bigint; postedAt: bigint; root: string }> =
    await readOnly.getCheckpoints(roundId);
  const onchain: OnchainCheckpoint[] = raw.map((cp, checkpointId) => ({
    checkpointId,
    // 0-based onchain → 1-based table; see the base note in postNextCheckpoint.
    fromIndex: Number(cp.fromIndex) + 1,
    toIndex: Number(cp.toIndex) + 1,
    root: cp.root,
    postedAt: Number(cp.postedAt),
  }));

  const plan = planCheckpointReconcile(onchain, await getCheckpointsForRound(roundId));
  if (!plan.ok) return plan;

  // Every root is checked before anything is written.
  const rows: Array<typeof guessLogCheckpoints.$inferInsert> = [];
  for (const cp of plan.missing) {
    const rebuilt = await rebuildCheckpointRange(roundId, cp.fromIndex, cp.toIndex);
    if (!rebuilt) {
      return {
        ok: false,
        reason:
          `Onchain checkpoint ${cp.checkpointId} covers ${cp.fromIndex}..${cp.toIndex}, ` +
          'which is not exactly one guess per index locally.',
      };
    }
    if (rebuilt.root.toLowerCase() !== cp.root.toLowerCase()) {
      return {
        ok: false,
        reason:
          `Onchain checkpoint ${cp.checkpointId} holds root ${cp.root} for ${cp.fromIndex}..${cp.toIndex}, ` +
          `but the guesses table rebuilds ${rebuilt.root}.`,
      };
    }
    rows.push({
      roundId,
      checkpointId: cp.checkpointId,
      fromIndex: cp.fromIndex,
      toIndex: cp.toIndex,
      fromGuessId: rebuilt.fromGuessId,
      toGuessId: rebuilt.toGuessId,
      root: cp.root,
      // Unknown without a log search, and nullable for that reason. /verify
      // proves inclusion against the root, which needs no hash.
      txHash: null,
      postedAt: new Date(cp.postedAt * 1000),
    });
  }

  await db.transaction(async (tx) => {
    // (round_id, checkpoint_id) is unique and not deferrable, so a row moving
    // onto an id another row is leaving would collide mid-update. Park every
    // row that moves on an id no real checkpoint can have, then set the real
    // one.
    for (const move of plan.renumber) {
      await tx
        .update(guessLogCheckpoints)
        .set({ checkpointId: -1_000_000 - move.id })
        .where(eq(guessLogCheckpoints.id, move.id));
    }
    for (const move of plan.renumber) {
      await tx
        .update(guessLogCheckpoints)
        .set({ checkpointId: move.to })
        .where(eq(guessLogCheckpoints.id, move.id));
    }
    if (rows.length > 0) await tx.insert(guessLogCheckpoints).values(rows);
  });

  const inserted = rows.map((r) => r.checkpointId as number);
  const renumbered = plan.renumber.map(({ from, to }) => ({ from, to }));
  console.log(
    `[guess-log] Round ${roundId}: reconciled the checkpoint table from the contract. ` +
      `Inserted ${JSON.stringify(inserted)}, renumbered ${JSON.stringify(renumbered)}.`
  );
  return { ok: true, inserted, renumbered };
}

/**
 * There is no `postFinalCheckpoint` any more, and that is deliberate.
 *
 * It existed so `resolveRoundAndCreatePayouts` could commit a round's tail the
 * instant the round closed. That call has been removed (see "NO GUESS-LOG
 * CHECKPOINT ON THE RESOLVE PATH" in economics.ts): it was an unguarded
 * mainnet write on a path with two "do not touch the chain" switches, it put an
 * un-timed `tx.wait()` inside the winning player's request, and it raced the
 * top-10 distribution for the operator nonce.
 *
 * The tail is committed by /api/cron/guess-log-checkpoint instead, which sweeps
 * resolved rounds that are short of the highest index they handed out. Sentry
 * reporting for a refused tail lives there now, on the cron's own error path.
 */

/** Checkpoints recorded locally for a round, oldest first. */
export async function getCheckpointsForRound(roundId: number) {
  return db
    .select()
    .from(guessLogCheckpoints)
    .where(eq(guessLogCheckpoints.roundId, roundId));
}

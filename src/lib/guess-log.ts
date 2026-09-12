/**
 * Merkle commitments over the round's guess log.
 *
 * The answer is committed onchain before a round opens and revealed after, and
 * /verify checks that. The guesses were never covered — and they decide the
 * money: first correct wins, and positions 1..850 set the top-10 payouts. This
 * builds the trees whose roots go to the GuessLog contract, so that once a
 * block of guesses is committed nobody can retell what was guessed, by whom,
 * or in what order.
 *
 * The leaf commits to `guessIndexInRound` rather than to a position this module
 * invents. That is the same 1-based number the top-10 lock already uses, so the
 * ordering being proved is the ordering that decides who gets paid, not a
 * parallel one that could drift from it.
 */
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { db } from '../db';
import { guesses, guessLogCheckpoints, rounds } from '../db/schema';
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';

/**
 * Leaf encoding. Must stay byte-identical to GuessLog.hashLeaf — the contract
 * abi.encodes these same five types and double-hashes, which is what
 * StandardMerkleTree does.
 */
export const GUESS_LEAF_TYPES = ['uint256', 'uint64', 'uint256', 'string', 'uint64'] as const;

export interface GuessLeaf {
  guessId: number;
  roundId: number;
  index: number;
  fid: number;
  word: string;
  guessedAt: number;
}

/** Row → the tuple that gets hashed. */
function toLeafValue(leaf: GuessLeaf): string[] {
  return [
    String(leaf.roundId),
    String(leaf.index),
    String(leaf.fid),
    leaf.word,
    String(leaf.guessedAt),
  ];
}

export function buildGuessTree(leaves: GuessLeaf[]): StandardMerkleTree<string[]> {
  if (leaves.length === 0) {
    throw new Error('Cannot build a Merkle tree over zero guesses');
  }
  return StandardMerkleTree.of(leaves.map(toLeafValue), [...GUESS_LEAF_TYPES]);
}

/**
 * Read a contiguous slice of a round's guess log, ordered the way the game
 * orders it.
 *
 * Rows with a null `guessIndexInRound` are skipped: they predate the column and
 * cannot be placed in the sequence the contract requires. That only affects
 * legacy rounds — the column has been written on every insert since the top-10
 * lock shipped, and the contiguity check in `collectPendingGuesses` refuses to
 * commit anything with a hole in it rather than papering over one.
 */
async function readGuesses(roundId: number, afterIndex: number): Promise<GuessLeaf[]> {
  const rows = await db
    .select({
      id: guesses.id,
      fid: guesses.fid,
      word: guesses.word,
      index: guesses.guessIndexInRound,
      createdAt: guesses.createdAt,
    })
    .from(guesses)
    .where(
      and(
        eq(guesses.roundId, roundId),
        isNotNull(guesses.guessIndexInRound),
        gt(guesses.guessIndexInRound, afterIndex)
      )
    )
    .orderBy(asc(guesses.guessIndexInRound));

  return rows.map((r) => ({
    guessId: r.id,
    roundId,
    index: r.index as number,
    fid: r.fid,
    word: r.word.toUpperCase(),
    guessedAt: Math.floor(r.createdAt.getTime() / 1000),
  }));
}

export interface PendingCheckpoint {
  roundId: number;
  fromIndex: number;
  toIndex: number;
  fromGuessId: number;
  toGuessId: number;
  root: string;
  leaves: GuessLeaf[];
  tree: StandardMerkleTree<string[]>;
}

/**
 * Everything committed so far for a round, as the contract sees it.
 *
 * Read from our own checkpoint table rather than from the chain on the hot
 * path; the poster reconciles against `nextIndex` onchain before sending, so a
 * divergence surfaces as a revert rather than as a silently wrong root.
 */
export async function lastCommittedIndex(roundId: number): Promise<number> {
  const [row] = await db
    .select({ maxToIndex: sql<number | null>`max(${guessLogCheckpoints.toIndex})` })
    .from(guessLogCheckpoints)
    .where(eq(guessLogCheckpoints.roundId, roundId));

  // Zero means nothing committed yet, which lines up with the log being
  // 1-based: the first checkpoint starts at index 1.
  return row?.maxToIndex ?? 0;
}

/**
 * A hole (or a duplicate) in `guess_index_in_round`.
 *
 * Its own class rather than a bare Error so callers can tell "the log is
 * structurally broken and a human has to look at it" apart from "the RPC was
 * down". They read identically as strings, and the cron used to treat both as
 * one 200/ok:false — which is how round 34 stayed wedged for 26 days without
 * anyone being told.
 */
export class GuessLogGapError extends Error {
  constructor(
    message: string,
    readonly roundId: number,
    readonly expectedIndex: number,
    readonly foundIndex: number
  ) {
    super(message);
    this.name = 'GuessLogGapError';
  }
}

/**
 * Gather the next block of guesses to commit.
 *
 * Returns null when there is nothing new. Throws if the log has a hole in it —
 * the contract enforces contiguity and would revert anyway, and a gap means
 * something is wrong upstream that should be looked at rather than skipped.
 */
export async function collectPendingGuesses(roundId: number): Promise<PendingCheckpoint | null> {
  const committedTo = await lastCommittedIndex(roundId);
  const leaves = await readGuesses(roundId, committedTo);

  if (leaves.length === 0) return null;

  const fromIndex = leaves[0].index;
  const toIndex = leaves[leaves.length - 1].index;

  if (fromIndex !== committedTo + 1) {
    throw new GuessLogGapError(
      `Guess log for round ${roundId} starts at index ${fromIndex}, expected ${committedTo + 1}. ` +
        `Refusing to commit a log with a gap.`,
      roundId,
      committedTo + 1,
      fromIndex
    );
  }
  if (toIndex - fromIndex + 1 !== leaves.length) {
    throw new GuessLogGapError(
      `Guess log for round ${roundId} covers indices ${fromIndex}..${toIndex} but has ` +
        `${leaves.length} rows. Refusing to commit a log with a gap.`,
      roundId,
      // The range says how many leaves there should be; the row count says how
      // many there are. Naming both is what turns this into a diagnosis.
      toIndex - fromIndex + 1,
      leaves.length
    );
  }

  const tree = buildGuessTree(leaves);

  return {
    roundId,
    fromIndex,
    toIndex,
    fromGuessId: leaves[0].guessId,
    toGuessId: leaves[leaves.length - 1].guessId,
    root: tree.root,
    leaves,
    tree,
  };
}

/**
 * Rebuild the tree for an already-committed checkpoint and produce the proof
 * for one guess in it.
 *
 * Rebuilt from the recorded index range rather than from "whatever is in the
 * table now", so later inserts cannot change a historical proof.
 */
export async function buildInclusionProof(
  roundId: number,
  guessId: number
): Promise<{
  checkpointId: number;
  root: string;
  leaf: GuessLeaf;
  proof: string[];
  txHash: string | null;
} | null> {
  const [row] = await db
    .select({
      index: guesses.guessIndexInRound,
    })
    .from(guesses)
    .where(and(eq(guesses.id, guessId), eq(guesses.roundId, roundId)))
    .limit(1);

  if (!row || row.index === null) return null;

  const checkpoints = await db
    .select()
    .from(guessLogCheckpoints)
    .where(eq(guessLogCheckpoints.roundId, roundId));

  const checkpoint = checkpoints.find(
    (c) => (row.index as number) >= c.fromIndex && (row.index as number) <= c.toIndex
  );
  if (!checkpoint) return null;

  const all = await readGuesses(roundId, checkpoint.fromIndex - 1);
  const leaves = all.filter((l) => l.index <= checkpoint.toIndex);

  const tree = buildGuessTree(leaves);
  const position = leaves.findIndex((l) => l.guessId === guessId);
  if (position === -1) return null;

  return {
    checkpointId: checkpoint.checkpointId,
    root: tree.root,
    leaf: leaves[position],
    proof: tree.getProof(position),
    txHash: checkpoint.txHash,
  };
}

/**
 * How far a live round's log may lag its last checkpoint before that counts as
 * a stall rather than a tick in progress.
 *
 * A PULL SIGNAL, and only a pull signal. It is read by
 * /api/admin/operational/round-health, which a person opens; nothing pushes on
 * it, and that is not an oversight. Every way the checkpointer can refuse while
 * it is still running — a table/contract mismatch, a duplicate or a hole in the
 * index sequence, a failed transaction — already raises its own alert from the
 * cron, and in each of those cases `collectPendingGuesses` has either thrown or
 * found nothing, so the lag is not what tells you. What this threshold actually
 * catches is the one failure the cron cannot report on: the cron not running at
 * all (schedule removed, CRON_SECRET rotated, GUESS_LOG_ADDRESS unset). A
 * process that is not executing cannot alert about itself.
 *
 * 50, not the 250 this shipped with. The cron runs every 5 minutes, so a
 * healthy round's uncommitted tail is whatever arrived in the last 5 minutes —
 * under one guess at round 34's five-an-hour, and still comfortably under 50 in
 * a launch-hour burst. 250 was calibrated against nothing: at the observed rate
 * it needed ~50 hours of total silence to trip, which is two days, not the
 * “within hours” its old comment claimed. 50 trips after ~10 hours at the slow
 * rate and inside an hour on a busy round.
 */
export const GUESS_LOG_LAG_WARNING = 50;

/**
 * How long a resolved round must have been resolved before the backlog sweep
 * will touch it.
 *
 * Not a politeness delay — a nonce guard. resolveRoundAndCreatePayouts marks
 * the round resolved and then launches the top-10 $WORD distribution as an
 * UN-AWAITED IIFE that keeps sending from OPERATOR_PRIVATE_KEY for some seconds
 * afterwards (economics.ts). The sweep signs postRoot from that same key on an
 * independently-built wallet, so a tick landing inside that window races the
 * distribution for a nonce and one of the two transactions is replaced.
 *
 * Ten minutes is two cron ticks of headroom over a distribution that takes
 * seconds. The cost is that a round's tail reaches the chain ~10-15 minutes
 * after it resolves instead of ~5. /verify is not a real-time surface, and a
 * dropped payout transaction would be.
 *
 * The real cure is a shared NonceManager around the operator wallet, which does
 * not exist yet; when it does, this can go.
 */
export const RESOLVE_SETTLE_MS = 10 * 60 * 1000;

/**
 * Duplicates and holes in a round's 1-based guess index sequence.
 *
 * Pure, and separated from the query on purpose: this is the diagnosis for a
 * wedged checkpointer, and a diagnosis nobody can test is not worth much.
 * `collectPendingGuesses` refuses to commit either condition, so whichever of
 * the two is present is the reason the log stopped advancing.
 */
export function analyzeGuessIndexSequence(indexes: number[]): {
  duplicates: number[];
  missing: number[];
  maxIndex: number;
} {
  const seen = new Set<number>();
  const duplicates = new Set<number>();
  let maxIndex = 0;

  for (const index of indexes) {
    if (seen.has(index)) duplicates.add(index);
    seen.add(index);
    if (index > maxIndex) maxIndex = index;
  }

  // Holes are measured against the highest index handed out, not against the
  // row count: a round missing index 7 still has a highest index equal to its
  // last guess, and comparing counts alone would hide it.
  const missing: number[] = [];
  for (let index = 1; index <= maxIndex; index++) {
    if (!seen.has(index)) missing.push(index);
  }

  return {
    duplicates: Array.from(duplicates).sort((a, b) => a - b),
    missing,
    maxIndex,
  };
}

export interface GuessLogIntegrity {
  roundId: number;
  totalGuesses: number;
  /** Rows carrying a guess_index_in_round — the only ones that can be committed. */
  indexedGuesses: number;
  /** Leaves the local checkpoint table says are committed (= max to_index). */
  committedLeaves: number;
  checkpointCount: number;
  /** Indexed guesses past the last checkpoint, i.e. the uncommitted tail. */
  uncommittedGuesses: number;
  duplicateIndexes: number[];
  missingIndexes: number[];
}

/**
 * Everything needed to say whether a round's guess log is intact, in two
 * queries and no RPC call.
 *
 * Reads the index column for the whole round rather than aggregating in SQL
 * because the answer that matters — *which* indices are duplicated or missing —
 * cannot be aggregated away. A round is a few thousand rows of one integer.
 */
export async function getGuessLogIntegrity(roundId: number): Promise<GuessLogIntegrity> {
  const rows = await db
    .select({ index: guesses.guessIndexInRound })
    .from(guesses)
    .where(eq(guesses.roundId, roundId));

  const indexes = rows
    .map((r) => r.index)
    .filter((index): index is number => index !== null);

  const { duplicates, missing } = analyzeGuessIndexSequence(indexes);

  const checkpoints = await db
    .select({ toIndex: guessLogCheckpoints.toIndex })
    .from(guessLogCheckpoints)
    .where(eq(guessLogCheckpoints.roundId, roundId));

  const committedLeaves = checkpoints.reduce((max, c) => Math.max(max, c.toIndex), 0);

  return {
    roundId,
    totalGuesses: rows.length,
    indexedGuesses: indexes.length,
    committedLeaves,
    checkpointCount: checkpoints.length,
    // Counted, not subtracted from the max index: a round with a hole would
    // otherwise report a tail longer than the rows that actually exist.
    uncommittedGuesses: indexes.filter((index) => index > committedLeaves).length,
    duplicateIndexes: duplicates,
    missingIndexes: missing,
  };
}

/**
 * The first round the onchain guess log ever covered, or null if it has never
 * covered one.
 *
 * Derived from the checkpoint table rather than hard-coded to a round number.
 * Rounds before it have no leaves onchain and never will, so both the self-heal
 * sweep and the admin health check use this to tell "this round predates the
 * log" apart from "this round's log is broken" — two states that otherwise look
 * identical, since both show zero checkpoints.
 *
 * NULL IS ITS OWN STATE, and callers must not fold it into "predates the log".
 * It means the log has never committed anything at all, which is both the
 * bootstrap state and the total-failure state — on 2026-08-17 every post was
 * refused with NonContiguous(expected 0, got 1) and this stayed null for weeks.
 * round-health reports that separately rather than reporting ok, and the cron
 * says so instead of claiming every logged round is committed.
 */
export async function getFirstLoggedRound(): Promise<number | null> {
  const [era] = await db
    .select({ firstRound: sql<number | null>`min(${guessLogCheckpoints.roundId})` })
    .from(guessLogCheckpoints);

  return era?.firstRound ?? null;
}

/**
 * How many recent rounds the self-heal sweep looks at.
 *
 * The sweep runs every 5 minutes and catches a resolved round up on the tick
 * after it resolves, so anything older than a handful of rounds is either
 * healthy or wedged on something a human has to fix — in both cases, widening
 * this window changes nothing. It has to be wider than 1 so that a round the
 * sweep cannot fix does not hide the ones behind it.
 */
const RECENT_ROUNDS_TO_SWEEP = 10;

export interface UncommittedRound {
  roundId: number;
  /**
   * Carried even though the guess log itself never branches on currency: this
   * repo's rule is that nothing rebuilt out of a rounds row may drop the
   * discriminator (it is optional in TypeScript, so omitting it type-checks and
   * reads as an ETH round), and the cron reports which round it healed.
   */
  prizeCurrency: string;
  prizePoolWord: string;
  seedPriceE18: string | null;
  /** Rows carrying an index. Exceeds `maxIndex` when the same index was handed out twice. */
  indexedGuesses: number;
  /** Distinct indexes handed out. Below `maxIndex` when the sequence has a hole. */
  distinctIndexes: number;
  /** Highest index handed out — the number `committedLeaves` is comparable to. */
  maxIndex: number;
  committedLeaves: number;
}

/**
 * Resolved rounds whose committed leaf count is short of the highest index they
 * handed out, newest first.
 *
 * This is the checkpointer's self-heal target, and since the resolve path stopped
 * committing its own tail (see "NO GUESS-LOG CHECKPOINT ON THE RESOLVE PATH" in
 * economics.ts) it is the ONLY thing that commits one. Nothing else can: the cron
 * follows the *active* round, and a round stops being active the moment it
 * resolves. Rounds that resolved before this shipped are recovered by the same
 * sweep, without anyone running SQL.
 *
 * SHORTFALL IS MEASURED max-TO-max, NOT max-TO-count. `committedLeaves` is
 * `max(to_index)` — a position in the index sequence, not a row count. Comparing
 * it against `count(*)` is only valid while the sequence is contiguous and
 * duplicate-free. `getNextGuessIndexInRound` (src/lib/guesses.ts) ALLOCATED it
 * without a lock until the per-round advisory lock shipped, and that is how this
 * log broke; the allocator is atomic now, so no NEW duplicate is handed out. The
 * measurement stays, because the fix is preventive only: it renumbers nothing,
 * and the rounds that already contain duplicates or holes still contain them
 * (round 34 certainly, round 35 possibly — it opened before the lock did). One
 * duplicate BELOW the committed mark used to make a round read as permanently
 * short while `collectPendingGuesses` had genuinely nothing left to commit —
 * so the sweep parked on it and answered
 * `selfHealed: true, posted: false` on every tick, forever, while any older round
 * with a real orphaned tail behind it was never reached.
 *
 * Returns a LIST for the same reason: a round can be short and still refuse (a
 * duplicate or a hole ABOVE the mark makes `collectPendingGuesses` throw), and the
 * caller has to be able to move on to the next one rather than stop there.
 *
 * RESOLVED, NOT MERELY FINISHED — a known gap, stated so nobody has to
 * rediscover it. The kill switch sets status 'cancelled' and deliberately
 * leaves resolvedAt NULL (src/lib/operational.ts; the invariant is spelled out
 * in farm-monitor.ts), so a cancelled round satisfies neither this predicate
 * nor getActiveRound's, and its uncommitted tail is committed by nothing at
 * all. Those guesses were really made and really ordered, so sealing them is
 * the likely right answer — `or(isNotNull(resolvedAt), eq(status,'cancelled'))`
 * costs one postRoot once and the round then drops out of this list forever.
 * It is not done here because it is a new operator send on a money-adjacent
 * path, and it also needs an `isResolved || isCancelled` branch in round-health
 * so a deliberately dead round stops reporting a stalled checkpointer.
 */
export async function findResolvedRoundsWithUncommittedGuesses(): Promise<UncommittedRound[]> {
  const firstLoggedRound = await getFirstLoggedRound();
  // No floor to sweep from. Every round would look short, including the whole
  // ETH era, and committing those is not what the operator asked for. This is
  // also the state a totally dead logger is in, which is why it is NOT reported
  // as success: /api/admin/operational/round-health flags a live round with zero
  // checkpoints, and the cron says so in its own response rather than claiming
  // every logged round is committed.
  if (firstLoggedRound === null) return [];

  // Three plain queries rather than one with correlated subqueries, on
  // purpose. Drizzle's `sql` template prints a column as its BARE name, so
  // `where ${guesses.roundId} = ${rounds.id}` comes out as
  // `where "round_id" = "id"` — inside a subquery that resolves against the
  // inner table, which has an `id` of its own, so it compares a row to itself
  // and returns a wrong number without erroring. Caught by this file's own
  // test; worth the extra round trips to make impossible.
  const candidates = await db
    .select({
      id: rounds.id,
      prizeCurrency: rounds.prizeCurrency,
      prizePoolWord: rounds.prizePoolWord,
      seedPriceE18: rounds.seedPriceE18,
    })
    .from(rounds)
    .where(
      and(
        isNotNull(rounds.resolvedAt),
        // Let a just-resolved round settle before signing anything for it: the
        // top-10 distribution is still in flight on the same operator key.
        // See RESOLVE_SETTLE_MS.
        lte(rounds.resolvedAt, new Date(Date.now() - RESOLVE_SETTLE_MS)),
        // Matches activeRoundConditions (rounds.ts): a mid-round dev test
        // round is a real row with real indexed guesses and no checkpoints, so
        // without this it looks short and the sweep sends a genuine mainnet
        // postRoot from the operator key for a round that was never played.
        // Unconditional, unlike the active-round filter, because the cron
        // spends gas and dev mode is not a reason to spend it.
        eq(rounds.isDevTestRound, false),
        gte(rounds.id, firstLoggedRound)
      )
    )
    .orderBy(desc(rounds.id))
    .limit(RECENT_ROUNDS_TO_SWEEP);

  if (candidates.length === 0) return [];

  const candidateIds = candidates.map((r) => r.id);

  const indexStats = await db
    .select({
      roundId: guesses.roundId,
      indexed: sql<number>`count(*)::int`,
      distinctIndexes: sql<number>`count(distinct ${guesses.guessIndexInRound})::int`,
      maxIndex: sql<number>`coalesce(max(${guesses.guessIndexInRound}), 0)::int`,
    })
    .from(guesses)
    .where(and(inArray(guesses.roundId, candidateIds), isNotNull(guesses.guessIndexInRound)))
    .groupBy(guesses.roundId);

  const committedCounts = await db
    .select({
      roundId: guessLogCheckpoints.roundId,
      committed: sql<number>`max(${guessLogCheckpoints.toIndex})::int`,
    })
    .from(guessLogCheckpoints)
    .where(inArray(guessLogCheckpoints.roundId, candidateIds))
    .groupBy(guessLogCheckpoints.roundId);

  const statsByRound = new Map(indexStats.map((r) => [r.roundId, r]));
  const committedByRound = new Map(committedCounts.map((r) => [r.roundId, r.committed]));

  const short: UncommittedRound[] = [];

  // Newest first, so a fresh orphaned tail is committed before an older one.
  for (const candidate of candidates) {
    const stats = statsByRound.get(candidate.id);
    const maxIndex = stats?.maxIndex ?? 0;
    const committedLeaves = committedByRound.get(candidate.id) ?? 0;
    if (committedLeaves >= maxIndex) continue;

    short.push({
      roundId: candidate.id,
      prizeCurrency: candidate.prizeCurrency,
      prizePoolWord: candidate.prizePoolWord,
      seedPriceE18: candidate.seedPriceE18,
      indexedGuesses: stats?.indexed ?? 0,
      distinctIndexes: stats?.distinctIndexes ?? 0,
      maxIndex,
      committedLeaves,
    });
  }

  return short;
}

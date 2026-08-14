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
import { guesses, guessLogCheckpoints } from '../db/schema';
import { and, asc, eq, gt, isNotNull, sql } from 'drizzle-orm';

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
    throw new Error(
      `Guess log for round ${roundId} starts at index ${fromIndex}, expected ${committedTo + 1}. ` +
        `Refusing to commit a log with a gap.`
    );
  }
  if (toIndex - fromIndex + 1 !== leaves.length) {
    throw new Error(
      `Guess log for round ${roundId} covers indices ${fromIndex}..${toIndex} but has ` +
        `${leaves.length} rows. Refusing to commit a log with a gap.`
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

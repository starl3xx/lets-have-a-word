import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../db';
import { rounds, guesses } from '../db/schema';
import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import { acquireWinnerRoundLocks, getNextGuessIndexInRound } from '../lib/guesses';

/**
 * guess_index_in_round is the position a guess occupies in the round, and the
 * onchain guess log is built from it: collectPendingGuesses refuses to commit
 * a range that is not strictly contiguous ("Refusing to commit a log with a
 * gap"). A duplicated index and a skipped index are therefore the same
 * outage — the log stops advancing and stays stopped, which is what round 34
 * did at 19 of 3,236 guesses for 26 days.
 *
 * The allocator was `count(*) + 1` with no lock, under a comment claiming it
 * used SELECT FOR UPDATE. These tests drive real concurrent transactions
 * against the real database, because the defect only exists between two of
 * them; a single-threaded test cannot see it.
 */

const FIVE_LETTER_WORDS = [
  'ALPHA', 'BRAVO', 'CRANE', 'DELTA', 'EAGLE', 'FLUTE',
  'GRAPE', 'HOUSE', 'INLET', 'JOLLY', 'KNEEL', 'LEMON',
];

async function createRoundRow(): Promise<number> {
  const [round] = await db
    .insert(rounds)
    .values({
      rulesetId: 1,
      answer: 'TESTS',
      salt: 'atomicity-salt',
      commitHash: 'atomicity-hash',
      prizePoolEth: '0',
      seedNextRoundEth: '0',
      // Round 35 is a $WORD round; the allocator is currency-blind, but a test
      // round that mirrors the live one keeps this honest if that ever changes.
      prizeCurrency: 'word',
      prizePoolWord: '116686114000000000000000000',
      seedPriceE18: '342800000000',
    })
    .returning();
  return round.id;
}

async function indexesFor(roundId: number): Promise<(number | null)[]> {
  const rows = await db
    .select({ index: guesses.guessIndexInRound })
    .from(guesses)
    .where(eq(guesses.roundId, roundId))
    .orderBy(asc(guesses.id));
  return rows.map((r) => r.index);
}

describe('guess index allocation is atomic', () => {
  let roundId: number;

  beforeEach(async () => {
    roundId = await createRoundRow();
  });

  afterEach(async () => {
    await db
      .update(rounds)
      .set({ status: 'resolved', resolvedAt: new Date() })
      .where(eq(rounds.id, roundId));
  });

  it('makes a second allocation in the same round wait for the first to commit', async () => {
    // The direct proof. Transaction A allocates and then holds itself open;
    // transaction B must not be able to read a high-water mark until A has
    // committed, because until then A's row does not exist in B's snapshot.
    // Under the old unlocked COUNT this assertion fails immediately: B reads
    // the same count as A and returns the same index.
    let releaseA!: () => void;
    const aMayCommit = new Promise<void>((resolve) => {
      releaseA = resolve;
    });

    let signalAllocated!: () => void;
    const aHasAllocated = new Promise<void>((resolve) => {
      signalAllocated = resolve;
    });

    let indexA = 0;
    let indexB = 0;
    let bHasAllocated = false;

    const txA = db.transaction(async (tx) => {
      indexA = await getNextGuessIndexInRound(roundId, tx);
      await tx.insert(guesses).values({
        roundId,
        fid: 900_001,
        word: FIVE_LETTER_WORDS[0],
        isCorrect: false,
        guessIndexInRound: indexA,
      });
      signalAllocated();
      await aMayCommit;
    });

    try {
      await aHasAllocated;

      const txB = db.transaction(async (tx) => {
        indexB = await getNextGuessIndexInRound(roundId, tx);
        bHasAllocated = true;
        await tx.insert(guesses).values({
          roundId,
          fid: 900_002,
          word: FIVE_LETTER_WORDS[1],
          isCorrect: false,
          guessIndexInRound: indexB,
        });
      });

      // Long enough that a non-blocking allocation would certainly have
      // finished, short enough not to slow the suite.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(bHasAllocated).toBe(false);

      releaseA();
      await Promise.all([txA, txB]);

      expect(indexA).toBe(1);
      expect(indexB).toBe(2);
    } finally {
      releaseA();
      await txA.catch(() => undefined);
    }
  });

  it('gives ten simultaneous guesses ten distinct, contiguous indexes', async () => {
    const allocated = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        db.transaction(async (tx) => {
          const index = await getNextGuessIndexInRound(roundId, tx);
          await tx.insert(guesses).values({
            roundId,
            fid: 910_000 + i,
            word: FIVE_LETTER_WORDS[i],
            isCorrect: false,
            guessIndexInRound: index,
          });
          return index;
        })
      )
    );

    expect([...allocated].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(await indexesFor(roundId)).size).toBe(10);
  });

  it('resumes at the high-water mark of a round that already holds duplicates', async () => {
    // Rounds that ran under the broken allocator kept their duplicates, and
    // rounds that predate the column kept their NULL-indexed rows. Allocation
    // has to step over that history rather than throw on it or renumber it.
    //
    // It also has to resume from MAX, not from COUNT. There are four rows
    // here and a high-water mark of 2, so COUNT(*) + 1 hands out 5 and leaves
    // 3 and 4 permanently empty — and an empty position wedges
    // collectPendingGuesses exactly as a duplicated one does.
    await db.insert(guesses).values([
      { roundId, fid: 920_001, word: FIVE_LETTER_WORDS[0], guessIndexInRound: 1 },
      { roundId, fid: 920_002, word: FIVE_LETTER_WORDS[1], guessIndexInRound: 1 },
      { roundId, fid: 920_003, word: FIVE_LETTER_WORDS[2], guessIndexInRound: 2 },
      { roundId, fid: 920_004, word: FIVE_LETTER_WORDS[3], guessIndexInRound: null },
    ]);

    const next = await db.transaction((tx) => getNextGuessIndexInRound(roundId, tx));
    expect(next).toBe(3);
  });

  it('starts an empty round at 1', async () => {
    const next = await db.transaction((tx) => getNextGuessIndexInRound(roundId, tx));
    expect(next).toBe(1);
  });

  it('does not burn an index when the guess transaction rolls back', async () => {
    // The lock is transaction-scoped, so a failed guess releases it, and the
    // uncommitted row never enters anyone else's high-water mark. A rejected
    // guess must not leave a permanent hole in the log.
    await expect(
      db.transaction(async (tx) => {
        const index = await getNextGuessIndexInRound(roundId, tx);
        await tx.insert(guesses).values({
          roundId,
          fid: 930_001,
          word: FIVE_LETTER_WORDS[0],
          isCorrect: false,
          guessIndexInRound: index,
        });
        throw new Error('guess rejected after allocation');
      })
    ).rejects.toThrow('guess rejected after allocation');

    const next = await db.transaction(async (tx) => {
      const index = await getNextGuessIndexInRound(roundId, tx);
      await tx.insert(guesses).values({
        roundId,
        fid: 930_002,
        word: FIVE_LETTER_WORDS[1],
        isCorrect: false,
        guessIndexInRound: index,
      });
      return index;
    });

    expect(next).toBe(1);
    expect(await indexesFor(roundId)).toEqual([1]);
  });

  it('lets the winning guess and a concurrent guess take both round locks without deadlocking', async () => {
    // The lock-ORDER proof, which none of the cases above can see: every test
    // in this file so far takes only the advisory lock, and the deadlock lives
    // between that lock and the rounds row.
    //
    // Two locks are in play per round. The advisory lock is explicit. The
    // second is not: guesses.round_id carries a foreign key to rounds, so
    // every INSERT INTO guesses silently takes FOR KEY SHARE on its rounds
    // row, and FOR KEY SHARE conflicts with the FOR UPDATE that the winner
    // transaction takes through getActiveRoundForUpdate. Take them in opposite
    // orders in two transactions and PostgreSQL kills one of them.
    //
    // The choreography below is deterministic rather than timing-dependent. B
    // (an ordinary guess) holds the advisory lock and has not yet inserted. W
    // (the winning guess) then starts:
    //   - correct order — W blocks on the advisory lock immediately and never
    //     touches the rounds row, so B's insert is unobstructed, B commits,
    //     and W proceeds. Both commit.
    //   - reversed order — W takes the rounds row FOR UPDATE first (nobody
    //     holds it) and only then queues for B's advisory lock; B's insert now
    //     needs FOR KEY SHARE on the row W holds. ABBA, and one of the two
    //     dies with 'deadlock detected'.

    // getActiveRoundForUpdate picks the newest active round rather than one by
    // id, so leave it nothing else to pick. The root beforeEach in setup.ts
    // already does this before every test; repeating it here means a round
    // leaked by an interrupted run cannot turn this case into a silent no-op.
    await db
      .update(rounds)
      .set({ status: 'resolved', resolvedAt: new Date() })
      .where(and(eq(rounds.status, 'active'), isNull(rounds.resolvedAt), ne(rounds.id, roundId)));

    let signalBHasLock!: () => void;
    const bHoldsAdvisoryLock = new Promise<void>((resolve) => {
      signalBHasLock = resolve;
    });
    let releaseB!: () => void;
    const bMayInsert = new Promise<void>((resolve) => {
      releaseB = resolve;
    });

    const txB = db.transaction(async (tx) => {
      const index = await getNextGuessIndexInRound(roundId, tx);
      signalBHasLock();
      await bMayInsert;
      await tx.insert(guesses).values({
        roundId,
        fid: 940_002,
        word: FIVE_LETTER_WORDS[1],
        isCorrect: false,
        guessIndexInRound: index,
      });
      return index;
    });

    let lockedRoundId: number | null = null;

    try {
      await bHoldsAdvisoryLock;

      const txW = db.transaction(async (tx) => {
        const { round: locked, guessIndexInRound } = await acquireWinnerRoundLocks(roundId, tx);
        lockedRoundId = locked?.id ?? null;
        await tx.insert(guesses).values({
          roundId,
          fid: 940_001,
          word: FIVE_LETTER_WORDS[0],
          isCorrect: true,
          guessIndexInRound,
        });
        await tx.update(rounds).set({ winnerFid: 940_001 }).where(eq(rounds.id, roundId));
        return guessIndexInRound;
      });

      // Long enough for W to have reached — and queued on — whichever lock it
      // asks for first. Postgres needs deadlock_timeout (1s by default) after
      // that to notice a cycle, so the reversed order fails on the awaits
      // below rather than here.
      await new Promise((resolve) => setTimeout(resolve, 300));
      releaseB();

      const [bResult, wResult] = await Promise.allSettled([txB, txW]);

      const reason = (r: PromiseSettledResult<number>) =>
        r.status === 'rejected' ? String((r.reason as Error)?.message ?? r.reason) : '';
      expect(
        `B:${bResult.status}${reason(bResult)} W:${wResult.status}${reason(wResult)}`
      ).toBe('B:fulfilled W:fulfilled');

      // Guards against a vacuous pass. If W had locked no rounds row at all,
      // or some other round's, it never contended with B and the case above
      // proves nothing about lock order. A failure HERE is a fixture problem,
      // not a deadlock — read it as "this round was not the active one".
      expect(
        lockedRoundId,
        'W locked no rounds row, so nothing was proved about lock order'
      ).toBe(roundId);

      // And the allocation is still correct across the pair.
      const indexes = await indexesFor(roundId);
      expect([...indexes].sort((a, b) => Number(a) - Number(b))).toEqual([1, 2]);
    } finally {
      releaseB();
      await txB.catch(() => undefined);
    }
  }, 20_000);

  it('does not serialise allocation across different rounds', async () => {
    // The lock key carries the round id. Two rounds guessing at once must not
    // queue behind each other — that would turn a per-round guard into a
    // global one on the hottest path in the game.
    const otherRoundId = await createRoundRow();
    try {
      let releaseFirst!: () => void;
      const firstMayCommit = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      let firstHasAllocated!: () => void;
      const allocated = new Promise<void>((resolve) => {
        firstHasAllocated = resolve;
      });

      const holdRound = db.transaction(async (tx) => {
        await getNextGuessIndexInRound(roundId, tx);
        firstHasAllocated();
        await firstMayCommit;
      });

      try {
        await allocated;
        const other = await db.transaction((tx) => getNextGuessIndexInRound(otherRoundId, tx));
        expect(other).toBe(1);
      } finally {
        releaseFirst();
        await holdRound.catch(() => undefined);
      }
    } finally {
      await db
        .update(rounds)
        .set({ status: 'resolved', resolvedAt: new Date() })
        .where(eq(rounds.id, otherRoundId));
    }
  });
});

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * The onchain guess log has to be able to fail LOUDLY.
 *
 * Round 34 committed five checkpoints in its first 25 minutes and then nothing
 * for 26 days: 3,217 guesses, including the winning one, never reached the
 * contract. Every cron tick in that window returned HTTP 200, so Vercel
 * reported a healthy schedule the whole time. Two separate defects produced
 * that, and this file covers both:
 *
 *   1. A refusal — a table/contract mismatch, or a gap in the index sequence —
 *      came back as success. The refusal itself is correct and stays; what is
 *      under test is that it is now visible in the response body and in Sentry.
 *   2. Nothing committed a round's tail after it resolved. The cron follows the
 *      ACTIVE round, and a resolved round is never active again, so the last
 *      guesses of every round were orphaned permanently. The cron's backlog
 *      sweep is now the ONLY thing that commits a tail — the resolve path's own
 *      checkpoint call was removed for being an unguarded mainnet write inside
 *      the winning player's request — so the sweep has to run on every tick and
 *      has to be able to walk past a round it cannot fix.
 *
 * The contract is mocked. Reaching Base from a test is a thing this repo has
 * been burned by, and what matters here is the decision the handler makes about
 * a result, not the transaction itself.
 */

const {
  mockGetActiveRound,
  mockPostNextCheckpoint,
  mockIsGuessLogConfigured,
  mockFindResolvedRounds,
  mockGetFirstLoggedRound,
  mockCaptureException,
  mockCaptureMessage,
} = vi.hoisted(() => ({
  mockGetActiveRound: vi.fn(),
  mockPostNextCheckpoint: vi.fn(),
  mockIsGuessLogConfigured: vi.fn(() => true),
  mockFindResolvedRounds: vi.fn(),
  mockGetFirstLoggedRound: vi.fn(),
  mockCaptureException: vi.fn(),
  mockCaptureMessage: vi.fn(),
}));

// Spread the real module rather than replacing it: other modules in this
// graph import other Sentry exports, and a bare factory would hand them
// undefined.
vi.mock('@sentry/nextjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sentry/nextjs')>();
  return { ...actual, captureException: mockCaptureException, captureMessage: mockCaptureMessage };
});

vi.mock('../lib/rounds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/rounds')>();
  return { ...actual, getActiveRound: mockGetActiveRound };
});

vi.mock('../lib/guess-log-contract', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/guess-log-contract')>();
  return {
    ...actual,
    postNextCheckpoint: mockPostNextCheckpoint,
    isGuessLogConfigured: mockIsGuessLogConfigured,
  };
});

/**
 * Only the sweep is mocked, and only for the handler tests: it reads every
 * recent round in the database, which is not something a test can pin down.
 * The real one is exercised against the database further down, via
 * `vi.importActual`.
 */
vi.mock('../lib/guess-log', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/guess-log')>();
  return {
    ...actual,
    findResolvedRoundsWithUncommittedGuesses: mockFindResolvedRounds,
    getFirstLoggedRound: mockGetFirstLoggedRound,
  };
});

import { db } from '../db';
import { rounds, guesses, guessLogCheckpoints } from '../db/schema';
import { eq } from 'drizzle-orm';
import {
  analyzeGuessIndexSequence,
  getGuessLogIntegrity,
  GuessLogGapError,
  RESOLVE_SETTLE_MS,
} from '../lib/guess-log';
import handler from '../../pages/api/cron/guess-log-checkpoint';

function mockReq(query: Record<string, string> = {}): NextApiRequest {
  return { method: 'POST', headers: {}, query } as unknown as NextApiRequest;
}

function mockRes() {
  const res: { statusCode: number; body: any; status: (c: number) => any; json: (b: any) => any } = {
    statusCode: 0,
    body: null,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: any) {
      res.body = body;
      return res;
    },
  };
  return res as typeof res & NextApiResponse;
}

async function run(query: Record<string, string> = {}) {
  const res = mockRes();
  await handler(mockReq(query), res);
  return res;
}

describe('guess-log checkpoint cron', () => {
  beforeEach(() => {
    mockGetActiveRound.mockReset().mockResolvedValue(null);
    mockFindResolvedRounds.mockReset().mockResolvedValue([]);
    mockGetFirstLoggedRound.mockReset().mockResolvedValue(34);
    mockPostNextCheckpoint.mockReset().mockResolvedValue({ posted: false, reasonCode: 'nothing-pending' });
    mockIsGuessLogConfigured.mockReset().mockReturnValue(true);
    mockCaptureException.mockReset();
    mockCaptureMessage.mockReset();
  });

  it('commits a resolved round that is short of its guess count when nothing is active', async () => {
    // The round-34 shape: the log stopped at leaf 19 and the round is over, so
    // there is no active round for the old code to follow.
    mockFindResolvedRounds.mockResolvedValue([
      {
        roundId: 34,
        prizeCurrency: 'word',
        prizePoolWord: '116686114000000000000000000',
        seedPriceE18: '256000000000',
        indexedGuesses: 3236,
        distinctIndexes: 3236,
        maxIndex: 3236,
        committedLeaves: 19,
      },
    ]);
    mockPostNextCheckpoint.mockResolvedValue({
      posted: true,
      roundId: 34,
      fromIndex: 20,
      toIndex: 3236,
      root: '0xroot',
      txHash: '0xtx',
      checkpointId: 5,
    });

    const res = await run();

    expect(mockPostNextCheckpoint).toHaveBeenCalledWith(34);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.selfHealed).toBe(true);
    expect(res.body.recovering.roundId).toBe(34);
    // The discriminator survives the trip. A rounds row rebuilt without it
    // reads as an ETH round, which is four bugs' worth of history in this repo.
    expect(res.body.recovering.prizeCurrency).toBe('word');
  });

  it('does the live round first, before it looks at the backlog', async () => {
    mockGetActiveRound.mockResolvedValue({ id: 35 });
    mockPostNextCheckpoint.mockResolvedValue({ posted: true, roundId: 35, fromIndex: 4, toIndex: 9 });

    await run();

    expect(mockPostNextCheckpoint).toHaveBeenNthCalledWith(1, 35);
  });

  it('sweeps the backlog on a tick that already committed live guesses', async () => {
    // The resolve path no longer commits a round's tail, so this sweep is the
    // ONLY thing that does. Round 36 starts within five minutes of round 35
    // resolving and is at its busiest right then, so a sweep that waited for an
    // idle tick would leave round 35's winning guess uncommitted on the weather.
    mockGetActiveRound.mockResolvedValue({ id: 36 });
    mockPostNextCheckpoint
      .mockResolvedValueOnce({ posted: true, roundId: 36, fromIndex: 1, toIndex: 4 })
      .mockResolvedValueOnce({ posted: true, roundId: 35, fromIndex: 20, toIndex: 3236 });
    mockFindResolvedRounds.mockResolvedValue([
      {
        roundId: 35,
        prizeCurrency: 'word',
        prizePoolWord: '116686114000000000000000000',
        seedPriceE18: '256000000000',
        indexedGuesses: 3236,
        distinctIndexes: 3236,
        maxIndex: 3236,
        committedLeaves: 19,
      },
    ]);

    const res = await run();

    expect(mockPostNextCheckpoint).toHaveBeenNthCalledWith(1, 36);
    expect(mockPostNextCheckpoint).toHaveBeenNthCalledWith(2, 35);
    expect(res.body.selfHealed).toBe(true);
    expect(res.body.roundId).toBe(35);
    // Both commits are reported; neither spread eats the other.
    expect(res.body.live.roundId).toBe(36);
  });

  it('walks past a backlog round that refuses, instead of parking on it', async () => {
    // Round 34's index sequence is broken, so it refuses on every tick and will
    // until a human repairs it. Stopping there is how an older round with a
    // genuinely orphaned tail behind it never gets reached.
    mockGetActiveRound.mockResolvedValue({ id: 35 });
    mockPostNextCheckpoint
      .mockResolvedValueOnce({ posted: false, reasonCode: 'nothing-pending', roundId: 35 })
      .mockRejectedValueOnce(
        new GuessLogGapError('Guess log for round 34 covers indices 20..3236', 34, 3217, 3218)
      )
      .mockResolvedValueOnce({ posted: true, roundId: 33, fromIndex: 900, toIndex: 1200 });
    mockFindResolvedRounds.mockResolvedValue([
      {
        roundId: 34,
        prizeCurrency: 'word',
        prizePoolWord: '0',
        seedPriceE18: null,
        indexedGuesses: 3237,
        distinctIndexes: 3236,
        maxIndex: 3236,
        committedLeaves: 19,
      },
      {
        roundId: 33,
        prizeCurrency: 'eth',
        prizePoolWord: '0',
        seedPriceE18: null,
        indexedGuesses: 1200,
        distinctIndexes: 1200,
        maxIndex: 1200,
        committedLeaves: 899,
      },
    ]);

    const res = await run();

    expect(mockPostNextCheckpoint).toHaveBeenNthCalledWith(3, 33);
    expect(res.body.selfHealed).toBe(true);
    expect(res.body.recovering.roundId).toBe(33);
    // A round refused weeks ago is NOT the same alert as a live stall: ok stays
    // true, the alert string is its own, and Sentry gets a warning rather than
    // an error.
    expect(res.body.ok).toBe(true);
    expect(res.body.alert).toBeUndefined();
    expect(res.body.backlogAlert).toBe('GUESS_LOG_BACKLOG_BLOCKED');
    expect(res.body.backlogBlocked[0].roundId).toBe(34);
    expect(res.body.backlogBlocked[0].gap).toBe(true);
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    expect(mockCaptureMessage.mock.calls[0][1].level).toBe('warning');
  });

  it('leaves an explicitly requested round alone rather than answering about another', async () => {
    mockPostNextCheckpoint.mockResolvedValue({ posted: false, reasonCode: 'nothing-pending', roundId: 34 });

    const res = await run({ roundId: '34' });

    expect(mockPostNextCheckpoint).toHaveBeenCalledTimes(1);
    expect(mockPostNextCheckpoint).toHaveBeenCalledWith(34);
    expect(mockFindResolvedRounds).not.toHaveBeenCalled();
    expect(res.body.roundId).toBe(34);
  });

  it('reports nothing to do when every logged round is fully committed', async () => {
    const res = await run();

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.skipped).toContain('fully committed');
    expect(res.body.logNeverCommitted).toBeUndefined();
    expect(mockPostNextCheckpoint).not.toHaveBeenCalled();
  });

  it('does not claim every logged round is committed when none ever was', async () => {
    // The bootstrap state and the total-failure state of the feature look
    // identical from the checkpoint table: both are empty. On 2026-08-17 it was
    // the failure one — every post refused with NonContiguous(expected 0, got 1)
    // — and the cron reported “every logged round is fully committed” throughout.
    mockGetFirstLoggedRound.mockResolvedValue(null);

    const res = await run();

    expect(res.body.logNeverCommitted).toBe(true);
    expect(res.body.skipped).toContain('never committed');
    expect(res.body.skipped).not.toContain('fully committed');
  });

  it('does not report success when the table and the contract disagree', async () => {
    mockGetActiveRound.mockResolvedValue({ id: 35 });
    mockPostNextCheckpoint.mockResolvedValue({
      posted: false,
      reasonCode: 'index-mismatch',
      roundId: 35,
      onchainLeaves: 19,
      localLeaves: 3236,
      reason: 'Checkpoint table and contract disagree for round 35',
    });

    const res = await run();

    // Still 200 — an erroring cron gets disabled, and a disabled schedule is
    // worse than a loud one. The loudness is everything else in the payload.
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.alert).toBe('GUESS_LOG_NOT_ADVANCING');
    expect(res.body.attention).toBeTruthy();
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    expect(mockCaptureMessage.mock.calls[0][1].tags.guessLogStalled).toBe('true');
  });

  it('still refuses a log with a gap, and says so where a person looks', async () => {
    mockGetActiveRound.mockResolvedValue({ id: 35 });
    mockPostNextCheckpoint.mockRejectedValue(
      new GuessLogGapError(
        'Guess log for round 35 starts at index 21, expected 20. Refusing to commit a log with a gap.',
        35,
        20,
        21
      )
    );

    const res = await run();

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.gap).toBe(true);
    expect(res.body.alert).toBe('GUESS_LOG_NOT_ADVANCING');
    expect(res.body.roundId).toBe(35);
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockCaptureException.mock.calls[0][1].tags.guessLogGap).toBe('true');
  });

  it('rejects an unparseable roundId instead of sending NaN to the contract', async () => {
    const res = await run({ roundId: 'thirty-five' });

    expect(res.statusCode).toBe(400);
    expect(mockPostNextCheckpoint).not.toHaveBeenCalled();
  });
});

describe('guess index sequence analysis', () => {
  it('accepts a contiguous log', () => {
    const { duplicates, missing, maxIndex } = analyzeGuessIndexSequence([1, 2, 3, 4]);
    expect(duplicates).toEqual([]);
    expect(missing).toEqual([]);
    expect(maxIndex).toBe(4);
  });

  it('names the hole, which is what makes the checkpointer refuse', () => {
    const { missing } = analyzeGuessIndexSequence([1, 2, 4, 5]);
    expect(missing).toEqual([3]);
  });

  it('names a duplicate index, the other way the same refusal happens', () => {
    // Two guesses handed the same index — the shape an unlocked counter
    // produces under concurrency.
    const { duplicates, missing } = analyzeGuessIndexSequence([1, 2, 2, 3]);
    expect(duplicates).toEqual([2]);
    expect(missing).toEqual([]);
  });

  it('treats an empty log as intact rather than as a hole at index 1', () => {
    const { duplicates, missing, maxIndex } = analyzeGuessIndexSequence([]);
    expect(duplicates).toEqual([]);
    expect(missing).toEqual([]);
    expect(maxIndex).toBe(0);
  });
});

/**
 * The two database reads behind the admin health check and the self-heal sweep.
 *
 * Written against the real schema because the value of both is entirely in the
 * SQL — a hand-written correlated subquery that returns the wrong number is not
 * something a mocked query builder would ever catch.
 */
describe('guess log integrity reads', () => {
  const created: number[] = [];

  async function makeResolvedRound(
    resolvedAt: Date = new Date(Date.now() - RESOLVE_SETTLE_MS - 60_000)
  ) {
    const salt = Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const [round] = await db
      .insert(rounds)
      .values({
        rulesetId: 1,
        answer: 'TESTS',
        salt,
        commitHash: salt,
        prizePoolEth: '0',
        seedNextRoundEth: '0',
        // Currency columns carried on every rounds write, same rule as reads.
        prizeCurrency: 'word',
        prizePoolWord: '116686114000000000000000000',
        seedPriceE18: '256000000000',
        status: 'resolved',
        // Older than RESOLVE_SETTLE_MS by default: the sweep deliberately
        // ignores a round that resolved moments ago, because the top-10
        // distribution is still sending from the operator key. Tests that want
        // the just-resolved case pass their own date.
        resolvedAt,
        winnerFid: 6500,
      })
      .returning();
    created.push(round.id);
    return round;
  }

  async function addGuess(roundId: number, index: number | null) {
    await db.insert(guesses).values({
      roundId,
      fid: 6500,
      word: 'CRANE',
      guessIndexInRound: index,
    });
  }

  async function addCheckpoint(roundId: number, checkpointId: number, fromIndex: number, toIndex: number) {
    await db.insert(guessLogCheckpoints).values({
      roundId,
      checkpointId,
      fromIndex,
      toIndex,
      fromGuessId: 1,
      toGuessId: 2,
      root: `0x${'a'.repeat(64)}`,
      txHash: `0x${'b'.repeat(64)}`,
      postedAt: new Date(),
    });
  }

  afterAll(async () => {
    for (const roundId of created) {
      await db.delete(guessLogCheckpoints).where(eq(guessLogCheckpoints.roundId, roundId));
      await db.delete(guesses).where(eq(guesses.roundId, roundId));
      await db.delete(rounds).where(eq(rounds.id, roundId));
    }
  });

  it('counts the tail and names both ways the sequence can break', async () => {
    const round = await makeResolvedRound();
    // 1, 2, 2, 4, 5 — a duplicate at 2 and a hole at 3 — plus a legacy row with
    // no index at all, which can never be committed and must not be counted as
    // part of the tail.
    for (const index of [1, 2, 2, 4, 5]) await addGuess(round.id, index);
    await addGuess(round.id, null);
    await addCheckpoint(round.id, 0, 1, 2);

    const integrity = await getGuessLogIntegrity(round.id);

    expect(integrity.totalGuesses).toBe(6);
    expect(integrity.indexedGuesses).toBe(5);
    expect(integrity.committedLeaves).toBe(2);
    expect(integrity.checkpointCount).toBe(1);
    expect(integrity.uncommittedGuesses).toBe(2); // indices 4 and 5
    expect(integrity.duplicateIndexes).toEqual([2]);
    expect(integrity.missingIndexes).toEqual([3]);
  });

  /** The real sweep, not the mock the handler tests use. */
  async function realSweep() {
    const { findResolvedRoundsWithUncommittedGuesses } =
      await vi.importActual<typeof import('../lib/guess-log')>('../lib/guess-log');
    return findResolvedRoundsWithUncommittedGuesses();
  }

  it('leaves a just-resolved round alone until the operator key has settled', async () => {
    // The nonce guard, not a politeness delay. resolveRoundAndCreatePayouts
    // marks the round resolved and then keeps sending the top-10 distribution
    // from OPERATOR_PRIVATE_KEY in an un-awaited IIFE; a sweep that signed
    // postRoot inside that window would race it for a nonce and one of the two
    // transactions would be replaced. The dropped one could be a payout.
    const justResolved = await makeResolvedRound(new Date());
    for (const index of [1, 2, 3, 4]) await addGuess(justResolved.id, index);
    await addCheckpoint(justResolved.id, 0, 1, 2);

    expect((await realSweep()).find((r) => r.roundId === justResolved.id)).toBeUndefined();

    // Same round, same shortfall, once the window has passed.
    await db
      .update(rounds)
      .set({ resolvedAt: new Date(Date.now() - RESOLVE_SETTLE_MS - 60_000) })
      .where(eq(rounds.id, justResolved.id));

    const settled = (await realSweep()).find((r) => r.roundId === justResolved.id);
    expect(settled).toBeDefined();
    expect(settled?.committedLeaves).toBe(2);
  });

  it('finds a resolved round whose log stops short, and stops finding it once it is caught up', async () => {
    const round = await makeResolvedRound();
    for (const index of [1, 2, 3, 4]) await addGuess(round.id, index);
    await addCheckpoint(round.id, 0, 1, 2);

    const short = (await realSweep()).find((r) => r.roundId === round.id);
    expect(short).toBeDefined();
    expect(short?.committedLeaves).toBe(2);
    expect(short?.indexedGuesses).toBe(4);
    expect(short?.maxIndex).toBe(4);
    // Same discriminator rule as everywhere else a rounds row is rebuilt.
    expect(short?.prizeCurrency).toBe('word');

    await addCheckpoint(round.id, 1, 3, 4);

    const afterTail = await realSweep();
    expect(afterTail.map((r) => r.roundId)).not.toContain(round.id);
  });

  it('does not call a round short because of a duplicate index BELOW the committed mark', async () => {
    // The sweep used to compare max(to_index) against count(*). Those are only
    // equal while the sequence is contiguous, and getNextGuessIndexInRound
    // allocated without a lock until the per-round advisory lock shipped, which
    // is how this log broke. The allocator is atomic now, so no new duplicate is
    // handed out — but it renumbers nothing, so rounds played before it (round 34
    // certainly, round 35 possibly) still carry theirs and the sweep still has to
    // measure this way. Here index 3 was handed out twice and everything up to 4 is
    // committed: count(*) is 5, max(to_index) is 4, so the old comparison
    // reported the round as permanently short while collectPendingGuesses had
    // nothing to commit — and the cron parked on it forever, answering
    // selfHealed with posted:false and never reaching an older round behind it.
    const round = await makeResolvedRound();
    for (const index of [1, 2, 3, 3, 4]) await addGuess(round.id, index);
    await addCheckpoint(round.id, 0, 1, 4);

    const swept = await realSweep();

    expect(swept.map((r) => r.roundId)).not.toContain(round.id);
  });

  it('still finds a round whose tail is genuinely orphaned above a duplicate', async () => {
    // Same duplicate, but the commit mark is behind it. This round IS short and
    // has to stay in the sweep so the cron can try (and, here, refuse) it.
    const round = await makeResolvedRound();
    for (const index of [1, 2, 3, 3, 4]) await addGuess(round.id, index);
    await addCheckpoint(round.id, 0, 1, 2);

    const short = (await realSweep()).find((r) => r.roundId === round.id);

    expect(short).toBeDefined();
    expect(short?.committedLeaves).toBe(2);
    expect(short?.maxIndex).toBe(4);
    // The duplicate is visible in the numbers rather than inferred from them.
    expect(short?.indexedGuesses).toBe(5);
    expect(short?.distinctIndexes).toBe(4);
  });
});

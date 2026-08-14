import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A guess that fails on the server must not be swallowed when the player
 * retries.
 *
 * /api/guess claims a Redis key per (fid, word) before processing, so that the
 * retry a player makes after the frontend's 12s timeout cannot spend a second
 * credit on a guess the server already recorded. That part is wanted.
 *
 * The bug was that the claim was never released. It was written before the
 * guess was processed and only ever expired, so it could not distinguish
 * "already recorded" from "attempted and failed". When submission threw — a DB
 * blip, an RPC hang on the correct-guess path — no row was written and no
 * credit spent, yet every retry for the next 30 seconds returned
 * `duplicate_ignored`. index.tsx renders that status as no banner at all, so
 * the player pressed GUESS and watched nothing happen.
 *
 * These tests drive the real handler against a fake Redis with real SET NX
 * semantics, because the bug lives in the protocol between the handler and the
 * key, not in either piece alone.
 */

// ---------------------------------------------------------------------------
// A Redis fake with the semantics the code actually depends on: SET NX must
// fail when the key exists, and values must round-trip as objects the way
// @upstash/redis deserializes them.
// ---------------------------------------------------------------------------
// vi.hoisted because vi.mock factories are lifted above ordinary consts.
const { store, fakeRedis } = vi.hoisted(() => {
  const store = new Map<string, unknown>();

  // Every operation yields to the event loop before it takes effect. Without
  // this the fake is effectively atomic, two "concurrent" requests can never
  // interleave, and the concurrency test below passes against a racy
  // implementation — which it did, until this was added.
  const roundtrip = () => new Promise((r) => setTimeout(r, 5));

  return {
    store,
    fakeRedis: {
      async set(key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) {
        await roundtrip();
        if (opts?.nx && store.has(key)) return null;
        store.set(key, value);
        return 'OK';
      },
      async get<T>(key: string): Promise<T | null> {
        await roundtrip();
        return (store.has(key) ? store.get(key) : null) as T | null;
      },
      async del(key: string) {
        await roundtrip();
        return store.delete(key) ? 1 : 0;
      },
    },
  };
});

vi.mock('../lib/redis', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/redis')>();
  return { ...actual, redis: fakeRedis };
});

// The guess rate limiter uses @upstash/ratelimit, which the fake does not
// implement. It is not what these tests are about.
vi.mock('../lib/rateLimit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/rateLimit')>();
  return {
    ...actual,
    checkGuessRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  };
});

// Everything on the path to submission that would otherwise touch the network
// or the database. The duplicate protocol is the subject; these are scenery.
vi.mock('../lib/operational-guard', () => ({
  applyGameplayGuard: vi.fn().mockResolvedValue(false),
}));
vi.mock('../lib/rounds', () => ({
  ensureActiveRound: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../lib/devMidRound', () => ({
  ensureDevMidRound: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../lib/users', () => ({
  upsertUserFromFarcaster: vi.fn().mockResolvedValue(undefined),
}));

const { submitGuessWithDailyLimits } = vi.hoisted(() => ({
  submitGuessWithDailyLimits: vi.fn(),
}));
vi.mock('../lib/daily-limits', () => ({ submitGuessWithDailyLimits }));

import handler from '../../pages/api/guess';
import { guessWasRecorded } from '../lib/guesses';
import type { SubmitGuessResult } from '../types';

const FID = 424242;
const WORD = 'CRANE';

function mockRes() {
  const res: any = {
    statusCode: 0,
    body: undefined as any,
    setHeader: vi.fn(),
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

async function submit(word = WORD) {
  const req: any = {
    method: 'POST',
    body: { word, devFid: FID },
    headers: {},
  };
  const res = mockRes();
  try {
    await handler(req, res);
  } catch {
    // The handler's own catch reports 500; a rethrow past it is still a
    // failed request as far as the player is concerned.
  }
  return res;
}

describe('a failed guess does not block the retry', () => {
  beforeEach(() => {
    store.clear();
    submitGuessWithDailyLimits.mockReset();
    delete process.env.NEYNAR_API_KEY; // take the devFid auth path
  });

  it('lets the retry through after submission throws', async () => {
    submitGuessWithDailyLimits.mockRejectedValueOnce(new Error('connection reset'));
    const first = await submit();
    expect(first.statusCode).toBe(500);

    // The retry must actually reach submission, not be absorbed.
    submitGuessWithDailyLimits.mockResolvedValueOnce({
      status: 'incorrect',
      word: WORD,
      totalGuessesForUserThisRound: 1,
    } satisfies SubmitGuessResult);

    const retry = await submit();
    expect(retry.body?.status).toBe('incorrect');
    expect(submitGuessWithDailyLimits).toHaveBeenCalledTimes(2);
  });

  it('still absorbs the retry when the guess was recorded', async () => {
    // The case the window exists for: the response was lost, not the guess.
    submitGuessWithDailyLimits.mockResolvedValueOnce({
      status: 'incorrect',
      word: WORD,
      totalGuessesForUserThisRound: 1,
    } satisfies SubmitGuessResult);
    await submit();

    const retry = await submit();
    expect(retry.body?.status).toBe('duplicate_ignored');
    // Not called a second time — this is what protects the credit.
    expect(submitGuessWithDailyLimits).toHaveBeenCalledTimes(1);
  });

  it('lets the retry through after the player buys a pack mid-window', async () => {
    submitGuessWithDailyLimits.mockResolvedValueOnce({
      status: 'no_guesses_left_today',
    } satisfies SubmitGuessResult);
    await submit();

    // Nothing was recorded and no credit spent, so retyping the same word
    // seconds later must work.
    submitGuessWithDailyLimits.mockResolvedValueOnce({
      status: 'incorrect',
      word: WORD,
      totalGuessesForUserThisRound: 1,
    } satisfies SubmitGuessResult);

    const retry = await submit();
    expect(retry.body?.status).toBe('incorrect');
  });

  it('absorbs a genuinely concurrent double-submit', async () => {
    // Two requests racing for the same word — a double-tap on a slow phone.
    // Exactly one may reach submission.
    //
    // The claim is a single SET NX for this reason. The GET-then-SET it
    // replaced let both requests read an empty key before either wrote, so
    // both proceeded and the second spent a credit on a word already being
    // processed. The redis fake yields between operations so that interleaving
    // is actually reachable here.
    submitGuessWithDailyLimits.mockResolvedValue({
      status: 'incorrect',
      word: WORD,
      totalGuessesForUserThisRound: 1,
    } satisfies SubmitGuessResult);

    const [a, b] = await Promise.all([submit(), submit()]);

    expect([a.body?.status, b.body?.status].sort()).toEqual([
      'duplicate_ignored',
      'incorrect',
    ]);
    expect(submitGuessWithDailyLimits).toHaveBeenCalledTimes(1);
  });

  it('treats a key left by the previous deploy as recorded', async () => {
    // The old code stored a bare timestamp. During a rollout those sit in Redis
    // for up to 30s; reading one as "pending" would be harmless, but reading it
    // as "never happened" would re-run a guess that may have been paid out.
    store.set(`lhaw:dup:guess:${FID}:${WORD}`, Date.now());

    const res = await submit();
    expect(res.body?.status).toBe('duplicate_ignored');
    expect(submitGuessWithDailyLimits).not.toHaveBeenCalled();
  });
});

describe('guessWasRecorded classification', () => {
  it('holds the claim for anything that wrote a row or moved tokens', () => {
    const recorded: SubmitGuessResult[] = [
      { status: 'correct', word: WORD, roundId: 1, winnerFid: FID },
      { status: 'incorrect', word: WORD, totalGuessesForUserThisRound: 1 },
      { status: 'bonus_word', word: WORD, tokenRewardAmount: '5000000', message: '' },
      { status: 'burn_word', word: WORD, burnAmount: '5000000', message: '' },
    ];
    for (const r of recorded) {
      expect(guessWasRecorded(r), r.status).toBe(true);
    }
  });

  it('releases the claim when nothing was written', () => {
    const notRecorded: SubmitGuessResult[] = [
      { status: 'round_closed' },
      { status: 'invalid_word', reason: 'not_in_dictionary' },
      { status: 'already_guessed_word', word: WORD },
      { status: 'no_guesses_left_today' },
      { status: 'superguess_blocked', guesserUsername: 'x', expiresAt: '' },
    ];
    for (const r of notRecorded) {
      expect(guessWasRecorded(r), r.status).toBe(false);
    }
  });
});

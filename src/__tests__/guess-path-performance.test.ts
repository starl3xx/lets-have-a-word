import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Three costs that sat on the hot path.
 *
 * The guess path runs for every guess by every player, and /api/round-state is
 * polled by the top ticker for everyone connected — so anything slow here is
 * paid repeatedly rather than once.
 */

const { mockTier, cacheStore } = vi.hoisted(() => ({
  mockTier: vi.fn(),
  cacheStore: new Map<string, unknown>(),
}));

// Redis is not configured under test, so cacheGet/cacheSet are no-ops and the
// caching logic would be invisible — the test would pass whether or not the
// cache was ever consulted. An in-memory stand-in makes the assertions real.
vi.mock('../lib/redis', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/redis')>();
  return {
    ...actual,
    cacheGet: async (key: string) => (cacheStore.has(key) ? cacheStore.get(key) : null),
    cacheSet: async (key: string, value: unknown) => {
      cacheStore.set(key, value);
    },
    cacheDel: async (key: string) => {
      cacheStore.delete(key);
    },
  };
});

vi.mock('../lib/word-token', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/word-token')>();
  return { ...actual, getWordBonusTier: mockTier };
});

import { db } from '../db';
import { rounds, guesses, users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { getGlobalGuessCount } from '../lib/wheel';
import { getWordBonusTierForFid } from '../lib/daily-limits';
import { getBaseProvider, getSepoliaProvider } from '../lib/word-token';
import { CacheKeys, cacheDel } from '../lib/redis';
import { getTodayUTC } from '../lib/daily-limits';

describe('the RPC provider', () => {
  it('is reused rather than rebuilt per call', () => {
    // Every call built a fresh JsonRpcProvider, discarding connection reuse and
    // re-running network detection — on a path that runs for every guess.
    expect(getBaseProvider()).toBe(getBaseProvider());
    expect(getSepoliaProvider()).toBe(getSepoliaProvider());
    expect(getBaseProvider()).not.toBe(getSepoliaProvider());
  });

  it('has a timeout short enough to matter', () => {
    // ethers defaults to 300 seconds, which is not a timeout in any useful
    // sense on a request path: the serverless function is long dead, and so is
    // every caller waiting on it.
    const provider = getBaseProvider() as any;
    const timeout = provider._getConnection?.().timeout;
    expect(timeout).toBeDefined();
    expect(timeout).toBeLessThanOrEqual(15_000);
    expect(timeout).toBeGreaterThan(0);
  });
});

describe('getGlobalGuessCount', () => {
  it('counts without shipping a row per guess', async () => {
    // This selected one column for every guess and returned `result.length`,
    // so a late round moved ~4,400 rows across the network to produce one
    // integer — on an endpoint the top ticker polls.
    const [round] = await db
      .insert(rounds)
      .values({
        rulesetId: 1,
        answer: 'TESTS',
        salt: 'perf-salt',
        commitHash: 'perf-hash',
        prizePoolEth: '0',
        seedNextRoundEth: '0',
      })
      .returning();

    try {
      await db.insert(guesses).values(
        Array.from({ length: 25 }, (_, i) => ({
          roundId: round.id,
          fid: 900_000 + i,
          word: 'HOUSE',
          isCorrect: false,
          guessIndexInRound: i + 1,
        }))
      );

      expect(await getGlobalGuessCount(round.id)).toBe(25);
      // And an empty round is 0, not a crash on an absent row.
      const [empty] = await db
        .insert(rounds)
        .values({
          rulesetId: 1,
          answer: 'EMPTY',
          salt: 'perf-salt-2',
          commitHash: 'perf-hash-2',
          prizePoolEth: '0',
          seedNextRoundEth: '0',
        })
        .returning();
      expect(await getGlobalGuessCount(empty.id)).toBe(0);
      await db.delete(rounds).where(eq(rounds.id, empty.id));
    } finally {
      await db.delete(guesses).where(eq(guesses.roundId, round.id));
      await db.delete(rounds).where(eq(rounds.id, round.id));
    }
  });
});

describe('the $WORD holder tier', () => {
  const FID = 987_654;

  beforeEach(async () => {
    mockTier.mockReset().mockResolvedValue(2);
    await cacheDel(CacheKeys.wordTier(FID, getTodayUTC())).catch(() => {});
    await db.delete(users).where(eq(users.fid, FID));
    await db.insert(users).values({
      fid: FID,
      signerWalletAddress: '0x' + '1'.repeat(40),
    });
  });

  it('reads the chain once, not once per guess', async () => {
    // getOrCreateDailyState re-checks the tier, and that runs on the guess
    // path — so this was an onchain balance read in front of every guess.
    const first = await getWordBonusTierForFid(FID);
    const second = await getWordBonusTierForFid(FID);
    const third = await getWordBonusTierForFid(FID);

    expect(first).toBe(2);
    expect(second).toBe(2);
    expect(third).toBe(2);
    expect(mockTier).toHaveBeenCalledTimes(1);

    await db.delete(users).where(eq(users.fid, FID));
  });

  it('does not cache a zero produced by an RPC failure', async () => {
    // A failed call is not evidence the player holds nothing. Caching it would
    // deny them bonus guesses for five minutes because of an outage on our
    // side, which is the one direction this must never fail in.
    mockTier.mockRejectedValueOnce(new Error('RPC down'));
    expect(await getWordBonusTierForFid(FID)).toBe(0);

    mockTier.mockResolvedValue(3);
    expect(await getWordBonusTierForFid(FID)).toBe(3);

    await db.delete(users).where(eq(users.fid, FID));
  });
});

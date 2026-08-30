import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

/**
 * Server hot-path caches (2026-08-30 first-load work).
 *
 * /api/round-state (polled every 15s per client) and /api/wheel (every
 * mount) paid a Postgres getActiveRound query even on full Redis hits, and
 * the global has-anyone-superguessed boolean ran uncached on every poll.
 * Both get caches here — and both caches carry integrity constraints worth
 * pinning: the active-round cache must hold the INTEGER ID ONLY (the Round
 * object contains the decrypted answer), and the superguess cache must
 * never let the global and per-fid variants share an entry.
 */

const { cacheStore } = vi.hoisted(() => ({
  cacheStore: new Map<string, unknown>(),
}));

// Redis is not configured under test, so cacheGet/cacheSet are no-ops and
// the caching logic would be invisible. An in-memory stand-in makes the
// assertions real — including the one about what NEVER enters the store.
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

import { db } from '../db';
import { rounds } from '../db/schema';
import { eq } from 'drizzle-orm';
import { CacheKeys } from '../lib/redis';

// Dynamic imports AFTER vi.resetModules(), not static: setup.ts's import
// chain (economics → rounds) loads rounds.ts with the REAL redis module
// before this file's vi.mock can apply, so the statically imported copy
// writes to a cache the test cannot see. Re-evaluating through the mock is
// what makes the store assertions real. (superguess.ts is not in setup's
// graph, but it is re-imported the same way for consistency.)
let roundsLib: typeof import('../lib/rounds');
let superguessLib: typeof import('../lib/superguess');

beforeAll(async () => {
  vi.resetModules();
  roundsLib = await import('../lib/rounds');
  superguessLib = await import('../lib/superguess');
});

const TEST_ANSWER = 'ZONKS';

describe('getActiveRoundId', () => {
  beforeEach(() => {
    cacheStore.clear();
  });

  it('agrees with getActiveRound and caches ONLY the integer id', async () => {
    const [round] = await db
      .insert(rounds)
      .values({
        rulesetId: 1,
        answer: TEST_ANSWER,
        salt: 'cache-salt',
        commitHash: 'cache-hash',
        prizePoolEth: '0',
        seedNextRoundEth: '0',
      })
      .returning();

    try {
      const canonical = await roundsLib.getActiveRound();
      const id = await roundsLib.getActiveRoundId();

      // The two readers share one definition of "active"; drift between
      // them is the bug class that once produced an answer disclosure.
      expect(id).toBe(canonical?.id ?? null);

      // THE guard this cache exists under: the stored value is a bare
      // integer (or the sentinel). getActiveRound() returns the DECRYPTED
      // answer, and no shape of it may ever be serialized into Redis.
      const stored = cacheStore.get(CacheKeys.activeRoundId());
      expect(typeof stored === 'number' || stored === 'none').toBe(true);
      expect(typeof stored).not.toBe('object');

      // Nothing in the entire store may contain the answer, under any key.
      const serialized = JSON.stringify(Array.from(cacheStore.entries()));
      expect(serialized).not.toContain(TEST_ANSWER);

      // A PROVABLE cache hit: delete the row first, so the id can only
      // come back from the cache — a silent fall-through to Postgres
      // (the failure mode that froze the price bar in #273) would return
      // a different answer here, not the same id.
      await db.delete(rounds).where(eq(rounds.id, round.id));
      expect(await roundsLib.getActiveRoundId()).toBe(id);
    } finally {
      await db.delete(rounds).where(eq(rounds.id, round.id));
    }
  });

  it('coerces a string round-trip, the way Upstash actually returns numbers', async () => {
    // Commit 0a6299f: this deployment's Redis returns numbers stored via
    // cacheSet as STRINGS, and a typeof guard silently missed on every
    // request for two days. The id cache must accept "57" as 57.
    cacheStore.set(CacheKeys.activeRoundId(), '57');
    expect(await roundsLib.getActiveRoundId()).toBe(57);
  });

  it('excludes winner-locked rounds, in agreement with getActiveRound', async () => {
    const [locked] = await db
      .insert(rounds)
      .values({
        rulesetId: 1,
        answer: TEST_ANSWER,
        salt: 'cache-salt-2',
        commitHash: 'cache-hash-2',
        prizePoolEth: '0',
        seedNextRoundEth: '0',
        winnerFid: 424242,
      })
      .returning();

    try {
      cacheStore.clear();
      const id = await roundsLib.getActiveRoundId();
      const canonical = await roundsLib.getActiveRound();
      // A round with a winner set is locked and not active — the id-only
      // reader must not resurrect it.
      expect(id).not.toBe(locked.id);
      expect(id).toBe(canonical?.id ?? null);
    } finally {
      await db.delete(rounds).where(eq(rounds.id, locked.id));
    }
  });
});

describe('the superguess used-this-round cache', () => {
  const ROUND_ID = 424_242_1;

  beforeEach(() => {
    cacheStore.clear();
  });

  it('serves the CACHED display variant from cache, string round-trips included', async () => {
    // Prime the cache: with no session rows at all, a cached `true` can
    // only come back if the cached path actually reads the cache.
    cacheStore.set(`lhaw:superguess:used:${ROUND_ID}`, true);
    expect(await superguessLib.hasUsedSuperguessThisRoundCached(ROUND_ID)).toBe(true);

    // Upstash can hand booleans back as strings (commit 0a6299f's failure
    // shape); both spellings must count as hits.
    cacheStore.set(`lhaw:superguess:used:${ROUND_ID}`, 'true');
    expect(await superguessLib.hasUsedSuperguessThisRoundCached(ROUND_ID)).toBe(true);
  });

  it('the MONEY-PATH function never reads the cache at all', async () => {
    // hasUsedSuperguessThisRound is what the purchase endpoint calls, and
    // money points read uncached, always. With a poisoned `true` in the
    // store and no session rows, it must still answer from the database —
    // for the global question AND the per-fid one.
    cacheStore.set(`lhaw:superguess:used:${ROUND_ID}`, true);
    expect(await superguessLib.hasUsedSuperguessThisRound(ROUND_ID)).toBe(false);
    expect(await superguessLib.hasUsedSuperguessThisRound(ROUND_ID, 6500)).toBe(false);
  });

  it('caches a genuine false from the display variant', async () => {
    expect(await superguessLib.hasUsedSuperguessThisRoundCached(ROUND_ID)).toBe(false);
    expect(cacheStore.get(`lhaw:superguess:used:${ROUND_ID}`)).toBe(false);
  });
});

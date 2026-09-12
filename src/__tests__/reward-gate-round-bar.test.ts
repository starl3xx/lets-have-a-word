import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The reward gate's bar comes from the ROUND, on every surface.
 *
 * Round 35 (live 2026-09-12) is where the split stopped being cosmetic. The
 * guess path priced the $3 bar from the round's frozen seed price — ~8.75M
 * tokens — while /api/user-state, the daily allocation and pack pricing priced
 * it from WORD_MARKET_CAP_USD / WORD_TOTAL_SUPPLY_TOKENS. That env var is not
 * set in production, so those three landed on WORD_MCAP_FALLBACK_USD and a bar
 * of 11,988,000 tokens: 37% higher, and nothing updates it at runtime. A
 * player holding $3.00–$4.11 of $WORD could guess, but was allocated zero free
 * guesses, denied the $WORD holder bonus, and shown as locked on the purchase
 * sheet.
 *
 * Needs the local test PostgreSQL like the rest of the suite; chain reads are
 * mocked and nothing here touches the network.
 */

// Redis is not configured under test, so cacheGet/cacheSet are no-ops and the
// round-scoped cache key would be invisible — a cache test would pass whether
// or not the key carried the round. An in-memory stand-in makes it real.
const { cacheStore } = vi.hoisted(() => ({ cacheStore: new Map<string, unknown>() }));

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

import { checkPlayEligibility, getPlayBarTokens } from '../lib/reward-gate';
import { getOrCreateDailyState, getTodayUTC, DAILY_LIMITS_RULES } from '../lib/daily-limits';
import * as wordToken from '../lib/word-token';
import * as roundsLib from '../lib/rounds';
import { CacheKeys } from '../lib/redis';
import { db } from '../db';
import { users, rounds, dailyGuessState } from '../db/schema';
import { eq } from 'drizzle-orm';
import {
  WORD_MCAP_FALLBACK_USD,
  WORD_TOTAL_SUPPLY_TOKENS,
  getHolderTierThresholds,
  wordMarketCapFromPriceUsd,
} from '../../config/economy';

/** The bar the three read-only surfaces used to run on: 11,988,000 tokens. */
const BAR_FALLBACK = Math.ceil(3 / (WORD_MCAP_FALLBACK_USD / WORD_TOTAL_SUPPLY_TOKENS));

/** priceE18 1e12 → $0.000001 per token → a $3 bar of 3,000,000 tokens. */
const PRICE_E18_CHEAP = '1000000000000';
const BAR_CHEAP = 3_000_000;

/** priceE18 2.5e11 → $0.00000025 per token → a $3 bar of 12,000,000 tokens. */
const PRICE_E18_DEAR = '250000000000';
const BAR_DEAR = 12_000_000;

/** The market cap the cheap round implies: $0.000001 × 99.9B tokens. */
const MCAP_CHEAP_ROUND = wordMarketCapFromPriceUsd(0.000001);

function mockBalance(balance: number, determined = true) {
  vi.spyOn(wordToken, 'getEffectiveBalanceChecked').mockResolvedValue({
    balance,
    determined,
  } as any);
}

function randomWallet(): string {
  const hex = Array.from({ length: 40 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
  return `0x${hex}`;
}

async function makeUser(): Promise<number> {
  const fid = Math.floor(Math.random() * 1_000_000) + 7_000_000;
  await db.insert(users).values({
    fid,
    username: `bar-test-${fid}`,
    signerWalletAddress: randomWallet(),
  });
  return fid;
}

/**
 * An active $WORD round carrying a seed price, inserted directly.
 *
 * createRound() would reach WordJackpot to seed it; the row is all this needs,
 * and production only ever exposes a $WORD round as `active` once the seed
 * price is written (rounds.ts), so this is the shape that really exists.
 */
async function createActiveWordRound(seedPriceE18: string): Promise<number> {
  const [round] = await db
    .insert(rounds)
    .values({
      rulesetId: 1,
      answer: 'BARRS',
      salt: `bar-${process.hrtime.bigint()}`.padEnd(64, '0').slice(0, 64),
      commitHash: 'b'.repeat(64),
      prizePoolEth: '0',
      seedNextRoundEth: '0',
      status: 'active',
      prizeCurrency: 'word',
      prizePoolWord: '116686114000000000000000000',
      seedPriceE18,
    })
    .returning({ id: rounds.id });

  // The active-round id is Redis-cached for 5s; a round created mid-test must
  // not be shadowed by the previous test's cached answer.
  cacheStore.delete(CacheKeys.activeRoundId());
  return round.id;
}

describe('Reward gate bar, priced from the round', () => {
  beforeEach(() => {
    process.env.REWARD_GATE_ENABLED = 'true';
    delete process.env.REWARD_GATE_MIN_USD;
    cacheStore.clear();
  });

  afterEach(async () => {
    delete process.env.REWARD_GATE_ENABLED;
    vi.restoreAllMocks();
    await db
      .update(rounds)
      .set({ status: 'resolved', resolvedAt: new Date() })
      .where(eq(rounds.status, 'active'));
  });

  it('is the premise of everything below: the constant bar is far above a cheap round bar', () => {
    expect(BAR_FALLBACK).toBe(11_988_000);
    expect(BAR_FALLBACK).toBeGreaterThan(BAR_CHEAP);
  });

  describe('getPlayBarTokens', () => {
    it('prefers the round seed price over any live price', () => {
      // A frozen bar is frozen: a live price ten thousand times higher must
      // not cheapen the gate mid-round.
      expect(getPlayBarTokens({ seedPriceE18: PRICE_E18_CHEAP }, 0.01)).toBe(BAR_CHEAP);
    });

    it('uses the live cached oracle price when no round price exists', () => {
      expect(getPlayBarTokens(null, 0.000001)).toBe(BAR_CHEAP);
    });

    it('falls back to the build-time constant only when there is no price at all', () => {
      expect(getPlayBarTokens(null, null)).toBe(BAR_FALLBACK);
      expect(getPlayBarTokens(null, 0)).toBe(BAR_FALLBACK);
      expect(getPlayBarTokens(null)).toBe(BAR_FALLBACK);
    });
  });

  /**
   * DECLARED FIRST ON PURPOSE. This is the COLD-INSTANCE case, and
   * getActiveBarRound's memo cannot be un-primed once a test has filled it —
   * any test above this one that resolves an active round would leave the memo
   * answering and make this pass for the wrong reason. The `determined: false`
   * assertion is what catches that if the order is ever disturbed.
   */
  describe('a bar that cannot be priced at all', () => {
    it('fails OPEN instead of measuring the player against the build-time constant', async () => {
      // Round 35 live, database blip on a freshly-booted lambda: the round
      // read throws, there is no memo behind it, and no oracle price is
      // cached. The bar then comes from WORD_MCAP_FALLBACK_USD — 37% above
      // round 35's real bar — and a success-shaped `below_bar` verdict is what
      // getOrCreateDailyState writes into the database as zero free guesses,
      // while /api/guess (which carries its own round) keeps admitting the
      // same player. Deciding on a number nobody priced is the defect; the
      // only safe answer is the player's.
      vi.spyOn(roundsLib, 'getActiveRoundId').mockRejectedValue(new Error('db down'));
      mockBalance(0);
      const fid = await makeUser();

      const result = await checkPlayEligibility(fid, { useCache: true });

      expect(result.eligible).toBe(true);
      expect(result.determined).toBe(false);
      expect(result.reason).toBeUndefined();
      // Never cached, so the next check retries instead of serving the outage.
      expect(
        cacheStore.has(`${CacheKeys.rewardGate(fid, getTodayUTC())}:rnone`)
      ).toBe(false);
    });

    it('leaves the day fully allocated rather than writing a gated row', async () => {
      vi.spyOn(roundsLib, 'getActiveRoundId').mockRejectedValue(new Error('db down'));
      mockBalance(0);
      vi.spyOn(wordToken, 'getWordBonusTierChecked').mockResolvedValue({
        tier: 0,
        determined: true,
      } as any);
      const fid = await makeUser();

      const state = await getOrCreateDailyState(fid, getTodayUTC());

      expect(state.freeAllocatedBase).toBe(DAILY_LIMITS_RULES.freeGuessesPerDayBase);

      await db.delete(dailyGuessState).where(eq(dailyGuessState.fid, fid));
    });
  });

  describe('a caller with no round in hand', () => {
    it('is decided against the ACTIVE round bar, not the constant', async () => {
      await createActiveWordRound(PRICE_E18_CHEAP);
      // The round-35 player: over the round's own bar, under the constant.
      mockBalance(BAR_CHEAP);
      const fid = await makeUser();

      const result = await checkPlayEligibility(fid);

      expect(result.eligible).toBe(true);
      expect(result.barTokens).toBe(BAR_CHEAP);
    });

    it('still blocks a balance below the round bar', async () => {
      // The fix must not turn into a general opening of the gate.
      await createActiveWordRound(PRICE_E18_CHEAP);
      mockBalance(BAR_CHEAP - 1);
      const fid = await makeUser();

      const result = await checkPlayEligibility(fid);

      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('below_bar');
      expect(result.barTokens).toBe(BAR_CHEAP);
    });

    it('follows a round whose bar is DEARER than the constant', async () => {
      // The round is the authority in both directions, not just the cheap one.
      await createActiveWordRound(PRICE_E18_DEAR);
      mockBalance(BAR_FALLBACK);
      const fid = await makeUser();

      const result = await checkPlayEligibility(fid);

      expect(BAR_DEAR).toBeGreaterThan(BAR_FALLBACK);
      expect(result.eligible).toBe(false);
      expect(result.barTokens).toBe(BAR_DEAR);
    });
  });

  describe('the daily allocation', () => {
    it('gives a player who clears the round bar their base guess and holder bonus', async () => {
      // The live bug: this player could guess and was allocated nothing to
      // guess with, because the allocation priced the bar from the constant.
      await createActiveWordRound(PRICE_E18_CHEAP);
      mockBalance(BAR_CHEAP);
      vi.spyOn(wordToken, 'getWordBonusTierChecked').mockResolvedValue({
        tier: 2,
        determined: true,
      } as any);
      const fid = await makeUser();

      const state = await getOrCreateDailyState(fid, getTodayUTC());

      expect(state.freeAllocatedBase).toBe(DAILY_LIMITS_RULES.freeGuessesPerDayBase);
      // Legacy column name; holds the $WORD holder tier, which the gate zeroed.
      expect(state.freeAllocatedClankton).toBe(2);

      await db.delete(dailyGuessState).where(eq(dailyGuessState.fid, fid));
    });

    it('prices the $WORD holder ladder from the round as well', async () => {
      // The gate's twin. The $25 / $50 / $75 ladder converts to tokens at a
      // market cap, and getWordBonusTierChecked defaulted that to the env var
      // nothing sets — so a holder was measured against thresholds struck at
      // $25,000 while round 35 was seeded near $34,200, and was handed fewer
      // bonus guesses than they had bought.
      await createActiveWordRound(PRICE_E18_CHEAP);
      mockBalance(BAR_CHEAP); // clears the play bar
      const HOLDING = 30_000_000;
      const seenMarketCaps: Array<number | undefined> = [];
      vi.spyOn(wordToken, 'getWordBonusTierChecked').mockImplementation(
        (async (_wallet: string | null, marketCapUsd?: number) => {
          seenMarketCaps.push(marketCapUsd);
          const thresholds = getHolderTierThresholds(marketCapUsd ?? 0);
          const tier =
            HOLDING >= thresholds.bonus3 ? 3
            : HOLDING >= thresholds.bonus2 ? 2
            : HOLDING >= thresholds.bonus1 ? 1
            : 0;
          return { tier, determined: true };
        }) as any
      );
      const fid = await makeUser();

      const state = await getOrCreateDailyState(fid, getTodayUTC());

      // The premise: at the build-time constant this holding is tier 0.
      expect(getHolderTierThresholds(WORD_MCAP_FALLBACK_USD).bonus1).toBeGreaterThan(HOLDING);
      // What the ladder was actually priced at.
      expect(seenMarketCaps[0]).toBeCloseTo(MCAP_CHEAP_ROUND, 0);
      expect(state.freeAllocatedClankton).toBe(1);

      await db.delete(dailyGuessState).where(eq(dailyGuessState.fid, fid));
    });

    it('still allocates zero below the round bar', async () => {
      await createActiveWordRound(PRICE_E18_CHEAP);
      mockBalance(BAR_CHEAP - 1);
      const fid = await makeUser();

      const state = await getOrCreateDailyState(fid, getTodayUTC());

      expect(state.freeAllocatedBase).toBe(0);
      expect(state.freeAllocatedClankton).toBe(0);

      await db.delete(dailyGuessState).where(eq(dailyGuessState.fid, fid));
    });
  });

  describe('entry floors stay with the callers that hand over a round', () => {
    it('records no floor when the bar was resolved rather than supplied', async () => {
      // Deliberate: recording here would cost /api/user-state one indexed
      // users read per poll, and a cache bypass — an onchain balance read —
      // on every poll until the floor existed.
      await createActiveWordRound(PRICE_E18_CHEAP);
      mockBalance(BAR_CHEAP);
      const fid = await makeUser();

      expect((await checkPlayEligibility(fid)).eligible).toBe(true);

      const [row] = await db
        .select({ floor: users.rewardGateBarTokens })
        .from(users)
        .where(eq(users.fid, fid));
      expect(row.floor).toBeNull();
    });

    it('still records the floor when the caller supplies the round', async () => {
      await createActiveWordRound(PRICE_E18_CHEAP);
      mockBalance(BAR_CHEAP);
      const fid = await makeUser();

      const result = await checkPlayEligibility(fid, {
        round: { id: 1, seedPriceE18: PRICE_E18_CHEAP, prizeCurrency: 'word' },
      });
      expect(result.eligible).toBe(true);

      const [row] = await db
        .select({ floor: users.rewardGateBarTokens })
        .from(users)
        .where(eq(users.fid, fid));
      expect(row.floor).toBe(BAR_CHEAP);
    });
  });

  describe('the verdict cache is scoped to the round', () => {
    it('does not let one round’s cached verdict decide the next round', async () => {
      // The key is (fid, day) plus the round. Without the round segment, a
      // pass cached under a cheap round would stand for up to five minutes
      // into a dearer one — and the reverse, a cached below_bar, is what
      // getOrCreateDailyState writes into the database as zero guesses.
      const cheapRoundId = await createActiveWordRound(PRICE_E18_CHEAP);
      mockBalance(BAR_CHEAP);
      const fid = await makeUser();

      const inCheapRound = await checkPlayEligibility(fid, { useCache: true });
      expect(inCheapRound.eligible).toBe(true);
      // The verdict is filed under the round that priced it.
      expect(
        cacheStore.has(`${CacheKeys.rewardGate(fid, getTodayUTC())}:r${cheapRoundId}`)
      ).toBe(true);

      await db
        .update(rounds)
        .set({ status: 'resolved', resolvedAt: new Date() })
        .where(eq(rounds.status, 'active'));
      await createActiveWordRound(PRICE_E18_DEAR);

      const inDearRound = await checkPlayEligibility(fid, { useCache: true });
      expect(inDearRound.eligible).toBe(false);
      expect(inDearRound.reason).toBe('below_bar');
      expect(inDearRound.barTokens).toBe(BAR_DEAR);
    });
  });

  describe('failure direction', () => {
    it('keeps deciding, on the last known round bar, when the round read throws', async () => {
      // Fail SOFT: a round read that errors must never be the reason a
      // paid-up holder is locked out.
      await createActiveWordRound(PRICE_E18_CHEAP);
      mockBalance(BAR_CHEAP);
      const fid = await makeUser();

      // Prime the in-process memo with the live round.
      expect((await checkPlayEligibility(fid)).barTokens).toBe(BAR_CHEAP);

      vi.spyOn(roundsLib, 'getActiveRoundId').mockRejectedValue(new Error('db down'));

      const result = await checkPlayEligibility(fid);
      expect(result.eligible).toBe(true);
      expect(result.barTokens).toBe(BAR_CHEAP);
    });

    it('decides on the fallback bar when no round is running', async () => {
      // Between rounds there is nothing to freeze against. The check must
      // still answer rather than throw — and this is an ANSWER, not the
      // degradation above: "no round is running" is known, "the round could
      // not be read" is not. Only the second one fails open.
      mockBalance(BAR_FALLBACK);
      const fid = await makeUser();

      const result = await checkPlayEligibility(fid);
      expect(result.eligible).toBe(true);
      expect(result.determined).toBe(true);
      expect(result.barTokens).toBe(BAR_FALLBACK);
    });
  });
});

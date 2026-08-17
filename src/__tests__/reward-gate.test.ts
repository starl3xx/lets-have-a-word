import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { checkPlayEligibility, getPlayBarTokens } from '../lib/reward-gate';
import { checkWinnerEligibility } from '../lib/winner-eligibility';
import { getOrCreateDailyState, getTodayUTC, DAILY_LIMITS_RULES } from '../lib/daily-limits';
import * as wordToken from '../lib/word-token';
import { db } from '../db';
import { users, rewardGateClaims, dailyGuessState } from '../db/schema';
import { eq } from 'drizzle-orm';
import {
  REWARD_GATE_GRANDFATHER_LAST_ROUND,
  WORD_MCAP_FALLBACK_USD,
  WORD_TOTAL_SUPPLY_TOKENS,
} from '../../config/economy';

/**
 * Reward Gate Tests
 *
 * The gate: hold or stake $3 of $WORD to play (round 34+), grandfather for
 * first guess in rounds 1–27, one wallet per FID per day. Requires the local
 * test PostgreSQL like the rest of the suite; chain reads are mocked.
 */

const BAR_FALLBACK = Math.ceil(
  3 / (WORD_MCAP_FALLBACK_USD / WORD_TOTAL_SUPPLY_TOKENS)
);

function mockBalance(balance: number, determined = true) {
  vi.spyOn(wordToken, 'getEffectiveBalanceChecked').mockResolvedValue({
    balance,
    determined,
  } as any);
}

async function makeUser(opts: {
  firstGuessRound?: number | null;
  wallet?: string | null;
}): Promise<number> {
  const fid = Math.floor(Math.random() * 1_000_000) + 5_000_000;
  await db.insert(users).values({
    fid,
    username: `gate-test-${fid}`,
    signerWalletAddress: opts.wallet ?? null,
    firstGuessRound: opts.firstGuessRound ?? null,
  });
  return fid;
}

function randomWallet(): string {
  const hex = Array.from({ length: 40 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
  return `0x${hex}`;
}

describe('Reward Gate', () => {
  beforeEach(() => {
    process.env.REWARD_GATE_ENABLED = 'true';
    delete process.env.REWARD_GATE_MIN_USD;
  });

  afterEach(async () => {
    delete process.env.REWARD_GATE_ENABLED;
    vi.restoreAllMocks();
  });

  describe('getPlayBarTokens', () => {
    it('freezes the bar from the round seed price when present', () => {
      // priceE18 = 1e12 → $0.000001 per token → $3 = 3,000,000 tokens
      const bar = getPlayBarTokens({ seedPriceE18: '1000000000000' });
      expect(bar).toBe(3_000_000);
    });

    it('falls back to the oracle mcap conversion without a round price', () => {
      expect(getPlayBarTokens(null)).toBe(BAR_FALLBACK);
      expect(getPlayBarTokens({ seedPriceE18: null })).toBe(BAR_FALLBACK);
    });
  });

  describe('checkPlayEligibility', () => {
    it('is a no-op when the gate is disabled', async () => {
      delete process.env.REWARD_GATE_ENABLED;
      const fid = await makeUser({ wallet: null });
      const result = await checkPlayEligibility(fid);
      expect(result.eligible).toBe(true);
    });

    it('grandfathers a first guess at or before round 27, with no wallet needed', async () => {
      const fid = await makeUser({ firstGuessRound: 5, wallet: null });
      const result = await checkPlayEligibility(fid);
      expect(result.eligible).toBe(true);
      expect(result.grandfathered).toBe(true);
    });

    it('grandfathers exactly at the boundary round', async () => {
      const fid = await makeUser({
        firstGuessRound: REWARD_GATE_GRANDFATHER_LAST_ROUND,
        wallet: null,
      });
      const result = await checkPlayEligibility(fid);
      expect(result.grandfathered).toBe(true);
    });

    it('does not grandfather a first guess in round 28', async () => {
      mockBalance(0);
      const fid = await makeUser({ firstGuessRound: 28, wallet: randomWallet() });
      const result = await checkPlayEligibility(fid);
      expect(result.eligible).toBe(false);
      expect(result.grandfathered).toBe(false);
    });

    it('blocks an account with no wallet', async () => {
      const fid = await makeUser({ wallet: null });
      const result = await checkPlayEligibility(fid);
      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('no_wallet');
    });

    it('blocks a balance below the bar', async () => {
      mockBalance(BAR_FALLBACK - 1);
      const fid = await makeUser({ wallet: randomWallet() });
      const result = await checkPlayEligibility(fid);
      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('below_bar');
      expect(result.balanceTokens).toBe(BAR_FALLBACK - 1);
    });

    it('passes a balance at the bar and records the wallet claim', async () => {
      mockBalance(BAR_FALLBACK);
      const wallet = randomWallet();
      const fid = await makeUser({ wallet });
      const result = await checkPlayEligibility(fid);
      expect(result.eligible).toBe(true);

      const claims = await db
        .select()
        .from(rewardGateClaims)
        .where(eq(rewardGateClaims.wallet, wallet.toLowerCase()));
      expect(claims.length).toBe(1);
      expect(claims[0].fid).toBe(fid);
    });

    it('lets one wallet vouch for only one FID per day', async () => {
      mockBalance(BAR_FALLBACK * 10);
      const wallet = randomWallet();
      const fidA = await makeUser({ wallet });
      const fidB = await makeUser({ wallet });

      const first = await checkPlayEligibility(fidA);
      expect(first.eligible).toBe(true);

      const second = await checkPlayEligibility(fidB);
      expect(second.eligible).toBe(false);
      expect(second.reason).toBe('wallet_already_claimed');

      // Idempotent for the claiming FID.
      const again = await checkPlayEligibility(fidA);
      expect(again.eligible).toBe(true);
    });

    it('records the entry floor on the first full pass', async () => {
      mockBalance(BAR_FALLBACK);
      const fid = await makeUser({ wallet: randomWallet() });
      const result = await checkPlayEligibility(fid);
      expect(result.eligible).toBe(true);

      const [row] = await db
        .select({ floor: users.rewardGateBarTokens, at: users.rewardGateQualifiedAt })
        .from(users)
        .where(eq(users.fid, fid));
      expect(row.floor).toBe(BAR_FALLBACK);
      expect(row.at).not.toBeNull();
    });

    it('honors the entry floor when a price crash raises the live bar', async () => {
      // A cheap early entry: the player once passed a 1,000-token bar.
      // Today's live bar (fallback) is far above that.
      expect(BAR_FALLBACK).toBeGreaterThan(1_000);
      const fid = await makeUser({ wallet: randomWallet() });
      await db
        .update(users)
        .set({ rewardGateBarTokens: 1_000, rewardGateQualifiedAt: new Date() })
        .where(eq(users.fid, fid));

      // Still holding the entry-floor tokens, worth far less than $3 now.
      mockBalance(1_000);
      const result = await checkPlayEligibility(fid);
      expect(result.eligible).toBe(true);
      expect(result.barTokens).toBe(1_000);
    });

    it('forfeits the floor when the tokens are sold below it', async () => {
      const fid = await makeUser({ wallet: randomWallet() });
      await db
        .update(users)
        .set({ rewardGateBarTokens: 1_000, rewardGateQualifiedAt: new Date() })
        .where(eq(users.fid, fid));

      mockBalance(999);
      const result = await checkPlayEligibility(fid);
      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('below_bar');
    });

    it('ratchets the floor down when a cheaper live bar is passed', async () => {
      const fid = await makeUser({ wallet: randomWallet() });
      const qualifiedAt = new Date('2026-08-01T00:00:00Z');
      await db
        .update(users)
        .set({ rewardGateBarTokens: 5_000_000, rewardGateQualifiedAt: qualifiedAt })
        .where(eq(users.fid, fid));

      // Round seed price makes the live bar 3,000,000 — cheaper than the floor.
      mockBalance(3_000_000);
      const result = await checkPlayEligibility(fid, {
        round: { seedPriceE18: '1000000000000' },
      });
      expect(result.eligible).toBe(true);

      const [row] = await db
        .select({ floor: users.rewardGateBarTokens, at: users.rewardGateQualifiedAt })
        .from(users)
        .where(eq(users.fid, fid));
      expect(row.floor).toBe(3_000_000);
      // The original qualification date is preserved through the ratchet.
      expect(row.at?.getTime()).toBe(qualifiedAt.getTime());
    });

    it('does not record a floor on a fail-open pass', async () => {
      mockBalance(0, /* determined */ false);
      const fid = await makeUser({ wallet: randomWallet() });
      const result = await checkPlayEligibility(fid);
      expect(result.eligible).toBe(true);
      expect(result.determined).toBe(false);

      const [row] = await db
        .select({ floor: users.rewardGateBarTokens })
        .from(users)
        .where(eq(users.fid, fid));
      expect(row.floor).toBeNull();
    });

    it('treats a malformed stored wallet as no wallet, not as an outage', async () => {
      const fid = await makeUser({ wallet: '0xnotanaddress' });
      const result = await checkPlayEligibility(fid);
      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('no_wallet');
      expect(result.determined).toBe(true);
    });

    it('fails open, marked undetermined, when the chain cannot be reached', async () => {
      mockBalance(0, /* determined */ false);
      const fid = await makeUser({ wallet: randomWallet() });
      const result = await checkPlayEligibility(fid);
      expect(result.eligible).toBe(true);
      expect(result.determined).toBe(false);
    });
  });

  describe('allocation floor (daily limits)', () => {
    it('allocates zero base guesses below the bar, then upgrades after a top-up', async () => {
      mockBalance(0);
      const wallet = randomWallet();
      const fid = await makeUser({ wallet });
      const dateStr = getTodayUTC();

      const gated = await getOrCreateDailyState(fid, dateStr);
      expect(gated.freeAllocatedBase).toBe(0);

      // Top up: the next touch upgrades the allocation. (Redis is absent in
      // tests, so the eligibility cache is transparent here.)
      mockBalance(BAR_FALLBACK);
      const ungated = await getOrCreateDailyState(fid, dateStr);
      expect(ungated.freeAllocatedBase).toBe(DAILY_LIMITS_RULES.freeGuessesPerDayBase);

      await db.delete(dailyGuessState).where(eq(dailyGuessState.fid, fid));
    });

    it('restores the base allocation when the gate is disabled mid-day', async () => {
      mockBalance(0);
      const fid = await makeUser({ wallet: randomWallet() });
      const dateStr = getTodayUTC();

      const gated = await getOrCreateDailyState(fid, dateStr);
      expect(gated.freeAllocatedBase).toBe(0);

      // The operational rollback: turn the flag off mid-day.
      delete process.env.REWARD_GATE_ENABLED;
      const restored = await getOrCreateDailyState(fid, dateStr);
      expect(restored.freeAllocatedBase).toBe(DAILY_LIMITS_RULES.freeGuessesPerDayBase);

      await db.delete(dailyGuessState).where(eq(dailyGuessState.fid, fid));
    });

    it('allocates the normal base with the gate disabled', async () => {
      delete process.env.REWARD_GATE_ENABLED;
      const fid = await makeUser({ wallet: null });
      const state = await getOrCreateDailyState(fid, getTodayUTC());
      expect(state.freeAllocatedBase).toBe(DAILY_LIMITS_RULES.freeGuessesPerDayBase);
      await db.delete(dailyGuessState).where(eq(dailyGuessState.fid, fid));
    });
  });

  describe('winner eligibility integration', () => {
    it('blocks a win below the bar with a below_play_bar reason', async () => {
      mockBalance(0);
      const fid = await makeUser({ wallet: randomWallet() });
      const result = await checkWinnerEligibility(fid);
      expect(result.eligible).toBe(false);
      expect(result.reasons.some((r) => r.startsWith('below_play_bar'))).toBe(true);
    });

    it('passes a grandfathered winner without a balance read', async () => {
      const spy = vi
        .spyOn(wordToken, 'getEffectiveBalanceChecked')
        .mockResolvedValue({ balance: 0, determined: true } as any);
      const fid = await makeUser({ firstGuessRound: 1, wallet: null });
      const result = await checkWinnerEligibility(fid);
      expect(result.eligible).toBe(true);
      expect(spy).not.toHaveBeenCalled();
    });

    it('does not consult the gate when disabled', async () => {
      delete process.env.REWARD_GATE_ENABLED;
      const fid = await makeUser({ wallet: null });
      const result = await checkWinnerEligibility(fid);
      expect(result.eligible).toBe(true);
      expect(result.rewardGateCheck).toBeUndefined();
    });
  });
});

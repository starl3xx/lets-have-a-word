/**
 * Reward Gate — hold or stake $3 of $WORD to play (round 34+).
 *
 * Three farm waves are on record (rounds 28, 29, 33). The gate prices the
 * swarm out: playing requires a wallet holding the round's USD bar in $WORD
 * (staked counts, via getEffectiveBalanceChecked), one wallet can vouch for
 * only one FID per game-day, and everyone whose first guess predates round 28
 * is grandfathered in free.
 *
 * ONE FUNCTION, ONE DECISION. Every caller — allocation, guess submission,
 * purchases, and the six money points — goes through checkPlayEligibility.
 * The guess path may use the 5-minute cache; money points must not
 * (useCache: false), because a farm that clears the bar at allocation and
 * dumps its tokens must still fail at the moment a reward is earned.
 *
 * FAILURE DIRECTION (decided 2026-08-15): if the chain cannot be reached, the
 * account passes and Sentry hears about it — the same fail-open-loudly
 * direction as every other gate here. An RPC blip must never void a real
 * player's win; the kill switch is the backstop.
 */
import * as Sentry from '@sentry/nextjs';
import { ethers } from 'ethers';
import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { users, rewardGateClaims } from '../db/schema';
import {
  isRewardGateEnabled,
  REWARD_GATE_PLAY_USD,
  REWARD_GATE_GRANDFATHER_LAST_ROUND,
  WORD_MARKET_CAP_USD,
  WORD_MCAP_FALLBACK_USD,
  WORD_TOTAL_SUPPLY_TOKENS,
} from '../../config/economy';
import { getEffectiveBalanceChecked } from './word-token';
import { e18PriceToUsd } from './word-amounts';
import { getTodayUTC } from './daily-limits';
import { CacheKeys, CacheTTL, cacheGet, cacheSet } from './redis';

export { isRewardGateEnabled } from '../../config/economy';

export type RewardGateReason =
  | 'no_wallet'
  | 'below_bar'
  | 'wallet_already_claimed';

export interface RewardGateResult {
  eligible: boolean;
  grandfathered: boolean;
  /** false means the chain could not be reached and the pass is fail-open */
  determined: boolean;
  reason?: RewardGateReason;
  /** The bar in whole tokens, for UI and logs */
  barTokens: number;
  balanceTokens?: number;
}

/** The shape of the round data the bar conversion needs. */
export interface RoundPriceSource {
  id?: number;
  seedPriceE18?: string | null;
}

const ELIGIBLE: RewardGateResult = {
  eligible: true,
  grandfathered: false,
  determined: true,
  barTokens: 0,
};

/**
 * The play bar in whole tokens for a round.
 *
 * Prefers the round's seed price — recorded by the seeding path, which fails
 * loud on a stale oracle — so the bar is FROZEN per round: a price crash
 * mid-round cannot cheapen the gate mid-round. Falls back to the oracle
 * market cap over total supply when no round price exists (between rounds,
 * dev mode, ETH-era rounds).
 */
export function getPlayBarTokens(round?: RoundPriceSource | null): number {
  let priceUsd = 0;
  if (round?.seedPriceE18) {
    try {
      priceUsd = e18PriceToUsd(BigInt(round.seedPriceE18));
    } catch {
      priceUsd = 0;
    }
  }
  if (priceUsd <= 0) {
    const mcap = WORD_MARKET_CAP_USD > 0 ? WORD_MARKET_CAP_USD : WORD_MCAP_FALLBACK_USD;
    priceUsd = mcap / WORD_TOTAL_SUPPLY_TOKENS;
  }
  return Math.ceil(REWARD_GATE_PLAY_USD / priceUsd);
}

interface CheckOptions {
  /** Round supplying the frozen seed price; omit to use the oracle fallback */
  round?: RoundPriceSource | null;
  /**
   * Read/write the 5-minute (fid, day) cache. The guess path sets this;
   * money points MUST leave it false so award-time checks see live balances.
   */
  useCache?: boolean;
  /**
   * Record the (day, wallet) claim on a pass. Left on everywhere — the claim
   * is idempotent for the same fid and is the wallet-uniqueness defense.
   */
  claimWallet?: boolean;
}

/**
 * The one decision: may this FID play (and earn) right now?
 */
export async function checkPlayEligibility(
  fid: number,
  opts: CheckOptions = {}
): Promise<RewardGateResult> {
  if (!isRewardGateEnabled()) {
    return ELIGIBLE;
  }

  const { round = null, useCache = false, claimWallet = true } = opts;
  const dateStr = getTodayUTC();
  // The cache key carries no round, so a cached entry may hold a verdict
  // computed against the oracle-fallback bar rather than this round's frozen
  // bar. That is accepted for the cached (guess/allocation) path — the two
  // bars differ by pennies — and is why every money point runs uncached.
  const cacheKey = CacheKeys.rewardGate(fid, dateStr);

  if (useCache) {
    try {
      const cached = await cacheGet<RewardGateResult>(cacheKey);
      if (cached && typeof cached.eligible === 'boolean') {
        return cached;
      }
    } catch {
      // Cache unavailable — fall through to the live check.
    }
  }

  const [user] = await db
    .select({
      firstGuessRound: users.firstGuessRound,
      signerWalletAddress: users.signerWalletAddress,
    })
    .from(users)
    .where(eq(users.fid, fid))
    .limit(1);

  // Grandfather: first guess in rounds 1–27 plays free forever.
  if (
    user?.firstGuessRound != null &&
    user.firstGuessRound <= REWARD_GATE_GRANDFATHER_LAST_ROUND
  ) {
    const result: RewardGateResult = { ...ELIGIBLE, grandfathered: true };
    if (useCache) await cacheSet(cacheKey, result, CacheTTL.rewardGate).catch(() => {});
    return result;
  }

  const barTokens = getPlayBarTokens(round);
  // A malformed stored address must read as "no wallet", not as an RPC
  // failure: getEffectiveBalanceChecked throws on it internally and reports
  // determined:false, which would turn one bad row into a permanent,
  // uncached, Sentry-spamming fail-open.
  const stored = user?.signerWalletAddress ?? null;
  const wallet = stored && ethers.isAddress(stored) ? stored : null;

  if (!wallet) {
    const result: RewardGateResult = {
      eligible: false,
      grandfathered: false,
      determined: true,
      reason: 'no_wallet',
      barTokens,
    };
    if (useCache) await cacheSet(cacheKey, result, CacheTTL.rewardGate).catch(() => {});
    return result;
  }

  const balance = await getEffectiveBalanceChecked(wallet);

  if (!balance.determined) {
    // Fail open, loudly. Never cached: the next check should retry the chain.
    Sentry.captureMessage('[RewardGate] Balance undetermined — failing open', {
      level: 'warning',
      tags: { fid: String(fid) },
    });
    console.warn(`[RewardGate] Balance undetermined for FID ${fid} — failing open`);
    return {
      eligible: true,
      grandfathered: false,
      determined: false,
      barTokens,
      balanceTokens: undefined,
    };
  }

  if (balance.balance < barTokens) {
    const result: RewardGateResult = {
      eligible: false,
      grandfathered: false,
      determined: true,
      reason: 'below_bar',
      barTokens,
      balanceTokens: balance.balance,
    };
    if (useCache) await cacheSet(cacheKey, result, CacheTTL.rewardGate).catch(() => {});
    return result;
  }

  // Wallet uniqueness: one wallet vouches for one FID per game-day.
  if (claimWallet) {
    const claimedByOther = await claimWalletForDay(dateStr, wallet, fid, round?.id);
    if (claimedByOther) {
      const result: RewardGateResult = {
        eligible: false,
        grandfathered: false,
        determined: true,
        reason: 'wallet_already_claimed',
        barTokens,
        balanceTokens: balance.balance,
      };
      if (useCache) await cacheSet(cacheKey, result, CacheTTL.rewardGate).catch(() => {});
      return result;
    }
  }

  const result: RewardGateResult = {
    ...ELIGIBLE,
    barTokens,
    balanceTokens: balance.balance,
  };
  if (useCache) await cacheSet(cacheKey, result, CacheTTL.rewardGate).catch(() => {});
  return result;
}

/**
 * Record the (day, wallet) claim. Returns true when the wallet is already
 * claimed by a DIFFERENT fid today — the caller must treat that as
 * ineligible. Idempotent for the same fid.
 */
async function claimWalletForDay(
  dateStr: string,
  wallet: string,
  fid: number,
  roundId?: number
): Promise<boolean> {
  const normalized = wallet.toLowerCase();

  const inserted = await db
    .insert(rewardGateClaims)
    .values({ date: dateStr, wallet: normalized, fid, roundId: roundId ?? null })
    .onConflictDoNothing()
    .returning({ id: rewardGateClaims.id });

  if (inserted.length > 0) {
    return false; // Fresh claim for this fid.
  }

  const [existing] = await db
    .select({ fid: rewardGateClaims.fid })
    .from(rewardGateClaims)
    .where(
      and(
        eq(rewardGateClaims.date, dateStr),
        eq(rewardGateClaims.wallet, normalized)
      )
    )
    .limit(1);

  return existing != null && existing.fid !== fid;
}

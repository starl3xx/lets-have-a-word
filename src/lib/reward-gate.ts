/**
 * Reward Gate — hold or stake $3 of $WORD to play (round 34+).
 *
 * Three farm waves are on record (rounds 28, 29, 33). The gate prices the
 * swarm out: playing requires a wallet holding the round's USD bar in $WORD
 * (staked counts, via getEffectiveBalanceChecked), one wallet can vouch for
 * only one FID per game-day, and everyone whose first guess predates round 28
 * is grandfathered in free.
 *
 * ENTRY FLOOR (added 2026-08-17): buying in once is honored for as long as
 * the tokens are held. The first full pass against a ROUND-FROZEN bar records
 * that bar on the user (ratcheting down monotonically, enforced in SQL), and
 * later checks pass at min(live bar, floor) — so a price crash, which raises
 * the token bar, can never lock out a paid-up holder. Oracle-fallback bars
 * are never recorded: they track the live price, and a mid-round pump would
 * let a floor undercut the round's frozen bar. Selling below the floor
 * forfeits it: the gate stays a holding requirement, never a badge.
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
import { eq, and, or, isNull, gt, sql } from 'drizzle-orm';
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
  /**
   * The bar in whole tokens, for UI and logs. This is the EFFECTIVE bar for
   * this player: min(the round's live bar, their recorded entry floor).
   */
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
 * The play bar in whole tokens for a round, plus whether it came from the
 * round's FROZEN seed price or the live oracle fallback.
 *
 * Prefers the round's seed price — recorded by the seeding path, which fails
 * loud on a stale oracle — so the bar is FROZEN per round: a price crash
 * mid-round cannot cheapen the gate mid-round. Falls back to the oracle
 * market cap over total supply when no round price exists (between rounds,
 * dev mode, ETH-era rounds).
 *
 * The `frozen` flag matters for the entry floor: only a frozen bar may be
 * recorded as a floor. The oracle-fallback bar moves with the live price, so
 * a mid-round pump would make it cheaper than the round's frozen bar — and a
 * floor written from it would permanently undercut the per-round freeze.
 */
export function getPlayBar(round?: RoundPriceSource | null): { tokens: number; frozen: boolean } {
  let priceUsd = 0;
  if (round?.seedPriceE18) {
    try {
      priceUsd = e18PriceToUsd(BigInt(round.seedPriceE18));
    } catch {
      priceUsd = 0;
    }
  }
  const frozen = priceUsd > 0;
  if (!frozen) {
    const mcap = WORD_MARKET_CAP_USD > 0 ? WORD_MARKET_CAP_USD : WORD_MCAP_FALLBACK_USD;
    priceUsd = mcap / WORD_TOTAL_SUPPLY_TOKENS;
  }
  return { tokens: Math.ceil(REWARD_GATE_PLAY_USD / priceUsd), frozen };
}

/** The play bar in whole tokens (see getPlayBar). */
export function getPlayBarTokens(round?: RoundPriceSource | null): number {
  return getPlayBar(round).tokens;
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
 * Should a cached eligible verdict be bypassed so the live check can record
 * the entry floor?
 *
 * True only when all of: the cached verdict is an eligible, non-grandfathered
 * pass; this call carries a round-FROZEN bar (round-less callers never record
 * floors); and the player's stored floor is missing or above that bar. Costs
 * one indexed row read on the cached path, and only until the floor is
 * recorded once. On a read error the cache verdict stands — the floor is an
 * enhancement, never a reason to fail or slow the guess path.
 */
async function cachedPassNeedsFloorWrite(
  cached: RewardGateResult,
  fid: number,
  round?: RoundPriceSource | null
): Promise<boolean> {
  if (!cached.eligible || cached.grandfathered) return false;
  const { tokens, frozen } = getPlayBar(round);
  if (!frozen) return false;
  try {
    const [row] = await db
      .select({ floor: users.rewardGateBarTokens })
      .from(users)
      .where(eq(users.fid, fid))
      .limit(1);
    return row != null && (row.floor == null || row.floor > tokens);
  } catch {
    return false;
  }
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
        // A cached eligible verdict normally stands for the day — but it was
        // usually written by a ROUND-LESS caller (user-state, allocation),
        // which returned before the floor logic ever ran. If this call
        // carries a frozen round bar and the player's floor is missing or
        // higher, bypass the cache once so the live check can record it;
        // after that single recording the floor is <= the frozen bar and
        // the cache short-circuits again.
        const bypassForFloor = await cachedPassNeedsFloorWrite(cached, fid, round);
        if (!bypassForFloor) {
          return cached;
        }
      }
    } catch {
      // Cache unavailable — fall through to the live check.
    }
  }

  const [user] = await db
    .select({
      firstGuessRound: users.firstGuessRound,
      signerWalletAddress: users.signerWalletAddress,
      rewardGateBarTokens: users.rewardGateBarTokens,
      rewardGateQualifiedAt: users.rewardGateQualifiedAt,
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

  const { tokens: liveBarTokens, frozen: barIsFrozen } = getPlayBar(round);
  // Entry floor: buying in once is honored for as long as the tokens are
  // held. A player who passed the gate keeps a personal bar at the cheapest
  // token bar they ever passed, so a price crash (which raises the live bar)
  // can never lock out a paid-up holder. Selling below the floor forfeits
  // it — this stays a HOLDING gate, never a badge.
  const entryFloor = user?.rewardGateBarTokens ?? null;
  const barTokens =
    entryFloor != null ? Math.min(liveBarTokens, entryFloor) : liveBarTokens;
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

  // Record / ratchet the entry floor on a full pass — but ONLY from a
  // round-frozen bar. The oracle-fallback bar (round-less callers: user-state,
  // allocation, pricing) tracks the live price, and a mid-round pump would
  // make it cheaper than the round's frozen bar; recording it would let the
  // floor permanently undercut the per-round freeze. Waiting for a
  // round-priced check costs nothing: the first guess of any round carries
  // one. When the write fires, the balance genuinely cleared liveBarTokens
  // (a floor below the live bar would have been the effective bar instead).
  //
  // The ratchet condition is enforced IN SQL, not from the row read above —
  // concurrent checks with different bars race, and a stale in-memory floor
  // must never let a higher bar overwrite a lower one. The JS check is only
  // a fast path to skip the write. Best-effort: a floor write failure must
  // never fail an eligible check.
  if (
    barIsFrozen &&
    user &&
    (user.rewardGateBarTokens == null || liveBarTokens < user.rewardGateBarTokens)
  ) {
    try {
      await db
        .update(users)
        .set({
          rewardGateBarTokens: liveBarTokens,
          rewardGateQualifiedAt: sql`COALESCE(${users.rewardGateQualifiedAt}, NOW())`,
        })
        .where(
          and(
            eq(users.fid, fid),
            or(
              isNull(users.rewardGateBarTokens),
              gt(users.rewardGateBarTokens, liveBarTokens)
            )
          )
        );
    } catch (error) {
      console.error(`[RewardGate] Failed to record entry floor for FID ${fid}:`, error);
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

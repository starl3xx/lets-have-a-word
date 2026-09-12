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
 * the token bar, can never lock out a paid-up holder. Fallback bars are never
 * recorded: they track the live price, and a mid-round pump would let a floor
 * undercut the round's frozen bar. Nor are floors written by the read-only
 * surfaces, whose bar is frozen but whose per-request cost budget is not — see
 * mayRecordFloor. Selling below the floor forfeits it: the gate stays a
 * holding requirement, never a badge.
 *
 * ONE FUNCTION, ONE DECISION. Every caller — allocation, guess submission,
 * purchases, and the six money points — goes through checkPlayEligibility.
 * The guess path may use the 5-minute cache; money points must not
 * (useCache: false), because a farm that clears the bar at allocation and
 * dumps its tokens must still fail at the moment a reward is earned.
 *
 * ONE BAR, TOO (fixed 2026-09-12). Callers that hold the round hand it over;
 * callers that do not — /api/user-state, the daily allocation, pack pricing —
 * get the ACTIVE round's frozen bar resolved for them here. They used to price
 * the bar from WORD_MARKET_CAP_USD / WORD_TOTAL_SUPPLY_TOKENS instead, and
 * that env var is not set in production, so they ran on WORD_MCAP_FALLBACK_USD
 * — a build-time constant nothing updates (the 15-minute oracle cron pushes to
 * the contract, not into the bundle). For round 35 the two bars were 37%
 * apart: a player holding $3.00–$4.11 of $WORD cleared the round's own bar on
 * the guess path while being allocated zero free guesses, denied the $WORD
 * holder bonus, and shown as locked on the purchase sheet.
 *
 * FAILURE DIRECTION (decided 2026-08-15): if the chain cannot be reached, the
 * account passes and Sentry hears about it — the same fail-open-loudly
 * direction as every other gate here. An RPC blip must never void a real
 * player's win; the kill switch is the backstop.
 *
 * THE BAR ITSELF FOLLOWS THAT RULE TOO (2026-09-12). If the round cannot be
 * read and no price is cached, there is no bar — only WORD_MCAP_FALLBACK_USD,
 * the constant that caused the split above. Deciding on it would re-create the
 * defect silently, so that case passes, reports determined:false, is never
 * cached, and raises Sentry under the tag rewardGateDegraded.
 */
import * as Sentry from '@sentry/nextjs';
import { ethers } from 'ethers';
import { eq, and, or, isNull, gt, sql } from 'drizzle-orm';
import { db } from '../db';
import { users, rewardGateClaims, rounds } from '../db/schema';
import {
  isRewardGateEnabled,
  REWARD_GATE_PLAY_USD,
  REWARD_GATE_GRANDFATHER_LAST_ROUND,
  WORD_MARKET_CAP_USD,
  WORD_MCAP_FALLBACK_USD,
  WORD_TOTAL_SUPPLY_TOKENS,
  wordMarketCapFromPriceUsd,
} from '../../config/economy';
import { getEffectiveBalanceChecked } from './word-token';
import { e18PriceToUsd } from './word-amounts';
import { getTodayUTC } from './daily-limits';
import { getActiveRoundId } from './rounds';
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
  /**
   * The currency era the price snapshot belongs to. CARRY THEM wherever you
   * build this object from a `rounds` select — that is the shape which has
   * silently lost `prize_currency` four times in this repo (CLAUDE.md).
   *
   * But the doc must match what the type can enforce, and it cannot enforce
   * this: both fields are optional, and two suppliers outside this file build
   * a RoundPriceSource from a hand-written select of (id, seedPriceE18) only —
   * economics.ts's Top-10 gate at resolve, and retry-bonus-distribution.ts.
   * TypeScript reports nothing, and a missing `prizeCurrency` reads as an ETH
   * round.
   *
   * So the contract this file keeps is the one it can: THE GATE NEVER BRANCHES
   * ON THESE FIELDS. Anything that must decide on the era reads the round
   * itself — an era branch here would take the ETH path for every Top-10
   * candidate on the resolve-time money path, with nothing to catch it.
   */
  prizeCurrency?: string | null;
  prizePoolWord?: string | null;
}

const ELIGIBLE: RewardGateResult = {
  eligible: true,
  grandfathered: false,
  determined: true,
  barTokens: 0,
};

/**
 * Sentry for a DEGRADED gate decision, throttled to once a minute per process
 * per tag.
 *
 * Degradation is decided per request, and /api/user-state polls every few
 * seconds, so an unthrottled capture would push thousands of identical events
 * through the very outage it exists to report — and Sentry's quota would then
 * drop the ones that matter. A console.warn alone was the previous behaviour,
 * which is how the gate could fall back onto the build-time constant with no
 * signal anyone reads.
 */
const degradedReportedAt = new Map<string, number>();
const DEGRADED_REPORT_INTERVAL_MS = 60_000;

function reportDegraded(
  tag: string,
  message: string,
  extra?: Record<string, unknown>
): void {
  console.warn(`[RewardGate] ${message}`, extra ?? '');
  const now = Date.now();
  if (now - (degradedReportedAt.get(tag) ?? 0) < DEGRADED_REPORT_INTERVAL_MS) return;
  degradedReportedAt.set(tag, now);
  Sentry.captureMessage(`[RewardGate] ${message}`, {
    level: 'warning',
    tags: { rewardGateDegraded: tag },
    extra,
  });
}

/**
 * Which price a bar was struck from.
 *
 * 'round'    — the round's FROZEN seed price. The authority.
 * 'oracle'   — the Redis-cached live price, when no round price is in scope.
 * 'constant' — WORD_MCAP_FALLBACK_USD / supply. This is NOT a price: it is a
 *              build-time number nothing updates, kept only so the division
 *              can never be by zero. A bar struck from it is an UNPRICED bar,
 *              and callers must treat it as an absence, not an answer.
 */
export type BarPriceSource = 'round' | 'oracle' | 'constant';

/** The $WORD price a bar (or a threshold) should be struck from. */
function resolveWordPriceUsd(
  round?: RoundPriceSource | null,
  liveOraclePriceUsd?: number | null
): { priceUsd: number; source: BarPriceSource } {
  if (round?.seedPriceE18) {
    try {
      const priceUsd = e18PriceToUsd(BigInt(round.seedPriceE18));
      if (priceUsd > 0) return { priceUsd, source: 'round' };
    } catch {
      // An unparseable snapshot is not a price — fall through to the live one.
    }
  }
  if (
    liveOraclePriceUsd != null &&
    Number.isFinite(liveOraclePriceUsd) &&
    liveOraclePriceUsd > 0
  ) {
    return { priceUsd: liveOraclePriceUsd, source: 'oracle' };
  }
  const mcap = WORD_MARKET_CAP_USD > 0 ? WORD_MARKET_CAP_USD : WORD_MCAP_FALLBACK_USD;
  return { priceUsd: mcap / WORD_TOTAL_SUPPLY_TOKENS, source: 'constant' };
}

/**
 * The play bar in whole tokens for a round, plus whether it came from the
 * round's FROZEN seed price or a live fallback.
 *
 * Prefers the round's seed price — recorded by the seeding path, which fails
 * loud on a stale oracle — so the bar is FROZEN per round: a price crash
 * mid-round cannot cheapen the gate mid-round. Callers reach this through
 * checkPlayEligibility, which resolves the active round when the caller has
 * none, so the fallback below is only for a round that was never priced in
 * $WORD at all (ETH-era rounds, dev mode) or for the gap between rounds.
 *
 * `liveOraclePriceUsd` is the Redis-cached live price (see word-oracle.ts),
 * passed in rather than read here so this stays synchronous for its callers.
 * It comes before WORD_MARKET_CAP_USD on purpose: that env var is unset in
 * production, so the last resort below is really WORD_MCAP_FALLBACK_USD, a
 * build-time constant nothing updates. It is kept only so the division can
 * never be by zero.
 *
 * The `frozen` flag matters for the entry floor: only a frozen bar may be
 * recorded as a floor. A fallback bar moves with the live price, so a
 * mid-round pump would make it cheaper than the round's frozen bar — and a
 * floor written from it would permanently undercut the per-round freeze.
 */
export function getPlayBar(
  round?: RoundPriceSource | null,
  liveOraclePriceUsd?: number | null
): { tokens: number; frozen: boolean; priced: boolean } {
  const { priceUsd, source } = resolveWordPriceUsd(round, liveOraclePriceUsd);
  return {
    tokens: Math.ceil(REWARD_GATE_PLAY_USD / priceUsd),
    frozen: source === 'round',
    // `priced: false` means the number is arithmetic, not a bar. See
    // checkPlayEligibility, which refuses to lock anyone out on one.
    priced: source !== 'constant',
  };
}

/** The play bar in whole tokens (see getPlayBar). */
export function getPlayBarTokens(
  round?: RoundPriceSource | null,
  liveOraclePriceUsd?: number | null
): number {
  return getPlayBar(round, liveOraclePriceUsd).tokens;
}

/**
 * The ACTIVE round reduced to what the bar conversion needs, or null when no
 * round is running.
 *
 * WHY THE READ IS CHEAP ENOUGH FOR /api/user-state AND THE ALLOCATION PATH:
 * one Redis GET (getActiveRoundId, 5s TTL — the same read round-state and
 * wheel already make on every request) and, at most once per process per
 * round, one primary-key read of four columns. The seed price is written in
 * the same UPDATE that flips a $WORD round from 'pending' to 'active'
 * (rounds.ts), so it is immutable for every round this can ever observe —
 * which is what makes a memo with no TTL correct rather than merely cheap.
 *
 * Fails SOFT, in the direction that keeps players in: a round read that
 * throws falls back to the last round we priced, never to a lockout — and
 * SAYS SO, both to Sentry and to the caller, because on a cold instance there
 * is no last round to fall back to and the caller must not quietly price the
 * bar off a build-time constant instead (see checkPlayEligibility).
 *
 * Not exported: the memo is handed out by reference, and the bar every check
 * in this process reads is one in-place mutation away from an external caller.
 */
let barRoundMemo: RoundPriceSource | null = null;

/** A round read that reports whether it FAILED, not just what it found. */
interface BarRoundRead {
  round: RoundPriceSource | null;
  /**
   * True only when the round could not be READ and no memo stands in for it.
   * "No round is running" is an answer, not a degradation; "the database
   * blipped on a freshly-booted lambda" is a degradation, and it is the case
   * that used to be indistinguishable from the first one.
   */
  degraded: boolean;
}

async function getActiveBarRound(): Promise<BarRoundRead> {
  try {
    const roundId = await getActiveRoundId();
    if (roundId == null) return { round: null, degraded: false };
    if (barRoundMemo?.id === roundId) return { round: barRoundMemo, degraded: false };

    const [row] = await db
      .select({
        id: rounds.id,
        // The currency columns travel with the price. See RoundPriceSource.
        prizeCurrency: rounds.prizeCurrency,
        prizePoolWord: rounds.prizePoolWord,
        seedPriceE18: rounds.seedPriceE18,
      })
      .from(rounds)
      .where(eq(rounds.id, roundId))
      .limit(1);

    if (!row) {
      // A live round id naming no row: we know a round is running and cannot
      // price it. Degraded unless the memo can answer for it.
      return { round: barRoundMemo, degraded: barRoundMemo == null };
    }
    barRoundMemo = row;
    return { round: row, degraded: false };
  } catch (error) {
    reportDegraded(
      'roundReadFailed',
      'Active-round bar read failed; falling back to the last known round bar',
      { error: String(error), haveMemo: barRoundMemo != null }
    );
    return { round: barRoundMemo, degraded: barRoundMemo == null };
  }
}

/**
 * The Redis-cached live $WORD price, or null.
 *
 * Dynamically imported so word-oracle's fetch/contract graph never loads on a
 * request that does not need it, and wrapped so a failure is a null rather
 * than a thrown gate check. getCachedWordPriceUsd never fetches; it only reads
 * the key the oracle cron warms.
 */
async function getLiveOraclePriceUsd(): Promise<number | null> {
  try {
    const { getCachedWordPriceUsd } = await import('./word-oracle');
    return await getCachedWordPriceUsd();
  } catch {
    return null;
  }
}

/**
 * The $WORD market cap the app's OTHER USD-denominated thresholds should be
 * struck from — the holder ladder ($25 / $50 / $75 for +1 / +2 / +3 daily
 * guesses, config/economy getHolderTierThresholds).
 *
 * Lives here because the price ladder lives here, and the ladder and the play
 * bar must agree: a round's frozen seed price first, the cached oracle price
 * second, the build-time constant only so nothing divides by zero. The holder
 * tiers defaulted to WORD_MARKET_CAP_USD — unset in production — so they ran
 * on WORD_MCAP_FALLBACK_USD ($25,000) while round 35 was seeded at ~$34,200.
 * A lower market cap means a lower implied price means MORE tokens per dollar
 * of threshold: holders were measured against a bar 37% too high in tokens and
 * were handed fewer bonus guesses than they had paid for.
 *
 * `priced: false` says the number is the constant rather than a price. The
 * caller must not remember an answer computed from it (daily-limits skips the
 * 5-minute tier cache), so the tier re-decides on the next touch instead of an
 * outage costing a holder their bonus for the rest of the day.
 *
 * Never throws: both reads swallow their own failures.
 */
export async function getActiveWordMarketCapUsd(): Promise<{
  marketCapUsd: number;
  priced: boolean;
}> {
  const { round } = await getActiveBarRound();
  const liveOraclePriceUsd = round?.seedPriceE18 ? null : await getLiveOraclePriceUsd();
  const { priceUsd, source } = resolveWordPriceUsd(round, liveOraclePriceUsd);
  if (source === 'constant') {
    reportDegraded(
      'ladderFromConstant',
      'No round price and no cached oracle price — the $WORD holder ladder is running on the build-time constant',
      { roundId: round?.id ?? null }
    );
  }
  return {
    marketCapUsd: wordMarketCapFromPriceUsd(priceUsd),
    priced: source !== 'constant',
  };
}

/**
 * The day cache key, SCOPED TO THE ROUND that priced the bar.
 *
 * (fid, day) alone was defensible while every cached verdict came from the
 * same round-independent constant. It is not, now that the bar is the round's
 * own frozen bar: a verdict is only meaningful under the round that produced
 * it, and the 5-minute TTL would otherwise carry round N's verdict up to five
 * minutes into round N+1. The expensive direction is the stale `below_bar`:
 * getOrCreateDailyState turns one of those into freeAllocatedBase 0, a
 * DATABASE write that outlives the cache entry that caused it, and /api/guess
 * spends the same stale verdict on its 403 copy. (No barTokens reaches the
 * poll surfaces: /api/user-state's rewardGate field is {enabled, locked,
 * grandfathered}. The number a player ever sees comes from the 403 body.)
 *
 * The cost is one extra miss per active player per round transition, and
 * transitions are rare (round 34 ran a fortnight).
 *
 * Built here rather than in CacheKeys so this change stays inside the gate;
 * the base key remains the single definition of the prefix.
 */
function rewardGateCacheKey(fid: number, dateStr: string, roundId: number | null): string {
  return `${CacheKeys.rewardGate(fid, dateStr)}:r${roundId ?? 'none'}`;
}

/**
 * The verdict TTL, jittered ±20%.
 *
 * Every verdict written in the same second otherwise expires in the same
 * second. That is what makes a KEY-SHAPE change expensive: the shape changed
 * on 2026-09-12, so at that deploy every cached verdict became unreachable at
 * one instant, every session missed at once, and each miss is an uncached
 * onchain balance read — getEffectiveBalanceChecked has no cache of its own,
 * this IS its cache, and a determined:false fail-open is deliberately never
 * cached, so a rate-limited RPC keeps every retry on the chain.
 *
 * Jitter does not remove that first burst; it stops the burst from re-forming
 * every 300s afterwards, because the misses no longer all write together.
 * Removing the first one is a deploy-timing decision, not a code one: land a
 * key-shape change between rounds, or away from the 11:00 UTC reset.
 */
function jitteredVerdictTtl(): number {
  const spread = Math.round(CacheTTL.rewardGate * 0.2);
  return CacheTTL.rewardGate - spread + Math.floor(Math.random() * (2 * spread + 1));
}

interface CheckOptions {
  /**
   * Round supplying the frozen seed price. Omit it only when the caller has no
   * round in hand — the ACTIVE round is resolved and used instead, so the bar
   * is the same one either way. Supplying it is what marks a caller as a
   * floor-writer (see mayRecordFloor), which is why the hot read-only surfaces
   * leave it out.
   */
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
 * True only when all of: this call is allowed to record floors at all (see
 * mayRecordFloor in checkPlayEligibility — the hot read-only surfaces are
 * not); the cached verdict is an eligible, non-grandfathered pass; and the
 * player's stored floor is missing or above the bar. Costs one indexed row
 * read on the cached path, and only for the callers that may write. On a read
 * error the cache verdict stands — the floor is an enhancement, never a reason
 * to fail or slow the guess path.
 */
async function cachedPassNeedsFloorWrite(
  cached: RewardGateResult,
  fid: number,
  barTokens: number,
  mayRecordFloor: boolean
): Promise<boolean> {
  if (!mayRecordFloor) return false;
  if (!cached.eligible || cached.grandfathered) return false;
  try {
    const [row] = await db
      .select({ floor: users.rewardGateBarTokens })
      .from(users)
      .where(eq(users.fid, fid))
      .limit(1);
    return row != null && (row.floor == null || row.floor > barTokens);
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

  const { round: suppliedRound = null, useCache = false, claimWallet = true } = opts;
  const dateStr = getTodayUTC();

  // ONE BAR FOR EVERY SURFACE. A caller holding the round hands it over; a
  // caller that does not (user-state, the daily allocation, pack pricing) gets
  // the ACTIVE round's frozen bar resolved here. Until 2026-09-12 those three
  // priced the bar from WORD_MARKET_CAP_USD — unset in production — and so ran
  // 37% above round 35's real bar while the guess path admitted the same
  // player. The live oracle price is only consulted when nothing here carries
  // a seed price, so an in-round request pays no extra read for it.
  const roundRead: BarRoundRead = suppliedRound
    ? { round: suppliedRound, degraded: false }
    : await getActiveBarRound();
  const barRound = roundRead.round;
  const liveOraclePriceUsd = barRound?.seedPriceE18 ? null : await getLiveOraclePriceUsd();
  const { tokens: liveBarTokens, frozen: barIsFrozen, priced } = getPlayBar(
    barRound,
    liveOraclePriceUsd
  );

  // AN UNPRICED BAR IS NOT A BAR.
  //
  // `priced: false` means every price source was silent and the number above
  // is WORD_MCAP_FALLBACK_USD divided by the supply — a build-time constant
  // 37% off the live market on the day this was written. Two ways to get here
  // and they are not the same failure:
  //
  //   1. roundRead.degraded — the active round could not be READ (a database
  //      blip on a cold lambda, where the memo is still empty) and no oracle
  //      price is cached either. We do not know this round's bar. Deciding
  //      anyway is how the mispricing this workstream exists to fix would come
  //      back silently: getOrCreateDailyState turns a below_bar into
  //      freeAllocatedBase 0, a database row that outlives the outage, while
  //      /api/guess — which carries its own round — keeps admitting the same
  //      player. So fail OPEN, loudly, and never cache it: the same direction
  //      as an undetermined balance below, and the kill switch is the backstop.
  //   2. Not degraded — no round is running, or the round was never priced in
  //      $WORD (ETH era, dev mode). The constant is then the only number there
  //      is and nothing is being hidden by using it, but it is still worth a
  //      throttled word to Sentry, because in a $WORD round it means the
  //      oracle key has gone cold.
  if (!priced) {
    reportDegraded(
      roundRead.degraded ? 'barUnpriceable' : 'barFromConstant',
      roundRead.degraded
        ? 'Active round unreadable and no cached price — failing OPEN rather than measuring players against the build-time constant'
        : 'No round price and no cached oracle price — the play bar is the build-time constant',
      { fid, roundId: barRound?.id ?? null, constantBarTokens: liveBarTokens }
    );
    if (roundRead.degraded) {
      return {
        eligible: true,
        grandfathered: false,
        determined: false,
        barTokens: liveBarTokens,
      };
    }
  }

  // WHO WRITES ENTRY FLOORS — decided 2026-09-12, when the resolution above
  // made the bar frozen for callers that never used to carry one.
  //
  // Only a caller that HANDS US a round records a floor: the guess path and
  // the money points. The read-only surfaces do not, even though their bar is
  // now the same frozen number and would write the same value. Both reasons
  // are cost, not correctness:
  //   1. cachedPassNeedsFloorWrite costs one indexed `users` read on EVERY
  //      cached call while a floor is unrecorded, and /api/user-state is the
  //      most-polled endpoint in the app.
  //   2. Until that floor exists the check BYPASSES the cache, which on
  //      user-state means an onchain balance read per poll. The 2026-08-30
  //      first-load work exists to keep exactly that off this path.
  // Nothing is lost by waiting: the floor is an enhancement, and the first
  // guess of any round carries a round and records it. A player who opens the
  // app and never guesses has no entry to protect.
  const mayRecordFloor = barIsFrozen && suppliedRound != null;

  const cacheKey = rewardGateCacheKey(fid, dateStr, barRound?.id ?? null);

  if (useCache) {
    try {
      const cached = await cacheGet<RewardGateResult>(cacheKey);
      if (cached && typeof cached.eligible === 'boolean') {
        // A cached eligible verdict normally stands for the day — but it was
        // usually written by a read-only surface (user-state, allocation),
        // which by design returns before the floor logic ever runs. If this
        // call is one that may record floors and the player's floor is missing
        // or higher, bypass the cache once so the live check can record it;
        // after that single recording the floor is <= the frozen bar and the
        // cache short-circuits again.
        const bypassForFloor = await cachedPassNeedsFloorWrite(
          cached,
          fid,
          liveBarTokens,
          mayRecordFloor
        );
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
    if (useCache) await cacheSet(cacheKey, result, jitteredVerdictTtl()).catch(() => {});
    return result;
  }

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
    if (useCache) await cacheSet(cacheKey, result, jitteredVerdictTtl()).catch(() => {});
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
    if (useCache) await cacheSet(cacheKey, result, jitteredVerdictTtl()).catch(() => {});
    return result;
  }

  // Wallet uniqueness: one wallet vouches for one FID per game-day.
  if (claimWallet) {
    // The round id stamped on the claim is the resolved one, so a claim made
    // by user-state or the allocation path now carries the round it was made
    // under instead of NULL. farm-monitor bounds its claim counts on the round
    // WINDOW rather than this column and must keep doing so: the row is
    // written onConflictDoNothing, so it still records only what the FIRST
    // check of that wallet-day happened to know.
    const claimedByOther = await claimWalletForDay(dateStr, wallet, fid, barRound?.id);
    if (claimedByOther) {
      const result: RewardGateResult = {
        eligible: false,
        grandfathered: false,
        determined: true,
        reason: 'wallet_already_claimed',
        barTokens,
        balanceTokens: balance.balance,
      };
      if (useCache) await cacheSet(cacheKey, result, jitteredVerdictTtl()).catch(() => {});
      return result;
    }
  }

  // Record / ratchet the entry floor on a full pass — but ONLY when this
  // caller may write one (mayRecordFloor above: a round-frozen bar AND a
  // caller that handed us its round). A fallback bar tracks the live price,
  // and a mid-round pump would make it cheaper than the round's frozen bar;
  // recording it would let the floor permanently undercut the per-round
  // freeze. Waiting for a round-carrying check costs nothing: the first guess
  // of any round is one. When the write fires, the balance genuinely cleared
  // liveBarTokens (a floor below the live bar would have been the effective
  // bar instead).
  //
  // The ratchet condition is enforced IN SQL, not from the row read above —
  // concurrent checks with different bars race, and a stale in-memory floor
  // must never let a higher bar overwrite a lower one. The JS check is only
  // a fast path to skip the write. Best-effort: a floor write failure must
  // never fail an eligible check.
  if (
    mayRecordFloor &&
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
  if (useCache) await cacheSet(cacheKey, result, jitteredVerdictTtl()).catch(() => {});
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

  if (existing == null || existing.fid === fid) return false;

  // A claim held by a NON-POSITIVE fid is not a real player's claim. It can
  // only exist because the gate ran for an identity that cannot play — and on
  // 2026-08-27 exactly that happened: a sentinel row (fid -1) had captured a
  // player's wallet address, so the broken sign-ins claimed the wallet as fid
  // -1 and locked the real owner out of their own wallet for the rest of the
  // day, minutes before they finally signed in properly. Hand the claim to the
  // real player instead of honouring a claim nobody can ever use.
  if (existing.fid <= 0) {
    await db
      .update(rewardGateClaims)
      .set({ fid, roundId: roundId ?? null })
      .where(
        and(
          eq(rewardGateClaims.date, dateStr),
          eq(rewardGateClaims.wallet, normalized)
        )
      );
    console.warn(
      `[RewardGate] Took over a sentinel claim on ${normalized} (was fid ${existing.fid}) for FID ${fid}`
    );
    return false;
  }

  return true;
}

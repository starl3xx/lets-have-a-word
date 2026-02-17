/**
 * XP System Helper Functions
 * Milestone 6.7: Event-sourced XP tracking system
 *
 * Provides fire-and-forget XP event logging and query utilities.
 * XP events are logged asynchronously and never block user flows.
 */

import { db } from '../db';
import { xpEvents, users, dailyGuessState } from '../db/schema';
import { eq, and, sql, desc, gte } from 'drizzle-orm';
import type { XpEventType, XpEvent } from '../types';
import { XP_VALUES } from '../types';
import type { XpEventInsert } from '../db/schema';
import { getTodayUTC } from './daily-limits';

/**
 * Check if XP debug logging is enabled
 */
function isXpDebugEnabled(): boolean {
  return process.env.XP_DEBUG === 'true' || process.env.NEXT_PUBLIC_LHAW_DEV_MODE === 'true';
}

/**
 * Log an XP event (fire-and-forget)
 *
 * This function never throws - XP logging should never break user flows.
 * All errors are logged but swallowed.
 *
 * @param fid - Farcaster ID of the user earning XP
 * @param eventType - Type of XP event
 * @param options - Optional round ID and metadata
 */
export async function logXpEvent(
  fid: number,
  eventType: XpEventType,
  options: {
    roundId?: number | null;
    xpOverride?: number;
    metadata?: Record<string, unknown>;
  } = {}
): Promise<void> {
  try {
    const { roundId = null, xpOverride, metadata = {} } = options;
    const xpAmount = xpOverride !== undefined ? xpOverride : XP_VALUES[eventType];

    if (isXpDebugEnabled()) {
      console.log(`[XP] Logging ${eventType} for FID ${fid}: +${xpAmount} XP`, {
        roundId,
        metadata,
      });
    }

    const event: XpEventInsert = {
      fid,
      roundId,
      eventType,
      xpAmount,
      metadata: Object.keys(metadata).length > 0 ? metadata : null,
    };

    await db.insert(xpEvents).values(event);

    if (isXpDebugEnabled()) {
      console.log(`[XP] ✅ Event logged successfully: ${eventType} +${xpAmount} XP`);
    }
  } catch (error) {
    // Never throw - XP logging should never break user flows
    console.error('[XP] Error logging XP event (non-fatal):', {
      fid,
      eventType,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get total XP for a user
 *
 * @param fid - Farcaster ID
 * @returns Total XP amount
 */
export async function getTotalXpForFid(fid: number): Promise<number> {
  try {
    const result = await db
      .select({
        totalXp: sql<number>`COALESCE(SUM(${xpEvents.xpAmount}), 0)`.as('total_xp'),
      })
      .from(xpEvents)
      .where(eq(xpEvents.fid, fid));

    return Number(result[0]?.totalXp ?? 0);
  } catch (error) {
    console.error('[XP] Error getting total XP:', error);
    return 0;
  }
}

/**
 * Get recent XP events for a user (for dev mode debugging)
 *
 * @param fid - Farcaster ID
 * @param limit - Maximum number of events to return
 * @returns Array of recent XP events
 */
export async function getRecentXpEventsForFid(
  fid: number,
  limit: number = 20
): Promise<XpEvent[]> {
  try {
    const result = await db
      .select()
      .from(xpEvents)
      .where(eq(xpEvents.fid, fid))
      .orderBy(desc(xpEvents.createdAt))
      .limit(limit);

    return result.map((row) => ({
      id: row.id,
      fid: row.fid,
      roundId: row.roundId,
      eventType: row.eventType as XpEventType,
      xpAmount: row.xpAmount,
      metadata: row.metadata ?? undefined,
      createdAt: row.createdAt,
    }));
  } catch (error) {
    console.error('[XP] Error getting recent XP events:', error);
    return [];
  }
}

/**
 * Get XP breakdown by event type for a user
 *
 * @param fid - Farcaster ID
 * @returns Map of event type to total XP
 */
export async function getXpBreakdownForFid(
  fid: number
): Promise<Record<string, number>> {
  try {
    const result = await db
      .select({
        eventType: xpEvents.eventType,
        totalXp: sql<number>`SUM(${xpEvents.xpAmount})`.as('total_xp'),
      })
      .from(xpEvents)
      .where(eq(xpEvents.fid, fid))
      .groupBy(xpEvents.eventType);

    return result.reduce(
      (acc, row) => {
        acc[row.eventType] = Number(row.totalXp);
        return acc;
      },
      {} as Record<string, number>
    );
  } catch (error) {
    console.error('[XP] Error getting XP breakdown:', error);
    return {};
  }
}

/**
 * Get 7-day rolling XP rate for a user.
 * Sums all XP earned in the last 7 calendar days and returns
 * the total and daily average. Used by the UI for time-to-next-tier estimates.
 *
 * @param fid - Farcaster ID
 * @returns { totalInPeriod, dailyAverage }
 */
export async function getSevenDayXpRate(fid: number): Promise<{ totalInPeriod: number; dailyAverage: number }> {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);

    const result = await db
      .select({
        totalXp: sql<number>`COALESCE(SUM(${xpEvents.xpAmount}), 0)`.as('total_xp'),
      })
      .from(xpEvents)
      .where(
        and(
          eq(xpEvents.fid, fid),
          gte(xpEvents.createdAt, sevenDaysAgo)
        )
      );

    const totalInPeriod = Number(result[0]?.totalXp ?? 0);
    return {
      totalInPeriod,
      dailyAverage: totalInPeriod / 7,
    };
  } catch (error) {
    console.error('[XP] Error getting 7-day XP rate:', error);
    return { totalInPeriod: 0, dailyAverage: 0 };
  }
}

// =============================================================================
// XP Event Helpers for Specific Actions
// =============================================================================

/**
 * Check if user already received daily participation XP today
 *
 * @param fid - Farcaster ID
 * @returns true if already awarded today
 */
export async function hasReceivedDailyParticipationToday(fid: number): Promise<boolean> {
  try {
    const todayStart = getTodayStartTimestamp();

    const result = await db
      .select({ id: xpEvents.id })
      .from(xpEvents)
      .where(
        and(
          eq(xpEvents.fid, fid),
          eq(xpEvents.eventType, 'DAILY_PARTICIPATION'),
          gte(xpEvents.createdAt, todayStart)
        )
      )
      .limit(1);

    return result.length > 0;
  } catch (error) {
    console.error('[XP] Error checking daily participation:', error);
    return false; // Default to allowing XP if check fails
  }
}

/**
 * Check if user already received $WORD token bonus XP today
 * NOTE: Queries legacy DB event name 'CLANKTON_BONUS_DAY'
 *
 * @param fid - Farcaster ID
 * @returns true if already awarded today
 */
export async function hasReceivedWordTokenBonusToday(fid: number): Promise<boolean> {
  try {
    const todayStart = getTodayStartTimestamp();

    const result = await db
      .select({ id: xpEvents.id })
      .from(xpEvents)
      .where(
        and(
          eq(xpEvents.fid, fid),
          eq(xpEvents.eventType, 'CLANKTON_BONUS_DAY'), // Legacy DB event name
          gte(xpEvents.createdAt, todayStart)
        )
      )
      .limit(1);

    return result.length > 0;
  } catch (error) {
    console.error('[XP] Error checking $WORD token bonus:', error);
    return false;
  }
}


/**
 * Check if user already received share XP today
 *
 * @param fid - Farcaster ID
 * @returns true if already awarded today
 */
export async function hasReceivedShareXpToday(fid: number): Promise<boolean> {
  try {
    const todayStart = getTodayStartTimestamp();

    const result = await db
      .select({ id: xpEvents.id })
      .from(xpEvents)
      .where(
        and(
          eq(xpEvents.fid, fid),
          eq(xpEvents.eventType, 'SHARE_CAST'),
          gte(xpEvents.createdAt, todayStart)
        )
      )
      .limit(1);

    return result.length > 0;
  } catch (error) {
    console.error('[XP] Error checking share XP:', error);
    return false;
  }
}

/**
 * Check if this is the user's first guess ever (for referral XP)
 *
 * @param fid - Farcaster ID
 * @returns true if this is the user's first guess
 */
export async function isFirstGuessEver(fid: number): Promise<boolean> {
  try {
    const result = await db
      .select({ id: xpEvents.id })
      .from(xpEvents)
      .where(
        and(
          eq(xpEvents.fid, fid),
          eq(xpEvents.eventType, 'GUESS')
        )
      )
      .limit(1);

    return result.length === 0;
  } catch (error) {
    console.error('[XP] Error checking first guess:', error);
    return false;
  }
}

/**
 * Check and award streak XP if applicable
 *
 * Streak logic:
 * - User gets +15 XP for each consecutive day playing after day 1
 * - Checks if user played yesterday by looking for DAILY_PARTICIPATION events
 *
 * @param fid - Farcaster ID
 * @param roundId - Optional round ID
 */
export async function checkAndAwardStreakXp(
  fid: number,
  roundId?: number | null
): Promise<void> {
  try {
    const todayStart = getTodayStartTimestamp();
    const yesterdayStart = getYesterdayStartTimestamp();

    // Check if user played yesterday
    const yesterdayResult = await db
      .select({ id: xpEvents.id })
      .from(xpEvents)
      .where(
        and(
          eq(xpEvents.fid, fid),
          eq(xpEvents.eventType, 'DAILY_PARTICIPATION'),
          gte(xpEvents.createdAt, yesterdayStart),
          sql`${xpEvents.createdAt} < ${todayStart}`
        )
      )
      .limit(1);

    if (yesterdayResult.length > 0) {
      // User played yesterday - award streak XP!
      await logXpEvent(fid, 'STREAK_DAY', {
        roundId,
        metadata: { streak_continuation: true },
      });

      if (isXpDebugEnabled()) {
        console.log(`[XP] 🔥 Streak day awarded for FID ${fid}`);
      }
    }
  } catch (error) {
    console.error('[XP] Error checking streak:', error);
  }
}

/**
 * Award referral XP when a referred user makes their first guess
 *
 * @param referredFid - FID of the referred user who made their first guess
 * @param roundId - Optional round ID
 */
export async function awardReferralFirstGuessXp(
  referredFid: number,
  roundId?: number | null
): Promise<void> {
  try {
    // Get the referrer FID from the user's record
    const result = await db
      .select({ referrerFid: users.referrerFid })
      .from(users)
      .where(eq(users.fid, referredFid))
      .limit(1);

    const referrerFid = result[0]?.referrerFid;

    if (referrerFid) {
      await logXpEvent(referrerFid, 'REFERRAL_FIRST_GUESS', {
        roundId,
        metadata: {
          referred_fid: referredFid,
        },
      });

      if (isXpDebugEnabled()) {
        console.log(
          `[XP] 🎁 Referral XP awarded to FID ${referrerFid} for referring FID ${referredFid}`
        );
      }
    }
  } catch (error) {
    console.error('[XP] Error awarding referral XP:', error);
  }
}

/**
 * Award XP to top 10 guessers at round resolution
 *
 * @param roundId - Round ID
 * @param topGuesserFids - Array of FIDs who are in top 10
 */
export async function awardTopTenGuesserXp(
  roundId: number,
  topGuesserFids: number[]
): Promise<void> {
  try {
    for (const fid of topGuesserFids) {
      await logXpEvent(fid, 'TOP_TEN_GUESSER', {
        roundId,
        metadata: {
          position: topGuesserFids.indexOf(fid) + 1,
          total_top_guessers: topGuesserFids.length,
        },
      });
    }

    if (isXpDebugEnabled()) {
      console.log(
        `[XP] 🏆 Top 10 XP awarded to ${topGuesserFids.length} guessers for round ${roundId}`
      );
    }
  } catch (error) {
    console.error('[XP] Error awarding top 10 XP:', error);
  }
}

/**
 * Calculate Hamming distance between two words
 * Used for near-miss detection
 */
function hammingDistance(word1: string, word2: string): number {
  if (word1.length !== word2.length) return Infinity;
  let distance = 0;
  for (let i = 0; i < word1.length; i++) {
    if (word1[i] !== word2[i]) distance++;
  }
  return distance;
}

/**
 * Check and log near-miss event (for future XP potential)
 *
 * Near-miss is when a guess is within 1-2 character differences from the answer.
 * Currently logged with 0 XP for future feature use.
 *
 * @param fid - Farcaster ID
 * @param guessedWord - The word guessed
 * @param answer - The correct answer
 * @param roundId - Round ID
 */
export async function checkAndLogNearMiss(
  fid: number,
  guessedWord: string,
  answer: string,
  roundId: number
): Promise<void> {
  try {
    const distance = hammingDistance(guessedWord.toUpperCase(), answer.toUpperCase());

    if (distance <= 2 && distance > 0) {
      await logXpEvent(fid, 'NEAR_MISS', {
        roundId,
        xpOverride: 0, // Tracked only, no XP in v1
        metadata: {
          guessed_word: guessedWord,
          hamming_distance: distance,
        },
      });

      if (isXpDebugEnabled()) {
        console.log(
          `[XP] 👀 Near miss logged for FID ${fid}: "${guessedWord}" was ${distance} chars away from answer`
        );
      }
    }
  } catch (error) {
    console.error('[XP] Error logging near miss:', error);
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Get the start of today in UTC (11:00 UTC, same as daily reset)
 */
function getTodayStartTimestamp(): Date {
  const now = new Date();
  const utcHour = now.getUTCHours();

  // Calculate the "game day" start time
  // If before 11:00 UTC, the "day" started yesterday at 11:00 UTC
  // If 11:00 UTC or later, the "day" started today at 11:00 UTC
  const dayStart = new Date(now);
  dayStart.setUTCHours(11, 0, 0, 0);

  if (utcHour < 11) {
    dayStart.setUTCDate(dayStart.getUTCDate() - 1);
  }

  return dayStart;
}

/**
 * Get the start of yesterday in UTC (11:00 UTC)
 */
function getYesterdayStartTimestamp(): Date {
  const todayStart = getTodayStartTimestamp();
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1);
  return yesterdayStart;
}

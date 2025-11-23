/**
 * Analytics Logging Helper
 * Milestone 5.2: Analytics system
 *
 * Provides fire-and-forget event logging that never blocks user flows.
 * All analytics can be disabled via ANALYTICS_ENABLED env var.
 */

import { db } from '../db';
import { analyticsEvents } from '../db/schema';

/**
 * Event types tracked by the analytics system
 */
export const AnalyticsEventTypes = {
  // User activity
  DAILY_OPEN: 'daily_open',
  FREE_GUESS_USED: 'free_guess_used',
  PAID_GUESS_USED: 'paid_guess_used',

  // Referrals
  REFERRAL_SHARE: 'referral_share',
  REFERRAL_JOIN: 'referral_join',
  REFERRAL_WIN: 'referral_win',
  SHARE_BONUS_UNLOCKED: 'share_bonus_unlocked',

  // Rounds
  ROUND_STARTED: 'round_started',
  ROUND_RESOLVED: 'round_resolved',
} as const;

export type AnalyticsEventType = typeof AnalyticsEventTypes[keyof typeof AnalyticsEventTypes];

export interface LogAnalyticsEventOptions {
  userId?: string | number;
  roundId?: string | number;
  data?: Record<string, any>;
}

/**
 * Log an analytics event
 *
 * Features:
 * - Respects ANALYTICS_ENABLED flag (defaults to disabled)
 * - Fire-and-forget: never throws, never blocks
 * - Catches and logs errors without disrupting user flow
 * - Debug mode for additional logging
 *
 * @param eventType - Type of event (use AnalyticsEventTypes constants)
 * @param options - Optional user ID, round ID, and additional data
 */
export async function logAnalyticsEvent(
  eventType: AnalyticsEventType | string,
  options: LogAnalyticsEventOptions = {}
): Promise<void> {
  // Check if analytics is enabled
  if (process.env.ANALYTICS_ENABLED !== 'true') {
    if (process.env.ANALYTICS_DEBUG === 'true') {
      console.log('[Analytics] Skipped (disabled):', eventType, options);
    }
    return;
  }

  try {
    const { userId, roundId, data } = options;

    // Debug logging
    if (process.env.ANALYTICS_DEBUG === 'true') {
      console.log('[Analytics] Logging event:', {
        eventType,
        userId,
        roundId,
        data,
      });
    }

    // Insert event into database (fire-and-forget)
    await db.insert(analyticsEvents).values({
      eventType,
      userId: userId?.toString() || null,
      roundId: roundId?.toString() || null,
      data: data || null,
    });

    if (process.env.ANALYTICS_DEBUG === 'true') {
      console.log('[Analytics] Event logged successfully:', eventType);
    }
  } catch (error) {
    // Never throw - analytics failures should not affect user experience
    console.error('[Analytics] Error logging event (non-fatal):', {
      eventType,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Helper to log user activity events
 */
export async function logUserActivity(
  eventType: AnalyticsEventType,
  userId: string | number,
  data?: Record<string, any>
): Promise<void> {
  return logAnalyticsEvent(eventType, { userId, data });
}

/**
 * Helper to log round events
 */
export async function logRoundEvent(
  eventType: AnalyticsEventType,
  roundId: string | number,
  data?: Record<string, any>
): Promise<void> {
  return logAnalyticsEvent(eventType, { roundId, data });
}

/**
 * Helper to log guess events
 */
export async function logGuessEvent(
  isPaid: boolean,
  userId: string | number,
  roundId: string | number,
  data?: Record<string, any>
): Promise<void> {
  const eventType = isPaid
    ? AnalyticsEventTypes.PAID_GUESS_USED
    : AnalyticsEventTypes.FREE_GUESS_USED;

  return logAnalyticsEvent(eventType, {
    userId,
    roundId,
    data,
  });
}

/**
 * Helper to log referral events
 */
export async function logReferralEvent(
  eventType: AnalyticsEventType,
  userId: string | number,
  data?: Record<string, any>
): Promise<void> {
  return logAnalyticsEvent(eventType, { userId, data });
}

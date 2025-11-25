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
 * Analytics v2: Extended with gameplay, revenue, and share tracking
 */
export const AnalyticsEventTypes = {
  // User activity
  DAILY_OPEN: 'daily_open',
  FREE_GUESS_USED: 'free_guess_used',
  PAID_GUESS_USED: 'paid_guess_used',

  // Gameplay Events (v2)
  GAME_SESSION_START: 'game_session_start',
  FIRST_GUESS_SUBMITTED: 'first_guess_submitted',
  LAST_GUESS_SUBMITTED: 'last_guess_submitted',
  WRONG_GUESS_SUBMITTED: 'wrong_guess_submitted',
  SOLUTION_REVEALED: 'solution_revealed',
  RAGE_QUIT: 'rage_quit',

  // Guess Flow Events (v2)
  GUESS_SUBMITTED: 'guess_submitted',
  FIRST_GUESS_WORD: 'first_guess_word',
  WORD_PROGRESS_STATE: 'word_progress_state',

  // Revenue & Economy Events (v2)
  GUESS_PACK_VIEWED: 'guess_pack_viewed',
  GUESS_PACK_PURCHASED: 'guess_pack_purchased',
  GUESS_PACK_USED: 'guess_pack_used',
  SEED_AMOUNT_SET: 'seed_amount_set',
  JACKPOT_CREATED: 'jackpot_created',
  JACKPOT_CLAIMED: 'jackpot_claimed',
  UNCLAIMED_JACKPOT_EXPIRED: 'unclaimed_jackpot_expired',

  // Share & Referral Events (v2)
  SHARE_PROMPT_SHOWN: 'share_prompt_shown',
  SHARE_CLICKED: 'share_clicked',
  SHARE_SUCCESS: 'share_success',

  // Referrals (existing + Milestone 6.3)
  REFERRAL_SHARE: 'referral_share',
  REFERRAL_JOIN: 'referral_join',
  REFERRAL_WIN: 'referral_win',
  REFERRAL_GUESS: 'referral_guess',
  SHARE_BONUS_UNLOCKED: 'share_bonus_unlocked',

  // Milestone 6.3: New Referral Events
  REFERRAL_MODAL_OPENED: 'referral_modal_opened',
  REFERRAL_LINK_COPIED: 'referral_link_copied',
  REFERRAL_SHARE_CLICKED: 'referral_share_clicked',

  // Rounds
  ROUND_STARTED: 'round_started',
  ROUND_RESOLVED: 'round_resolved',

  // Milestone 5.3: Fairness & Integrity Events
  FAIRNESS_ALERT: 'fairness_alert',
  FAIRNESS_ALERT_HASH_MISMATCH: 'FAIRNESS_ALERT_HASH_MISMATCH',
  FAIRNESS_ALERT_PAYOUT_MISMATCH: 'FAIRNESS_ALERT_PAYOUT_MISMATCH',
  FAIRNESS_ALERT_SUSPICIOUS_SEQUENCE: 'FAIRNESS_ALERT_SUSPICIOUS_SEQUENCE',
  FAIRNESS_ALERT_INVALID_HASH_CHAIN: 'FAIRNESS_ALERT_INVALID_HASH_CHAIN',
  PRIZE_AUDIT_MISMATCH: 'PRIZE_AUDIT_MISMATCH',
  FAIRNESS_AUDIT_COMPLETED: 'FAIRNESS_AUDIT_COMPLETED',

  // Milestone 5.3: Simulation Events
  SIM_STARTED: 'SIM_STARTED',
  SIM_COMPLETED: 'SIM_COMPLETED',
  SIM_RESULT: 'SIM_RESULT',
  CLUSTER_ALERT: 'CLUSTER_ALERT',
  RAPID_FIRE_ALERT: 'RAPID_FIRE_ALERT',
  FRONTRUN_RISK: 'FRONTRUN_RISK',
  RUNWAY_WARNING: 'RUNWAY_WARNING',

  // Milestone 5.3: User Quality Events
  USER_QUALITY_BLOCKED: 'USER_QUALITY_BLOCKED',
  USER_QUALITY_REFRESHED: 'USER_QUALITY_REFRESHED',
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

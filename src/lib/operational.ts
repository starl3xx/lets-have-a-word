/**
 * Operational Controls Module
 * Milestone 9.5: Kill Switch and Dead Day support
 *
 * Provides centralized operational state management via Redis:
 * - Kill Switch: Immediate halt of all gameplay + refunds
 * - Dead Day: Finish current round, then pause between rounds
 */

import * as Sentry from '@sentry/nextjs';
import { getRedisClient, CACHE_PREFIX } from './redis';
import { db } from '../db';
import { rounds, operationalEvents, type OperationalEventType } from '../db/schema';
import { eq, isNull, desc } from 'drizzle-orm';

// ============================================================
// Types
// ============================================================

/**
 * Game operational status
 */
export type GameOperationalStatus =
  | 'NORMAL'                    // Normal gameplay
  | 'KILL_SWITCH_ACTIVE'        // Kill switch enabled, gameplay halted
  | 'PAUSED_BETWEEN_ROUNDS'     // Dead day: last round finished, waiting to resume
  | 'DEAD_DAY_ACTIVE';          // Dead day enabled, current round still active

/**
 * Kill switch state
 */
export interface KillSwitchState {
  enabled: boolean;
  activatedAt?: string;       // ISO timestamp
  reason?: string;
  roundId?: number;           // Round that was cancelled
  activatedBy?: number;       // Admin FID
}

/**
 * Dead day state
 */
export interface DeadDayState {
  enabled: boolean;
  activatedAt?: string;       // ISO timestamp
  reason?: string;
  reopenAt?: string;          // ISO timestamp for scheduled reopen
  appliesAfterRoundId?: number;  // For audit clarity
  activatedBy?: number;       // Admin FID
}

/**
 * Full operational state
 */
export interface OperationalState {
  status: GameOperationalStatus;
  killSwitch: KillSwitchState;
  deadDay: DeadDayState;
  activeRoundId?: number;
}

// ============================================================
// Redis Keys
// ============================================================

const REDIS_KEYS = {
  // Kill switch
  killSwitchEnabled: `${CACHE_PREFIX}ops:kill_switch:enabled`,
  killSwitchActivatedAt: `${CACHE_PREFIX}ops:kill_switch:activated_at`,
  killSwitchReason: `${CACHE_PREFIX}ops:kill_switch:reason`,
  killSwitchRoundId: `${CACHE_PREFIX}ops:kill_switch:round_id`,
  killSwitchActivatedBy: `${CACHE_PREFIX}ops:kill_switch:activated_by`,
  killSwitchRefundsRunning: `${CACHE_PREFIX}ops:kill_switch:refunds_running`,

  // Dead day
  deadDayEnabled: `${CACHE_PREFIX}ops:dead_day:enabled`,
  deadDayActivatedAt: `${CACHE_PREFIX}ops:dead_day:activated_at`,
  deadDayReason: `${CACHE_PREFIX}ops:dead_day:reason`,
  deadDayReopenAt: `${CACHE_PREFIX}ops:dead_day:reopen_at`,
  deadDayAppliesAfterRoundId: `${CACHE_PREFIX}ops:dead_day:applies_after_round_id`,
  deadDayActivatedBy: `${CACHE_PREFIX}ops:dead_day:activated_by`,

  // Game status (derived, cached for quick checks)
  gameStatus: `${CACHE_PREFIX}ops:game_status`,

  // Cron tracking
  refundCronLastRun: `${CACHE_PREFIX}ops:refund_cron:last_run`,
  refundCronLastResult: `${CACHE_PREFIX}ops:refund_cron:last_result`,
} as const;

// ============================================================
// Core Functions
// ============================================================

/**
 * Check if kill switch is enabled
 */
export async function isKillSwitchEnabled(): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return false;

  try {
    const enabled = await redis.get(REDIS_KEYS.killSwitchEnabled);
    return enabled === 'true';
  } catch (error) {
    console.error('[Ops] Failed to check kill switch:', error);
    return false;
  }
}

/**
 * Check if dead day is enabled
 */
export async function isDeadDayEnabled(): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return false;

  try {
    const enabled = await redis.get(REDIS_KEYS.deadDayEnabled);
    return enabled === 'true';
  } catch (error) {
    console.error('[Ops] Failed to check dead day:', error);
    return false;
  }
}

/**
 * Get kill switch state
 */
export async function getKillSwitchState(): Promise<KillSwitchState> {
  const redis = getRedisClient();
  if (!redis) {
    return { enabled: false };
  }

  try {
    const [enabled, activatedAt, reason, roundId, activatedBy] = await Promise.all([
      redis.get(REDIS_KEYS.killSwitchEnabled),
      redis.get(REDIS_KEYS.killSwitchActivatedAt),
      redis.get(REDIS_KEYS.killSwitchReason),
      redis.get(REDIS_KEYS.killSwitchRoundId),
      redis.get(REDIS_KEYS.killSwitchActivatedBy),
    ]);

    return {
      enabled: enabled === 'true',
      activatedAt: activatedAt || undefined,
      reason: reason || undefined,
      roundId: roundId ? parseInt(roundId, 10) : undefined,
      activatedBy: activatedBy ? parseInt(activatedBy, 10) : undefined,
    };
  } catch (error) {
    console.error('[Ops] Failed to get kill switch state:', error);
    return { enabled: false };
  }
}

/**
 * Get dead day state
 */
export async function getDeadDayState(): Promise<DeadDayState> {
  const redis = getRedisClient();
  if (!redis) {
    return { enabled: false };
  }

  try {
    const [enabled, activatedAt, reason, reopenAt, appliesAfterRoundId, activatedBy] = await Promise.all([
      redis.get(REDIS_KEYS.deadDayEnabled),
      redis.get(REDIS_KEYS.deadDayActivatedAt),
      redis.get(REDIS_KEYS.deadDayReason),
      redis.get(REDIS_KEYS.deadDayReopenAt),
      redis.get(REDIS_KEYS.deadDayAppliesAfterRoundId),
      redis.get(REDIS_KEYS.deadDayActivatedBy),
    ]);

    return {
      enabled: enabled === 'true',
      activatedAt: activatedAt || undefined,
      reason: reason || undefined,
      reopenAt: reopenAt || undefined,
      appliesAfterRoundId: appliesAfterRoundId ? parseInt(appliesAfterRoundId, 10) : undefined,
      activatedBy: activatedBy ? parseInt(activatedBy, 10) : undefined,
    };
  } catch (error) {
    console.error('[Ops] Failed to get dead day state:', error);
    return { enabled: false };
  }
}

/**
 * Get the current game operational status
 */
export async function getGameOperationalStatus(): Promise<GameOperationalStatus> {
  const [killSwitchEnabled, deadDayEnabled] = await Promise.all([
    isKillSwitchEnabled(),
    isDeadDayEnabled(),
  ]);

  if (killSwitchEnabled) {
    return 'KILL_SWITCH_ACTIVE';
  }

  if (deadDayEnabled) {
    // Check if we're in a round or between rounds
    const activeRound = await getActiveRoundId();
    if (activeRound) {
      return 'DEAD_DAY_ACTIVE';
    } else {
      return 'PAUSED_BETWEEN_ROUNDS';
    }
  }

  return 'NORMAL';
}

/**
 * Get full operational state
 */
export async function getOperationalState(): Promise<OperationalState> {
  const [killSwitch, deadDay, status, activeRoundId] = await Promise.all([
    getKillSwitchState(),
    getDeadDayState(),
    getGameOperationalStatus(),
    getActiveRoundId(),
  ]);

  return {
    status,
    killSwitch,
    deadDay,
    activeRoundId: activeRoundId || undefined,
  };
}

// ============================================================
// Kill Switch Actions
// ============================================================

/**
 * Enable kill switch
 * - Sets Redis flags
 * - Updates round status to 'cancelled'
 * - Logs operational event
 */
export async function enableKillSwitch(params: {
  adminFid: number;
  reason: string;
}): Promise<{ success: boolean; roundId?: number; error?: string }> {
  const redis = getRedisClient();
  if (!redis) {
    return { success: false, error: 'Redis not available' };
  }

  try {
    // Check if already enabled
    const alreadyEnabled = await isKillSwitchEnabled();
    if (alreadyEnabled) {
      return { success: false, error: 'Kill switch is already enabled' };
    }

    // Get the current active round
    const activeRoundId = await getActiveRoundId();
    if (!activeRoundId) {
      return { success: false, error: 'No active round to cancel' };
    }

    const now = new Date().toISOString();

    // Set Redis flags atomically
    await Promise.all([
      redis.set(REDIS_KEYS.killSwitchEnabled, 'true'),
      redis.set(REDIS_KEYS.killSwitchActivatedAt, now),
      redis.set(REDIS_KEYS.killSwitchReason, params.reason),
      redis.set(REDIS_KEYS.killSwitchRoundId, activeRoundId.toString()),
      redis.set(REDIS_KEYS.killSwitchActivatedBy, params.adminFid.toString()),
      redis.set(REDIS_KEYS.gameStatus, 'KILL_SWITCH_ACTIVE'),
    ]);

    // Update round status in database
    await db.update(rounds)
      .set({
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelledReason: params.reason,
        cancelledBy: params.adminFid,
      })
      .where(eq(rounds.id, activeRoundId));

    // Log operational event
    await logOperationalEvent({
      eventType: 'kill_switch_enabled',
      roundId: activeRoundId,
      triggeredBy: params.adminFid,
      reason: params.reason,
    });

    // Report to Sentry
    Sentry.captureMessage('Kill switch enabled', {
      level: 'warning',
      tags: { type: 'operational', action: 'kill_switch_enabled' },
      extra: {
        roundId: activeRoundId,
        adminFid: params.adminFid,
        reason: params.reason,
      },
    });

    console.log(`[Ops] Kill switch ENABLED by FID ${params.adminFid} for round ${activeRoundId}: ${params.reason}`);

    return { success: true, roundId: activeRoundId };
  } catch (error) {
    console.error('[Ops] Failed to enable kill switch:', error);
    Sentry.captureException(error, {
      tags: { type: 'operational', action: 'kill_switch_enable_failed' },
    });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Disable kill switch
 * - Clears Redis flags
 * - Does NOT create a new round (must be done separately)
 */
export async function disableKillSwitch(params: {
  adminFid: number;
}): Promise<{ success: boolean; error?: string }> {
  const redis = getRedisClient();
  if (!redis) {
    return { success: false, error: 'Redis not available' };
  }

  try {
    const state = await getKillSwitchState();
    if (!state.enabled) {
      return { success: false, error: 'Kill switch is not enabled' };
    }

    // Clear Redis flags
    await Promise.all([
      redis.del(REDIS_KEYS.killSwitchEnabled),
      redis.del(REDIS_KEYS.killSwitchActivatedAt),
      redis.del(REDIS_KEYS.killSwitchReason),
      redis.del(REDIS_KEYS.killSwitchRoundId),
      redis.del(REDIS_KEYS.killSwitchActivatedBy),
      redis.del(REDIS_KEYS.killSwitchRefundsRunning),
      redis.set(REDIS_KEYS.gameStatus, 'NORMAL'),
    ]);

    // Log operational event
    await logOperationalEvent({
      eventType: 'kill_switch_disabled',
      roundId: state.roundId,
      triggeredBy: params.adminFid,
      reason: 'Kill switch disabled by admin',
    });

    // Report to Sentry
    Sentry.captureMessage('Kill switch disabled', {
      level: 'info',
      tags: { type: 'operational', action: 'kill_switch_disabled' },
      extra: {
        roundId: state.roundId,
        adminFid: params.adminFid,
      },
    });

    console.log(`[Ops] Kill switch DISABLED by FID ${params.adminFid}`);

    return { success: true };
  } catch (error) {
    console.error('[Ops] Failed to disable kill switch:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// ============================================================
// Dead Day Actions
// ============================================================

/**
 * Enable dead day mode
 * - Current round continues normally
 * - No new round will be created after resolution
 */
export async function enableDeadDay(params: {
  adminFid: number;
  reason: string;
  reopenAt?: string;  // ISO timestamp for scheduled reopen
}): Promise<{ success: boolean; error?: string }> {
  const redis = getRedisClient();
  if (!redis) {
    return { success: false, error: 'Redis not available' };
  }

  try {
    // Check if kill switch is active (takes precedence)
    if (await isKillSwitchEnabled()) {
      return { success: false, error: 'Cannot enable dead day while kill switch is active' };
    }

    // Check if already enabled
    if (await isDeadDayEnabled()) {
      return { success: false, error: 'Dead day is already enabled' };
    }

    const activeRoundId = await getActiveRoundId();
    const now = new Date().toISOString();

    // Set Redis flags
    const promises: Promise<unknown>[] = [
      redis.set(REDIS_KEYS.deadDayEnabled, 'true'),
      redis.set(REDIS_KEYS.deadDayActivatedAt, now),
      redis.set(REDIS_KEYS.deadDayReason, params.reason),
      redis.set(REDIS_KEYS.deadDayActivatedBy, params.adminFid.toString()),
    ];

    if (activeRoundId) {
      promises.push(redis.set(REDIS_KEYS.deadDayAppliesAfterRoundId, activeRoundId.toString()));
    }

    if (params.reopenAt) {
      promises.push(redis.set(REDIS_KEYS.deadDayReopenAt, params.reopenAt));
    }

    await Promise.all(promises);

    // Log operational event
    await logOperationalEvent({
      eventType: 'dead_day_enabled',
      roundId: activeRoundId || undefined,
      triggeredBy: params.adminFid,
      reason: params.reason,
      metadata: {
        reopenAt: params.reopenAt,
        appliesAfterRoundId: activeRoundId,
      },
    });

    // Report to Sentry
    Sentry.captureMessage('Dead day enabled', {
      level: 'info',
      tags: { type: 'operational', action: 'dead_day_enabled' },
      extra: {
        adminFid: params.adminFid,
        reason: params.reason,
        reopenAt: params.reopenAt,
        appliesAfterRoundId: activeRoundId,
      },
    });

    console.log(`[Ops] Dead day ENABLED by FID ${params.adminFid}: ${params.reason}`);

    return { success: true };
  } catch (error) {
    console.error('[Ops] Failed to enable dead day:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Disable dead day mode
 */
export async function disableDeadDay(params: {
  adminFid: number;
}): Promise<{ success: boolean; error?: string }> {
  const redis = getRedisClient();
  if (!redis) {
    return { success: false, error: 'Redis not available' };
  }

  try {
    if (!(await isDeadDayEnabled())) {
      return { success: false, error: 'Dead day is not enabled' };
    }

    const state = await getDeadDayState();

    // Clear Redis flags
    await Promise.all([
      redis.del(REDIS_KEYS.deadDayEnabled),
      redis.del(REDIS_KEYS.deadDayActivatedAt),
      redis.del(REDIS_KEYS.deadDayReason),
      redis.del(REDIS_KEYS.deadDayReopenAt),
      redis.del(REDIS_KEYS.deadDayAppliesAfterRoundId),
      redis.del(REDIS_KEYS.deadDayActivatedBy),
    ]);

    // Log operational event
    await logOperationalEvent({
      eventType: 'dead_day_disabled',
      roundId: state.appliesAfterRoundId,
      triggeredBy: params.adminFid,
      reason: 'Dead day disabled by admin',
    });

    // Report to Sentry
    Sentry.captureMessage('Dead day disabled', {
      level: 'info',
      tags: { type: 'operational', action: 'dead_day_disabled' },
      extra: {
        adminFid: params.adminFid,
      },
    });

    console.log(`[Ops] Dead day DISABLED by FID ${params.adminFid}`);

    return { success: true };
  } catch (error) {
    console.error('[Ops] Failed to disable dead day:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Check if dead day has a scheduled reopen time that has passed
 */
export async function checkDeadDayScheduledReopen(): Promise<boolean> {
  const state = await getDeadDayState();

  if (!state.enabled || !state.reopenAt) {
    return false;
  }

  const reopenTime = new Date(state.reopenAt);
  const now = new Date();

  return now >= reopenTime;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Get the current active round ID (if any)
 */
async function getActiveRoundId(): Promise<number | null> {
  try {
    const [activeRound] = await db
      .select({ id: rounds.id })
      .from(rounds)
      .where(eq(rounds.status, 'active'))
      .orderBy(desc(rounds.startedAt))
      .limit(1);

    return activeRound?.id || null;
  } catch (error) {
    console.error('[Ops] Failed to get active round:', error);
    return null;
  }
}

/**
 * Log an operational event
 */
async function logOperationalEvent(params: {
  eventType: OperationalEventType;
  roundId?: number;
  triggeredBy: number;
  reason?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(operationalEvents).values({
      eventType: params.eventType,
      roundId: params.roundId ?? null,
      triggeredBy: params.triggeredBy,
      reason: params.reason ?? null,
      metadata: params.metadata ?? null,
    });
  } catch (error) {
    console.error('[Ops] Failed to log operational event:', error);
    // Don't throw - logging failure shouldn't block operations
  }
}

/**
 * Acquire a distributed lock for refund processing
 */
export async function acquireRefundLock(): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return false;

  try {
    // Use SET NX with expiry (5 minutes lock)
    const result = await redis.set(
      REDIS_KEYS.killSwitchRefundsRunning,
      Date.now().toString(),
      { nx: true, ex: 300 }
    );
    return result === 'OK';
  } catch (error) {
    console.error('[Ops] Failed to acquire refund lock:', error);
    return false;
  }
}

/**
 * Release the refund processing lock
 */
export async function releaseRefundLock(): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    await redis.del(REDIS_KEYS.killSwitchRefundsRunning);
  } catch (error) {
    console.error('[Ops] Failed to release refund lock:', error);
  }
}

/**
 * Check if refund processing is currently running
 */
export async function isRefundProcessingRunning(): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return false;

  try {
    const running = await redis.get(REDIS_KEYS.killSwitchRefundsRunning);
    return !!running;
  } catch (error) {
    return false;
  }
}

// ============================================================
// Cron Tracking
// ============================================================

/**
 * Record a refund cron run
 */
export async function recordRefundCronRun(result: {
  roundsProcessed: number;
  totalSent: number;
  totalFailed: number;
  durationMs: number;
}): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    const now = new Date().toISOString();
    await Promise.all([
      redis.set(REDIS_KEYS.refundCronLastRun, now),
      redis.set(REDIS_KEYS.refundCronLastResult, JSON.stringify({
        ...result,
        timestamp: now,
      })),
    ]);
  } catch (error) {
    console.error('[Ops] Failed to record refund cron run:', error);
  }
}

/**
 * Get refund cron timing info
 */
export async function getRefundCronTiming(): Promise<{
  lastRun: string | null;
  lastResult: {
    roundsProcessed: number;
    totalSent: number;
    totalFailed: number;
    durationMs: number;
    timestamp: string;
  } | null;
  nextRunEstimate: string;
}> {
  const redis = getRedisClient();

  // Default: cron runs every 5 minutes
  const CRON_INTERVAL_MS = 5 * 60 * 1000;

  // Calculate next run estimate based on 5-minute intervals from the hour
  const now = new Date();
  const minutes = now.getMinutes();
  const nextMinute = Math.ceil(minutes / 5) * 5;
  const nextRun = new Date(now);
  nextRun.setMinutes(nextMinute, 0, 0);
  if (nextRun <= now) {
    nextRun.setMinutes(nextRun.getMinutes() + 5);
  }

  if (!redis) {
    return {
      lastRun: null,
      lastResult: null,
      nextRunEstimate: nextRun.toISOString(),
    };
  }

  try {
    const [lastRun, lastResultStr] = await Promise.all([
      redis.get(REDIS_KEYS.refundCronLastRun),
      redis.get(REDIS_KEYS.refundCronLastResult),
    ]);

    let lastResult = null;
    if (lastResultStr) {
      try {
        lastResult = JSON.parse(lastResultStr as string);
      } catch {
        // Ignore parse errors
      }
    }

    return {
      lastRun: lastRun as string | null,
      lastResult,
      nextRunEstimate: nextRun.toISOString(),
    };
  } catch (error) {
    console.error('[Ops] Failed to get refund cron timing:', error);
    return {
      lastRun: null,
      lastResult: null,
      nextRunEstimate: nextRun.toISOString(),
    };
  }
}

// ============================================================
// Error Codes
// ============================================================

export const OPERATIONAL_ERROR_CODES = {
  GAME_PAUSED_KILL_SWITCH: 'GAME_PAUSED_KILL_SWITCH',
  GAME_PAUSED_BETWEEN_ROUNDS: 'GAME_PAUSED_BETWEEN_ROUNDS',
} as const;

export type OperationalErrorCode = typeof OPERATIONAL_ERROR_CODES[keyof typeof OPERATIONAL_ERROR_CODES];

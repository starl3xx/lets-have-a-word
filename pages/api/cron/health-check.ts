import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
import { db } from '../../../src/db';
import { rounds } from '../../../src/db/schema';
import { sql, and, isNotNull, isNull } from 'drizzle-orm';
import { checkRedisHealth } from '../../../src/lib/redis';
import {
  checkDeadDayScheduledReopen,
  disableDeadDay,
  getDeadDayState,
} from '../../../src/lib/operational';

/**
 * GET /api/cron/health-check
 * Milestone 9.2 - Vercel Cron Integration
 *
 * Performs health checks on critical infrastructure:
 * - Database connectivity and performance
 * - Redis/Upstash connectivity
 *
 * Called every 30 minutes by Vercel Cron.
 * Reports issues to Sentry for alerting.
 *
 * Schedule (vercel.json): every 30 minutes
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Allow GET and POST (Vercel Cron uses POST)
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify authorization in production
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;

  if (process.env.NODE_ENV === 'production') {
    if (!cronSecret) {
      console.error('[CRON] CRON_SECRET not configured');
      return res.status(500).json({ error: 'Cron not configured' });
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[CRON] Unauthorized health check attempt');
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const startTime = Date.now();
  console.log(`[CRON] Health check started at ${new Date().toISOString()}`);

  const results: {
    database: { ok: boolean; latencyMs?: number; error?: string };
    redis: { ok: boolean; latencyMs?: number; configured: boolean };
    overall: boolean;
  } = {
    database: { ok: false },
    redis: { ok: false, configured: false },
    overall: false,
  };

  // Check database connectivity
  try {
    const dbStart = Date.now();
    await db.select({ count: sql<number>`1` }).from(rounds).limit(1);
    results.database = {
      ok: true,
      latencyMs: Date.now() - dbStart,
    };
    console.log(`[CRON] Database check: OK (${results.database.latencyMs}ms)`);
  } catch (error) {
    results.database = {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
    console.error('[CRON] Database check: FAILED', error);

    // Report to Sentry
    Sentry.captureException(error, {
      tags: { cron: 'health-check', component: 'database' },
      level: 'error',
    });
  }

  // Check Redis connectivity
  try {
    const redisHealth = await checkRedisHealth();
    results.redis = {
      ok: redisHealth.connected,
      configured: redisHealth.configured,
      latencyMs: redisHealth.latencyMs,
    };

    if (redisHealth.configured && !redisHealth.connected) {
      console.warn('[CRON] Redis check: CONFIGURED BUT NOT CONNECTED');
      Sentry.captureMessage('Redis configured but not connected', {
        tags: { cron: 'health-check', component: 'redis' },
        level: 'warning',
      });
    } else if (redisHealth.configured) {
      console.log(`[CRON] Redis check: OK (${redisHealth.latencyMs}ms)`);
    } else {
      console.log('[CRON] Redis check: NOT CONFIGURED (optional)');
    }
  } catch (error) {
    results.redis = {
      ok: false,
      configured: true,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
    console.error('[CRON] Redis check: FAILED', error);

    Sentry.captureException(error, {
      tags: { cron: 'health-check', component: 'redis' },
      level: 'warning',
    });
  }

  // Milestone 9.5: Check for dead day scheduled reopen
  let deadDayAutoReopened = false;
  try {
    const shouldReopen = await checkDeadDayScheduledReopen();
    if (shouldReopen) {
      const deadDayState = await getDeadDayState();
      console.log(`[CRON] Dead day scheduled reopen time reached (${deadDayState.reopenAt}), disabling dead day`);

      const result = await disableDeadDay({ adminFid: 0 }); // 0 = system/cron
      if (result.success) {
        deadDayAutoReopened = true;
        console.log('[CRON] Dead day auto-disabled successfully');

        Sentry.captureMessage('Dead day auto-disabled (scheduled reopen)', {
          level: 'info',
          tags: { cron: 'health-check', type: 'operational' },
          extra: { reopenAt: deadDayState.reopenAt },
        });
      }
    }
  } catch (error) {
    console.error('[CRON] Error checking dead day reopen:', error);
    // Non-fatal, continue with health check
  }

  // Check for zombie rounds (winnerFid set but resolvedAt is null)
  // These indicate Phase 2 failed during round resolution and need manual recovery
  let zombieRounds: { id: number; winnerFid: number | null }[] = [];
  try {
    zombieRounds = await db
      .select({ id: rounds.id, winnerFid: rounds.winnerFid })
      .from(rounds)
      .where(
        and(
          isNotNull(rounds.winnerFid),
          isNull(rounds.resolvedAt),
        )
      );

    if (zombieRounds.length > 0) {
      const roundIds = zombieRounds.map(r => r.id);
      console.error(`[CRON] 🧟 ZOMBIE ROUNDS DETECTED: ${roundIds.join(', ')}`);

      Sentry.captureMessage('Zombie round detected: winner set but not resolved', {
        level: 'fatal',
        tags: { cron: 'health-check', type: 'zombie_round' },
        extra: {
          zombieRounds: zombieRounds.map(r => ({ roundId: r.id, winnerFid: r.winnerFid })),
          recoveryUrl: '/admin → Operations → Recover Stuck Round',
        },
      });
    }
  } catch (error) {
    console.error('[CRON] Error checking for zombie rounds:', error);
    // Non-fatal for the health check itself
  }

  // Overall health: database must be OK, no zombie rounds
  // Redis is optional (app works without it)
  results.overall = results.database.ok && zombieRounds.length === 0;

  const duration = Date.now() - startTime;
  console.log(`[CRON] Health check completed in ${duration}ms - Overall: ${results.overall ? 'HEALTHY' : 'UNHEALTHY'}`);

  // Return appropriate status code
  const statusCode = results.overall ? 200 : 503;

  return res.status(statusCode).json({
    ok: results.overall,
    timestamp: new Date().toISOString(),
    durationMs: duration,
    checks: results,
    deadDayAutoReopened, // Milestone 9.5
    zombieRounds: zombieRounds.map(r => ({ roundId: r.id, winnerFid: r.winnerFid })),
  });
}

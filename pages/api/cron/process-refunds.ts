import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
import { db } from '../../../src/db';
import { rounds } from '../../../src/db/schema';
import { eq, isNotNull, isNull, and } from 'drizzle-orm';
import {
  processRefunds,
  createRefundsForRound,
  getRefundSummary,
} from '../../../src/lib/refunds';
import { isKillSwitchEnabled, getKillSwitchState } from '../../../src/lib/operational';

/**
 * POST /api/cron/process-refunds
 * Milestone 9.5 - Kill Switch refund processing
 *
 * Processes pending refunds for cancelled rounds.
 * Called every 5 minutes by Vercel Cron when kill switch is active.
 *
 * Workflow:
 * 1. Check if kill switch is enabled
 * 2. Find cancelled rounds with pending refunds
 * 3. Create refund records if not already created
 * 4. Process pending refunds
 *
 * Security:
 * - Vercel Cron sends a secret in the Authorization header
 * - We verify CRON_SECRET to prevent unauthorized access
 *
 * Schedule (vercel.json): "0/5 * * * *" (every 5 minutes)
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only allow POST (Vercel Cron uses POST)
  // Also allow GET for manual testing
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify authorization
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;

  if (process.env.NODE_ENV === 'production') {
    if (!cronSecret) {
      console.error('[CRON] CRON_SECRET not configured');
      return res.status(500).json({ error: 'Cron not configured' });
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[CRON] Unauthorized refund cron attempt');
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const startTime = Date.now();
  console.log(`[CRON] Refund processing started at ${new Date().toISOString()}`);

  try {
    // Check if there's work to do
    const killSwitchActive = await isKillSwitchEnabled();
    const killSwitchState = await getKillSwitchState();

    // Find cancelled rounds that still need refunds processed
    const cancelledRounds = await db
      .select({
        id: rounds.id,
        cancelledAt: rounds.cancelledAt,
        refundsStartedAt: rounds.refundsStartedAt,
        refundsCompletedAt: rounds.refundsCompletedAt,
      })
      .from(rounds)
      .where(and(
        eq(rounds.status, 'cancelled'),
        isNull(rounds.refundsCompletedAt) // Not yet fully processed
      ))
      .limit(5); // Process up to 5 rounds per run

    if (cancelledRounds.length === 0) {
      const duration = Date.now() - startTime;
      console.log(`[CRON] No cancelled rounds needing refunds (${duration}ms)`);
      return res.status(200).json({
        ok: true,
        message: 'No refunds to process',
        killSwitchActive,
        durationMs: duration,
        timestamp: new Date().toISOString(),
      });
    }

    console.log(`[CRON] Found ${cancelledRounds.length} cancelled round(s) to process`);

    const results: Array<{
      roundId: number;
      created: number;
      processed: number;
      sent: number;
      failed: number;
      summary: Awaited<ReturnType<typeof getRefundSummary>>;
    }> = [];

    // Process each cancelled round
    for (const round of cancelledRounds) {
      console.log(`[CRON] Processing refunds for round ${round.id}`);

      // Step 1: Create refund records if not already created
      const createResult = await createRefundsForRound(
        round.id,
        killSwitchState.activatedBy || 0
      );

      // Step 2: Process pending refunds
      const processResult = await processRefunds(round.id);

      // Get summary
      const summary = await getRefundSummary(round.id);

      results.push({
        roundId: round.id,
        created: createResult.created,
        processed: processResult.totalProcessed,
        sent: processResult.sentCount,
        failed: processResult.failedCount,
        summary,
      });

      // If there were errors, report them
      if (processResult.errors.length > 0) {
        Sentry.captureMessage('Refund processing had errors', {
          level: 'warning',
          tags: { cron: 'process-refunds', roundId: round.id.toString() },
          extra: {
            errors: processResult.errors,
            result: processResult,
          },
        });
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[CRON] Refund processing completed in ${duration}ms`);

    // Calculate totals
    const totalCreated = results.reduce((sum, r) => sum + r.created, 0);
    const totalProcessed = results.reduce((sum, r) => sum + r.processed, 0);
    const totalSent = results.reduce((sum, r) => sum + r.sent, 0);
    const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);

    return res.status(200).json({
      ok: true,
      killSwitchActive,
      roundsProcessed: cancelledRounds.length,
      totalCreated,
      totalProcessed,
      totalSent,
      totalFailed,
      results,
      durationMs: duration,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[CRON] Refund processing failed:', error);

    Sentry.captureException(error, {
      tags: { cron: 'process-refunds' },
    });

    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Refund processing failed',
      timestamp: new Date().toISOString(),
    });
  }
}

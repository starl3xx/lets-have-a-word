import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
import { syncAllRounds } from '../../../src/lib/archive';

/**
 * POST /api/cron/archive-sync
 * Milestone 9.2 - Vercel Cron Integration
 *
 * Automatically archives all resolved rounds that haven't been archived yet.
 * This ensures no rounds are missed and historical data is preserved.
 *
 * Called daily at 1:00 AM UTC by Vercel Cron.
 *
 * Schedule (vercel.json): "0 1 * * *" (daily at 1:00 AM UTC)
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
      console.warn('[CRON] Unauthorized archive sync attempt');
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const startTime = Date.now();
  console.log(`[CRON] Archive sync started at ${new Date().toISOString()}`);

  try {
    // Sync all unarchived resolved rounds
    const result = await syncAllRounds();

    const duration = Date.now() - startTime;
    console.log(
      `[CRON] Archive sync completed in ${duration}ms: ` +
      `${result.archived} archived, ${result.alreadyArchived} already archived, ${result.failed} failed`
    );

    // Report failures to Sentry if any
    if (result.failed > 0) {
      Sentry.captureMessage(`Archive sync had ${result.failed} failures`, {
        tags: { cron: 'archive-sync' },
        level: 'warning',
        extra: {
          archived: result.archived,
          alreadyArchived: result.alreadyArchived,
          failed: result.failed,
          errors: result.errors,
        },
      });
    }

    return res.status(200).json({
      ok: result.failed === 0,
      archived: result.archived,
      alreadyArchived: result.alreadyArchived,
      failed: result.failed,
      errors: result.errors,
      durationMs: duration,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[CRON] Archive sync failed:', error);

    // Report to Sentry
    Sentry.captureException(error, {
      tags: { cron: 'archive-sync' },
    });

    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Archive sync failed',
      timestamp: new Date().toISOString(),
    });
  }
}

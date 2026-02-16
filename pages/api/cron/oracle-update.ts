import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
import { runOracleUpdate, initializeOracle, getContractMarketCapInfo, formatMarketCap } from '../../../src/lib/word-oracle';

/**
 * POST /api/cron/oracle-update
 * Milestone 9.1 - Vercel Cron Integration
 *
 * Updates $WORD market cap on the JackpotManager contract.
 * Called every 15 minutes by Vercel Cron.
 *
 * Security:
 * - Vercel Cron sends a secret in the Authorization header
 * - We verify CRON_SECRET to prevent unauthorized access
 *
 * Schedule (vercel.json): "0/15 * * * *" (every 15 minutes)
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
  // Vercel Cron sets Authorization header with CRON_SECRET
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;

  // In production, require secret; in dev, allow without
  if (process.env.NODE_ENV === 'production') {
    if (!cronSecret) {
      console.error('[CRON] CRON_SECRET not configured');
      return res.status(500).json({ error: 'Cron not configured' });
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[CRON] Unauthorized cron attempt');
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const startTime = Date.now();
  console.log(`[CRON] Oracle update started at ${new Date().toISOString()}`);

  try {
    // Initialize oracle (verifies contract access)
    const initialized = await initializeOracle();

    if (!initialized) {
      const error = new Error('Failed to initialize oracle');
      Sentry.captureException(error);
      return res.status(500).json({
        ok: false,
        error: 'Oracle initialization failed',
      });
    }

    // Run the update
    await runOracleUpdate();

    // Get updated state
    const info = await getContractMarketCapInfo();
    const marketCapUsd = Number(info.marketCapUsd) / 1e8;
    const tier = info.tier === 0 ? 'LOW' : 'HIGH';

    const duration = Date.now() - startTime;
    console.log(`[CRON] Oracle update completed in ${duration}ms`);

    return res.status(200).json({
      ok: true,
      marketCap: formatMarketCap(marketCapUsd),
      marketCapUsd,
      tier,
      isStale: info.isStale,
      durationMs: duration,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[CRON] Oracle update failed:', error);

    // Report to Sentry
    Sentry.captureException(error, {
      tags: { cron: 'oracle-update' },
    });

    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Oracle update failed',
      timestamp: new Date().toISOString(),
    });
  }
}

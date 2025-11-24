/**
 * Additional Metrics Analytics API
 * Phase 4: Advanced analytics
 *
 * Returns additional game metrics
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../../src/db';
import { sql } from 'drizzle-orm';
import { isAdminFid } from '../me';

export interface AdditionalMetrics {
  // Round metrics
  avgRoundLengthMinutes: number;
  avgRoundJackpotEth: number;
  totalRounds: number;

  // Guess metrics
  avgGuessesPerRound: number;
  avgGuessesPerDayPerUser: number;
  clanktonGuessesPerUser: number;

  // Revenue metrics
  creatorRevenuePerRound: number;
  creatorRevenueTotalEth: number;

  // Time-based
  timeRange: string;
}

/**
 * GET /api/admin/analytics/metrics
 *
 * Returns additional analytics metrics (requires admin access)
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AdditionalMetrics | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check if analytics is enabled
  if (process.env.ANALYTICS_ENABLED !== 'true') {
    console.log('[analytics/metrics] Analytics disabled: ANALYTICS_ENABLED not set to "true"');
    return res.status(503).json({ error: 'Analytics not enabled.' });
  }

  try {
    // Get FID from query params (dev mode)
    let fid: number | null = null;
    if (req.query.devFid) {
      fid = parseInt(req.query.devFid as string, 10);
      console.log('[analytics/metrics] Using devFid:', fid);
    } else if (req.cookies.siwn_fid) {
      fid = parseInt(req.cookies.siwn_fid, 10);
      console.log('[analytics/metrics] Using cookie FID:', fid);
    }

    if (!fid) {
      console.log('[analytics/metrics] No FID provided');
      return res.status(401).json({ error: 'Authentication required: No FID provided' });
    }

    if (!isAdminFid(fid)) {
      console.log('[analytics/metrics] FID is not admin:', fid);
      return res.status(403).json({ error: `Forbidden: FID ${fid} is not an admin.` });
    }

    // Get time range from query params
    const timeRange = req.query.range as string || '30d';
    const daysBack = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 9999;

    // Query 1: Average round length and jackpot
    const roundMetrics = await db.execute<{ avg_length_minutes: number; avg_jackpot: number; total_rounds: number }>(
      sql`
        SELECT
          AVG(EXTRACT(EPOCH FROM (COALESCE(resolved_at, NOW()) - started_at)) / 60) as avg_length_minutes,
          AVG(CAST(prize_pool_eth AS NUMERIC)) as avg_jackpot,
          COUNT(*) as total_rounds
        FROM rounds
        WHERE started_at >= NOW() - INTERVAL '${sql.raw(daysBack.toString())} days'
          AND is_dev_test_round = false
      `
    );

    // Query 2: Average guesses per round
    const guessMetrics = await db.execute<{ avg_guesses_per_round: number }>(
      sql`
        SELECT
          AVG(guess_count) as avg_guesses_per_round
        FROM (
          SELECT round_id, COUNT(*) as guess_count
          FROM guesses
          WHERE created_at >= NOW() - INTERVAL '${sql.raw(daysBack.toString())} days'
          GROUP BY round_id
        ) as round_guesses
      `
    );

    // Query 3: Average guesses per day per user
    const userGuessMetrics = await db.execute<{ avg_guesses_per_day_per_user: number }>(
      sql`
        SELECT
          AVG(daily_guess_count) as avg_guesses_per_day_per_user
        FROM (
          SELECT fid, DATE(created_at) as day, COUNT(*) as daily_guess_count
          FROM guesses
          WHERE created_at >= NOW() - INTERVAL '${sql.raw(daysBack.toString())} days'
          GROUP BY fid, DATE(created_at)
        ) as user_daily_guesses
      `
    );

    // Query 4: CLANKTON guesses per user (users with free_allocated_clankton > 0)
    const clanktonMetrics = await db.execute<{ clankton_guesses_per_user: number }>(
      sql`
        SELECT
          COALESCE(AVG(guess_count), 0) as clankton_guesses_per_user
        FROM (
          SELECT dgs.fid, COUNT(g.id) as guess_count
          FROM daily_guess_state dgs
          LEFT JOIN guesses g ON g.fid = dgs.fid
            AND DATE(g.created_at) = dgs.date
          WHERE dgs.free_allocated_clankton > 0
            AND dgs.date >= NOW() - INTERVAL '${sql.raw(daysBack.toString())} days'
          GROUP BY dgs.fid
        ) as clankton_users
      `
    );

    // Query 5: Creator revenue
    const revenueMetrics = await db.execute<{ revenue_per_round: number; total_revenue: number }>(
      sql`
        SELECT
          AVG(CAST(amount_eth AS NUMERIC)) as revenue_per_round,
          SUM(CAST(amount_eth AS NUMERIC)) as total_revenue
        FROM round_payouts
        WHERE role = 'creator'
          AND created_at >= NOW() - INTERVAL '${sql.raw(daysBack.toString())} days'
      `
    );

    const roundData = Array.isArray(roundMetrics) ? roundMetrics[0] : roundMetrics;
    const guessData = Array.isArray(guessMetrics) ? guessMetrics[0] : guessMetrics;
    const userGuessData = Array.isArray(userGuessMetrics) ? userGuessMetrics[0] : userGuessMetrics;
    const clanktonData = Array.isArray(clanktonMetrics) ? clanktonMetrics[0] : clanktonMetrics;
    const revenueData = Array.isArray(revenueMetrics) ? revenueMetrics[0] : revenueMetrics;

    const metrics: AdditionalMetrics = {
      avgRoundLengthMinutes: Number(roundData?.avg_length_minutes) || 0,
      avgRoundJackpotEth: Number(roundData?.avg_jackpot) || 0,
      totalRounds: Number(roundData?.total_rounds) || 0,
      avgGuessesPerRound: Number(guessData?.avg_guesses_per_round) || 0,
      avgGuessesPerDayPerUser: Number(userGuessData?.avg_guesses_per_day_per_user) || 0,
      clanktonGuessesPerUser: Number(clanktonData?.clankton_guesses_per_user) || 0,
      creatorRevenuePerRound: Number(revenueData?.revenue_per_round) || 0,
      creatorRevenueTotalEth: Number(revenueData?.total_revenue) || 0,
      timeRange
    };

    console.log('[analytics/metrics] Returning metrics:', JSON.stringify(metrics));
    return res.status(200).json(metrics);
  } catch (error) {
    console.error('[analytics/metrics] Error fetching metrics:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

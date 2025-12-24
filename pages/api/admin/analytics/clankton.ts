/**
 * CLANKTON Analytics API
 * Analytics v2: CLANKTON holder behavior and bonus usage
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../../src/db';
import { sql } from 'drizzle-orm';
import { isAdminFid } from '../me';
import { cacheAside, CacheKeys, CacheTTL, trackSlowQuery } from '../../../../src/lib/redis';

export interface ClanktonAnalytics {
  // Core metrics
  clanktonUserPercentage: number;
  clanktonSolveRate: number;
  regularSolveRate: number;
  avgClanktonBonusUsage: number;

  // Comparative metrics
  avgGuessesPerRoundClankton: number;
  avgGuessesPerRoundRegular: number;
  clanktonActiveUsers: number;
  regularActiveUsers: number;

  // Time series
  dailyClanktonUsage: Array<{
    day: string;
    clankton_guesses: number;
    regular_guesses: number;
    clankton_users: number;
  }>;

  timeRange: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ClanktonAnalytics | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (process.env.ANALYTICS_ENABLED !== 'true') {
    return res.status(503).json({ error: 'Analytics not enabled.' });
  }

  try {
    let fid: number | null = null;
    if (req.query.devFid) {
      fid = parseInt(req.query.devFid as string, 10);
    } else if (req.cookies.siwn_fid) {
      fid = parseInt(req.cookies.siwn_fid, 10);
    }

    if (!fid || !isAdminFid(fid)) {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }

    const timeRange = req.query.range as string || '30d';
    const daysBack = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 9999;

    // Query 1: CLANKTON vs Regular user metrics
    const userMetrics = await db.execute<{
      is_clankton: boolean;
      active_users: number;
      total_guesses: number;
      correct_guesses: number;
      solve_rate: number;
      avg_guesses_per_round: number;
    }>(sql`
      WITH user_classification AS (
        SELECT DISTINCT
          dgs.fid,
          CASE WHEN MAX(dgs.free_allocated_clankton) > 0 THEN true ELSE false END as is_clankton
        FROM daily_guess_state dgs
        WHERE dgs.date >= NOW() - INTERVAL '${sql.raw(daysBack.toString())} days'
        GROUP BY dgs.fid
      ),
      guess_stats AS (
        SELECT
          g.fid,
          uc.is_clankton,
          COUNT(g.id) as total_guesses,
          SUM(CASE WHEN g.is_correct THEN 1 ELSE 0 END) as correct_guesses
        FROM guesses g
        JOIN user_classification uc ON uc.fid = g.fid
        WHERE g.created_at >= NOW() - INTERVAL '${sql.raw(daysBack.toString())} days'
        GROUP BY g.fid, uc.is_clankton
      )
      SELECT
        is_clankton,
        COUNT(DISTINCT fid) as active_users,
        SUM(total_guesses) as total_guesses,
        SUM(correct_guesses) as correct_guesses,
        ROUND(AVG(CASE WHEN total_guesses > 0 THEN correct_guesses::numeric / total_guesses * 100 ELSE 0 END), 2) as solve_rate,
        ROUND(AVG(total_guesses), 2) as avg_guesses_per_round
      FROM guess_stats
      GROUP BY is_clankton
    `);

    // Query 2: CLANKTON bonus usage
    const bonusUsage = await db.execute<{
      avg_bonus_usage: number;
    }>(sql`
      SELECT
        AVG(free_allocated_clankton) as avg_bonus_usage
      FROM daily_guess_state
      WHERE free_allocated_clankton > 0
        AND date >= NOW() - INTERVAL '${sql.raw(daysBack.toString())} days'
    `);

    // Query 3: Daily CLANKTON usage trend
    const dailyUsage = await db.execute<{
      day: string;
      clankton_guesses: number;
      regular_guesses: number;
      clankton_users: number;
    }>(sql`
      WITH user_classification AS (
        SELECT DISTINCT
          dgs.fid,
          dgs.date,
          CASE WHEN dgs.free_allocated_clankton > 0 THEN true ELSE false END as is_clankton
        FROM daily_guess_state dgs
        WHERE dgs.date >= NOW() - INTERVAL '${sql.raw(daysBack.toString())} days'
      )
      SELECT
        DATE(g.created_at) as day,
        COUNT(g.id) FILTER (WHERE uc.is_clankton = true) as clankton_guesses,
        COUNT(g.id) FILTER (WHERE uc.is_clankton = false OR uc.is_clankton IS NULL) as regular_guesses,
        COUNT(DISTINCT g.fid) FILTER (WHERE uc.is_clankton = true) as clankton_users
      FROM guesses g
      LEFT JOIN user_classification uc ON uc.fid = g.fid AND uc.date = DATE(g.created_at)
      WHERE g.created_at >= NOW() - INTERVAL '${sql.raw(daysBack.toString())} days'
      GROUP BY DATE(g.created_at)
      ORDER BY day DESC
      LIMIT 30
    `);

    const metricsArray = Array.isArray(userMetrics) ? userMetrics : [];
    const clanktonMetrics = metricsArray.find(m => m.is_clankton === true);
    const regularMetrics = metricsArray.find(m => m.is_clankton === false);
    const bonusData = Array.isArray(bonusUsage) ? bonusUsage[0] : bonusUsage;
    const dailyArray = Array.isArray(dailyUsage) ? dailyUsage : [];

    const totalActiveUsers = (Number(clanktonMetrics?.active_users) || 0) + (Number(regularMetrics?.active_users) || 0);

    const analytics: ClanktonAnalytics = {
      clanktonUserPercentage: totalActiveUsers > 0 ? Number(((Number(clanktonMetrics?.active_users) || 0) / totalActiveUsers * 100).toFixed(2)) : 0,
      clanktonSolveRate: Number(clanktonMetrics?.solve_rate) || 0,
      regularSolveRate: Number(regularMetrics?.solve_rate) || 0,
      avgClanktonBonusUsage: Number(bonusData?.avg_bonus_usage) || 0,
      avgGuessesPerRoundClankton: Number(clanktonMetrics?.avg_guesses_per_round) || 0,
      avgGuessesPerRoundRegular: Number(regularMetrics?.avg_guesses_per_round) || 0,
      clanktonActiveUsers: Number(clanktonMetrics?.active_users) || 0,
      regularActiveUsers: Number(regularMetrics?.active_users) || 0,
      dailyClanktonUsage: dailyArray.map(d => ({
        day: d.day?.toString() || '',
        clankton_guesses: Number(d.clankton_guesses) || 0,
        regular_guesses: Number(d.regular_guesses) || 0,
        clankton_users: Number(d.clankton_users) || 0
      })),
      timeRange
    };

    console.log('[analytics/clankton] Returning analytics:', JSON.stringify(analytics).substring(0, 300));
    return res.status(200).json(analytics);
  } catch (error) {
    console.error('[analytics/clankton] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Performance Metrics API
 * Milestone 5.3: Advanced analytics & fairness systems
 *
 * Provides:
 * - Median guesses to solve
 * - Guess distribution histogram
 * - CLANKTON holder solve-rate advantage
 * - Referral-generated guesses
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../../src/db';
import { sql } from 'drizzle-orm';
import { isAdminFid } from '../me';
import { cacheAside, CacheKeys, CacheTTL, trackSlowQuery } from '../../../../src/lib/redis';

export interface PerformanceMetrics {
  // Core performance metrics
  medianGuessesToSolve: number;
  meanGuessesToSolve: number;
  totalGuesses: number;
  totalRounds: number;

  // Guess distribution histogram
  guessDistribution: Array<{
    bucket: string; // "1-5", "6-10", etc.
    count: number;
    percentage: number;
  }>;

  // CLANKTON holder advantage
  clanktonAdvantage: {
    clanktonSolveRate: number;
    regularSolveRate: number;
    clanktonAvgGuesses: number;
    regularAvgGuesses: number;
    advantagePercentage: number; // How much better CLANKTON holders perform
    clanktonWinRate: number;
    regularWinRate: number;
  };

  // Referral metrics
  referralMetrics: {
    totalReferrals: number;
    referralGeneratedGuesses: number;
    referralWins: number;
    referralPayoutsEth: number;
    topReferrers: Array<{
      fid: number;
      username: string | null;
      referralCount: number;
      referralGuesses: number;
    }>;
  };

  // User quality metrics (Milestone 5.3)
  userQualityMetrics: {
    avgUserScore: number;
    eligibleUsers: number;
    blockedUsers: number;
    blockedAttempts: number;
  };

  timeRange: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PerformanceMetrics | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (process.env.ANALYTICS_ENABLED !== 'true') {
    return res.status(503).json({ error: 'Analytics not enabled.' });
  }

  try {
    // Admin authentication
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

    // Query 1: Core solve metrics with median
    const solveMetrics = await db.execute<{
      median_guesses: number;
      mean_guesses: number;
      total_guesses: number;
      total_rounds: number;
    }>(sql`
      WITH round_guess_counts AS (
        SELECT
          r.id,
          COUNT(g.id) as guess_count
        FROM rounds r
        LEFT JOIN guesses g ON g.round_id = r.id
        WHERE r.started_at >= NOW() - INTERVAL '${sql.raw(daysBack.toString())} days'
          AND r.is_dev_test_round = false
          AND r.resolved_at IS NOT NULL
        GROUP BY r.id
      )
      SELECT
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY guess_count) as median_guesses,
        AVG(guess_count) as mean_guesses,
        SUM(guess_count) as total_guesses,
        COUNT(*) as total_rounds
      FROM round_guess_counts
    `);

    // Query 2: Guess distribution histogram with buckets
    const guessDistQuery = await db.execute<{
      bucket: string;
      count: number;
    }>(sql`
      WITH round_guess_counts AS (
        SELECT
          r.id,
          COUNT(g.id) as guess_count
        FROM rounds r
        LEFT JOIN guesses g ON g.round_id = r.id
        WHERE r.started_at >= NOW() - INTERVAL '${sql.raw(daysBack.toString())} days'
          AND r.is_dev_test_round = false
          AND r.resolved_at IS NOT NULL
        GROUP BY r.id
      )
      SELECT
        CASE
          WHEN guess_count BETWEEN 1 AND 5 THEN '1-5'
          WHEN guess_count BETWEEN 6 AND 10 THEN '6-10'
          WHEN guess_count BETWEEN 11 AND 20 THEN '11-20'
          WHEN guess_count BETWEEN 21 AND 50 THEN '21-50'
          WHEN guess_count BETWEEN 51 AND 100 THEN '51-100'
          ELSE '100+'
        END as bucket,
        COUNT(*) as count
      FROM round_guess_counts
      GROUP BY bucket
      ORDER BY
        CASE bucket
          WHEN '1-5' THEN 1
          WHEN '6-10' THEN 2
          WHEN '11-20' THEN 3
          WHEN '21-50' THEN 4
          WHEN '51-100' THEN 5
          ELSE 6
        END
    `);

    // Query 3: CLANKTON holder advantage
    const clanktonAdvantage = await db.execute<{
      is_clankton: boolean;
      solve_rate: number;
      avg_guesses: number;
      win_rate: number;
      user_count: number;
    }>(sql`
      WITH user_classification AS (
        SELECT DISTINCT
          dgs.fid,
          CASE WHEN MAX(dgs.free_allocated_clankton) > 0 THEN true ELSE false END as is_clankton
        FROM daily_guess_state dgs
        WHERE dgs.date >= NOW() - INTERVAL '${sql.raw(daysBack.toString())} days'
        GROUP BY dgs.fid
      ),
      user_stats AS (
        SELECT
          uc.fid,
          uc.is_clankton,
          COUNT(g.id) as total_guesses,
          SUM(CASE WHEN g.is_correct THEN 1 ELSE 0 END) as correct_guesses,
          COUNT(DISTINCT CASE WHEN r.winner_fid = uc.fid THEN r.id END) as wins,
          COUNT(DISTINCT r.id) as rounds_played
        FROM user_classification uc
        JOIN guesses g ON g.fid = uc.fid
        JOIN rounds r ON r.id = g.round_id
        WHERE g.created_at >= NOW() - INTERVAL '${sql.raw(daysBack.toString())} days'
          AND r.is_dev_test_round = false
        GROUP BY uc.fid, uc.is_clankton
      )
      SELECT
        is_clankton,
        ROUND(AVG(CASE WHEN total_guesses > 0 THEN correct_guesses::numeric / total_guesses * 100 ELSE 0 END), 2) as solve_rate,
        ROUND(AVG(total_guesses), 2) as avg_guesses,
        ROUND(AVG(CASE WHEN rounds_played > 0 THEN wins::numeric / rounds_played * 100 ELSE 0 END), 2) as win_rate,
        COUNT(*) as user_count
      FROM user_stats
      GROUP BY is_clankton
    `);

    // Query 4: Referral metrics
    const referralMetrics = await db.execute<{
      total_referrals: number;
      referral_guesses: number;
      referral_wins: number;
      referral_payouts: number;
    }>(sql`
      WITH referred_users AS (
        SELECT fid
        FROM users
        WHERE referrer_fid IS NOT NULL
      ),
      referral_guesses AS (
        SELECT COUNT(*) as count
        FROM guesses g
        JOIN referred_users ru ON ru.fid = g.fid
        WHERE g.created_at >= NOW() - INTERVAL '${sql.raw(daysBack.toString())} days'
      ),
      referral_wins AS (
        SELECT COUNT(*) as count
        FROM rounds r
        JOIN referred_users ru ON ru.fid = r.winner_fid
        WHERE r.resolved_at >= NOW() - INTERVAL '${sql.raw(daysBack.toString())} days'
      ),
      referral_payouts AS (
        SELECT COALESCE(SUM(CAST(amount_eth AS DECIMAL)), 0) as total
        FROM round_payouts
        WHERE role = 'referrer'
          AND created_at >= NOW() - INTERVAL '${sql.raw(daysBack.toString())} days'
      )
      SELECT
        (SELECT COUNT(*) FROM users WHERE referrer_fid IS NOT NULL) as total_referrals,
        (SELECT count FROM referral_guesses) as referral_guesses,
        (SELECT count FROM referral_wins) as referral_wins,
        (SELECT total FROM referral_payouts) as referral_payouts
    `);

    // Query 5: Top referrers
    const topReferrers = await db.execute<{
      fid: number;
      username: string | null;
      referral_count: number;
      referral_guesses: number;
    }>(sql`
      WITH referrer_stats AS (
        SELECT
          u.referrer_fid as fid,
          COUNT(DISTINCT u.fid) as referral_count,
          COUNT(g.id) as referral_guesses
        FROM users u
        LEFT JOIN guesses g ON g.fid = u.fid
          AND g.created_at >= NOW() - INTERVAL '${sql.raw(daysBack.toString())} days'
        WHERE u.referrer_fid IS NOT NULL
        GROUP BY u.referrer_fid
        ORDER BY referral_count DESC
        LIMIT 10
      )
      SELECT
        rs.fid,
        u.username,
        rs.referral_count,
        rs.referral_guesses
      FROM referrer_stats rs
      LEFT JOIN users u ON u.fid = rs.fid
    `);

    // Query 6: User quality metrics
    const userQualityMetrics = await db.execute<{
      avg_score: number;
      eligible_users: number;
      ineligible_users: number;
      blocked_attempts: number;
    }>(sql`
      SELECT
        COALESCE(AVG(CAST(user_score AS DECIMAL)), 0) as avg_score,
        COUNT(CASE WHEN CAST(user_score AS DECIMAL) >= 0.55 THEN 1 END) as eligible_users,
        COUNT(CASE WHEN CAST(user_score AS DECIMAL) < 0.55 THEN 1 END) as ineligible_users,
        (SELECT COUNT(*) FROM analytics_events WHERE event_type = 'USER_QUALITY_BLOCKED') as blocked_attempts
      FROM users
      WHERE user_score IS NOT NULL
    `);

    // Process results
    const solveData = Array.isArray(solveMetrics) ? solveMetrics[0] : solveMetrics;
    const guessDistArray = Array.isArray(guessDistQuery) ? guessDistQuery : [];
    const clanktonArray = Array.isArray(clanktonAdvantage) ? clanktonAdvantage : [];
    const referralData = Array.isArray(referralMetrics) ? referralMetrics[0] : referralMetrics;
    const topReferrersArray = Array.isArray(topReferrers) ? topReferrers : [];
    const userQualityData = Array.isArray(userQualityMetrics) ? userQualityMetrics[0] : userQualityMetrics;

    const clanktonStats = clanktonArray.find(c => c.is_clankton === true);
    const regularStats = clanktonArray.find(c => c.is_clankton === false);

    const totalBuckets = guessDistArray.reduce((sum, item) => sum + Number(item.count), 0);
    const guessDistribution = guessDistArray.map(item => ({
      bucket: item.bucket,
      count: Number(item.count),
      percentage: totalBuckets > 0 ? Number(((Number(item.count) / totalBuckets) * 100).toFixed(2)) : 0,
    }));

    // Calculate CLANKTON advantage percentage
    const clanktonSolveRate = Number(clanktonStats?.solve_rate) || 0;
    const regularSolveRate = Number(regularStats?.solve_rate) || 0;
    const advantagePercentage = regularSolveRate > 0
      ? Number((((clanktonSolveRate - regularSolveRate) / regularSolveRate) * 100).toFixed(2))
      : 0;

    const metrics: PerformanceMetrics = {
      medianGuessesToSolve: Number(solveData?.median_guesses) || 0,
      meanGuessesToSolve: Number(solveData?.mean_guesses) || 0,
      totalGuesses: Number(solveData?.total_guesses) || 0,
      totalRounds: Number(solveData?.total_rounds) || 0,

      guessDistribution,

      clanktonAdvantage: {
        clanktonSolveRate,
        regularSolveRate,
        clanktonAvgGuesses: Number(clanktonStats?.avg_guesses) || 0,
        regularAvgGuesses: Number(regularStats?.avg_guesses) || 0,
        advantagePercentage,
        clanktonWinRate: Number(clanktonStats?.win_rate) || 0,
        regularWinRate: Number(regularStats?.win_rate) || 0,
      },

      referralMetrics: {
        totalReferrals: Number(referralData?.total_referrals) || 0,
        referralGeneratedGuesses: Number(referralData?.referral_guesses) || 0,
        referralWins: Number(referralData?.referral_wins) || 0,
        referralPayoutsEth: Number(referralData?.referral_payouts) || 0,
        topReferrers: topReferrersArray.map(r => ({
          fid: Number(r.fid),
          username: r.username,
          referralCount: Number(r.referral_count),
          referralGuesses: Number(r.referral_guesses),
        })),
      },

      userQualityMetrics: {
        avgUserScore: Number(userQualityData?.avg_score) || 0,
        eligibleUsers: Number(userQualityData?.eligible_users) || 0,
        blockedUsers: Number(userQualityData?.ineligible_users) || 0,
        blockedAttempts: Number(userQualityData?.blocked_attempts) || 0,
      },

      timeRange,
    };

    console.log('[analytics/performance] Returning metrics:', JSON.stringify(metrics).substring(0, 500));
    return res.status(200).json(metrics);

  } catch (error) {
    console.error('[analytics/performance] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Economy & Revenue Analytics API
 * Analytics v2: Jackpot health, pack sales, ARPDAU, sustainability
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../../src/db';
import { sql } from 'drizzle-orm';
import { isAdminFid } from '../me';
import { cacheAside, CacheKeys, CacheTTL, trackSlowQuery } from '../../../../src/lib/redis';

export interface EconomyAnalytics {
  // Pack metrics
  packAttachRate: number;
  avgPackRevenuePerActiveUser: number;
  packPurchaseCount: number;
  packViewToPurchaseRate: number;

  // Jackpot health
  prizePoolSustainabilityScore: number;
  avgJackpot7Day: number;
  avgPayoutPerWinner: number;

  // ARPU metrics
  arpdau: number;
  arppu: number;
  payingUserPercentage: number;

  // Time series
  jackpotTrend: Array<{
    day: string;
    avg_jackpot: number;
    winners: number;
    total_payout: number;
  }>;

  packSalesTrend: Array<{
    day: string;
    packs_sold: number;
    revenue_eth: number;
    buyers: number;
  }>;

  timeRange: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<EconomyAnalytics | { error: string }>
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

    // Initialize with default values
    let packMetrics: any = null;
    let jackpotHealth: any = null;
    let jackpot7Day: any = null;
    let jackpotTrend: any[] = [];
    let packSalesTrend: any[] = [];

    // Query 1: Pack purchase metrics
    try {
      console.log('[analytics/economy] Fetching pack metrics...');
      packMetrics = await db.execute<{
        total_active_users: number;
        pack_buyers: number;
        pack_views: number;
        pack_purchases: number;
        total_revenue: number;
      }>(sql`
        WITH active_users AS (
          SELECT COUNT(DISTINCT user_id) as total_active_users
          FROM analytics_events
          WHERE created_at >= NOW() - INTERVAL '${sql.raw(daysBack.toString())} days'
            AND user_id IS NOT NULL
        ),
        pack_events AS (
          SELECT
            COUNT(DISTINCT user_id) FILTER (WHERE event_type = 'guess_pack_purchased') as pack_buyers,
            COUNT(*) FILTER (WHERE event_type = 'guess_pack_viewed') as pack_views,
            COUNT(*) FILTER (WHERE event_type = 'guess_pack_purchased') as pack_purchases,
            SUM(CAST(data->>'price_eth' AS NUMERIC)) FILTER (WHERE event_type = 'guess_pack_purchased') as total_revenue
          FROM analytics_events
          WHERE created_at >= NOW() - INTERVAL '${sql.raw(daysBack.toString())} days'
            AND event_type IN ('guess_pack_viewed', 'guess_pack_purchased')
        )
        SELECT
          au.total_active_users,
          COALESCE(pe.pack_buyers, 0) as pack_buyers,
          COALESCE(pe.pack_views, 0) as pack_views,
          COALESCE(pe.pack_purchases, 0) as pack_purchases,
          COALESCE(pe.total_revenue, 0) as total_revenue
        FROM active_users au
        CROSS JOIN pack_events pe
      `);
    } catch (err) {
      console.error('[analytics/economy] Pack metrics query failed:', err);
    }

    // Query 2: Jackpot health and sustainability
    try {
      console.log('[analytics/economy] Fetching jackpot health...');
      jackpotHealth = await db.execute<{
        avg_jackpot: number;
        avg_payout: number;
        total_creator_rev: number;
        total_seed: number;
        sustainability_score: number;
      }>(sql`
        WITH round_data AS (
          SELECT
            CAST(prize_pool_eth AS NUMERIC) as jackpot,
            CAST(seed_next_round_eth AS NUMERIC) as seed
          FROM rounds
          WHERE started_at >= NOW() - INTERVAL '${sql.raw(daysBack.toString())} days'
            AND is_dev_test_round = false
            AND resolved_at IS NOT NULL
        ),
        payout_data AS (
          SELECT
            AVG(CAST(amount_eth AS NUMERIC)) FILTER (WHERE role = 'winner') as avg_payout,
            SUM(CAST(amount_eth AS NUMERIC)) FILTER (WHERE role = 'creator') as total_creator_rev,
            SUM(CAST(amount_eth AS NUMERIC)) FILTER (WHERE role = 'seed') as total_seed
          FROM round_payouts
          WHERE created_at >= NOW() - INTERVAL '${sql.raw(daysBack.toString())} days'
        )
        SELECT
          AVG(rd.jackpot) as avg_jackpot,
          pd.avg_payout,
          COALESCE(pd.total_creator_rev, 0) as total_creator_rev,
          COALESCE(pd.total_seed, 0) as total_seed,
          CASE
            WHEN AVG(rd.jackpot) > 0 THEN
              ROUND(((COALESCE(pd.total_creator_rev, 0) + COALESCE(pd.total_seed, 0)) / AVG(rd.jackpot) * 100), 2)
            ELSE 0
          END as sustainability_score
        FROM round_data rd
        CROSS JOIN payout_data pd
      `);
    } catch (err) {
      console.error('[analytics/economy] Jackpot health query failed (round_payouts table may not exist):', err);
    }

    // Query 3: 7-day jackpot moving average
    try {
      console.log('[analytics/economy] Fetching 7-day jackpot average...');
      jackpot7Day = await db.execute<{
        avg_jackpot_7d: number;
      }>(sql`
        SELECT
          AVG(CAST(prize_pool_eth AS NUMERIC)) as avg_jackpot_7d
        FROM rounds
        WHERE started_at >= NOW() - INTERVAL '7 days'
          AND is_dev_test_round = false
          AND resolved_at IS NOT NULL
      `);
    } catch (err) {
      console.error('[analytics/economy] 7-day jackpot query failed:', err);
    }

    // Query 4: Daily jackpot trend
    try {
      console.log('[analytics/economy] Fetching jackpot trend...');
      jackpotTrend = await db.execute<{
        day: string;
        avg_jackpot: number;
        winners: number;
        total_payout: number;
      }>(sql`
        SELECT
          DATE(r.started_at) as day,
          AVG(CAST(r.prize_pool_eth AS NUMERIC)) as avg_jackpot,
          COUNT(DISTINCT r.winner_fid) as winners,
          COALESCE(SUM(CAST(rp.amount_eth AS NUMERIC)) FILTER (WHERE rp.role = 'winner'), 0) as total_payout
        FROM rounds r
        LEFT JOIN round_payouts rp ON rp.round_id = r.id
        WHERE r.started_at >= NOW() - INTERVAL '${sql.raw(daysBack.toString())} days'
          AND r.is_dev_test_round = false
          AND r.resolved_at IS NOT NULL
        GROUP BY DATE(r.started_at)
        ORDER BY day DESC
        LIMIT 30
      `);
    } catch (err) {
      console.error('[analytics/economy] Jackpot trend query failed:', err);
      jackpotTrend = [];
    }

    // Query 5: Daily pack sales trend
    try {
      console.log('[analytics/economy] Fetching pack sales trend...');
      packSalesTrend = await db.execute<{
        day: string;
        packs_sold: number;
        revenue_eth: number;
        buyers: number;
      }>(sql`
        SELECT
          DATE(created_at) as day,
          COUNT(*) as packs_sold,
          COALESCE(SUM(CAST(data->>'price_eth' AS NUMERIC)), 0) as revenue_eth,
          COUNT(DISTINCT user_id) as buyers
        FROM analytics_events
        WHERE event_type = 'guess_pack_purchased'
          AND created_at >= NOW() - INTERVAL '${sql.raw(daysBack.toString())} days'
        GROUP BY DATE(created_at)
        ORDER BY day DESC
        LIMIT 30
      `);
    } catch (err) {
      console.error('[analytics/economy] Pack sales trend query failed:', err);
      packSalesTrend = [];
    }

    const packData = Array.isArray(packMetrics) ? packMetrics[0] : packMetrics;
    const healthData = Array.isArray(jackpotHealth) ? jackpotHealth[0] : jackpotHealth;
    const jackpot7DData = Array.isArray(jackpot7Day) ? jackpot7Day[0] : jackpot7Day;
    const trendArray = Array.isArray(jackpotTrend) ? jackpotTrend : [];
    const salesArray = Array.isArray(packSalesTrend) ? packSalesTrend : [];

    const totalActiveUsers = Number(packData?.total_active_users) || 1;
    const packBuyers = Number(packData?.pack_buyers) || 0;
    const totalRevenue = Number(packData?.total_revenue) || 0;
    const daysInRange = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 365;

    const analytics: EconomyAnalytics = {
      packAttachRate: totalActiveUsers > 0 ? Number((packBuyers / totalActiveUsers * 100).toFixed(2)) : 0,
      avgPackRevenuePerActiveUser: totalActiveUsers > 0 ? Number((totalRevenue / totalActiveUsers).toFixed(6)) : 0,
      packPurchaseCount: Number(packData?.pack_purchases) || 0,
      packViewToPurchaseRate: Number(packData?.pack_views) > 0 ? Number((Number(packData?.pack_purchases) / Number(packData?.pack_views) * 100).toFixed(2)) : 0,
      prizePoolSustainabilityScore: Number(healthData?.sustainability_score) || 0,
      avgJackpot7Day: Number(jackpot7DData?.avg_jackpot_7d) || 0,
      avgPayoutPerWinner: Number(healthData?.avg_payout) || 0,
      arpdau: Number((totalRevenue / totalActiveUsers / daysInRange).toFixed(6)),
      arppu: packBuyers > 0 ? Number((totalRevenue / packBuyers).toFixed(6)) : 0,
      payingUserPercentage: totalActiveUsers > 0 ? Number((packBuyers / totalActiveUsers * 100).toFixed(2)) : 0,
      jackpotTrend: trendArray.map(t => ({
        day: t.day?.toString() || '',
        avg_jackpot: Number(t.avg_jackpot) || 0,
        winners: Number(t.winners) || 0,
        total_payout: Number(t.total_payout) || 0
      })),
      packSalesTrend: salesArray.map(s => ({
        day: s.day?.toString() || '',
        packs_sold: Number(s.packs_sold) || 0,
        revenue_eth: Number(s.revenue_eth) || 0,
        buyers: Number(s.buyers) || 0
      })),
      timeRange
    };

    console.log('[analytics/economy] Returning analytics:', JSON.stringify(analytics).substring(0, 300));
    return res.status(200).json(analytics);
  } catch (error) {
    console.error('[analytics/economy] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

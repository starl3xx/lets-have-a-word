/**
 * Dashboard Summary API
 * Milestone 8.0: Consolidated admin dashboard metrics
 *
 * Returns:
 * - Today's key metrics (DAU, packs, revenue)
 * - 7-day averages for comparison
 * - Current round status (phase, guesses, Top 10 lock)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../../src/db';
import { rounds, guesses } from '../../../../src/db/schema';
import { sql, eq, isNull, desc } from 'drizzle-orm';
import { isAdminFid } from '../me';
import {
  getPricingPhase,
  getPackPriceWei,
  weiToEthString,
  PRICE_RAMP_START_GUESSES,
} from '../../../../src/lib/pack-pricing';
import { cacheAside, CacheKeys, CacheTTL, trackSlowQuery } from '../../../../src/lib/redis';

export interface DashboardSummary {
  today: {
    dau: number;
    packPurchases: number;
    paidGuesses: number;
    revenueEth: number;
  };
  avg7d: {
    dau: number;
    packPurchases: number;
    paidGuesses: number;
    revenueEth: number;
  };
  currentRound: {
    roundId: number | null;
    prizePoolEth: string;
    totalGuesses: number;
    pricingPhase: 'BASE' | 'LATE_1' | 'LATE_2';
    pricingPhaseLabel: string;
    packPriceEth: string;
    top10Locked: boolean;
    guessesToLock: number;
    eligibleGuesses: number;
    ineligibleGuesses: number;
    startedAt: string | null;
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<DashboardSummary | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
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

    // Milestone 9.2: Cache dashboard summary (60s TTL)
    const cacheKey = CacheKeys.adminAnalytics('dashboard-summary');
    const summary = await cacheAside<DashboardSummary>(
      cacheKey,
      CacheTTL.adminAnalytics,
      () => trackSlowQuery('query:dashboard-summary', async () => {
        // Get current round
        const [activeRound] = await db
          .select({
            id: rounds.id,
            prizePoolEth: rounds.prizePoolEth,
            startedAt: rounds.startedAt,
          })
          .from(rounds)
          .where(isNull(rounds.resolvedAt))
          .orderBy(desc(rounds.startedAt))
          .limit(1);

        // Get total guesses in current round
        let totalGuessesInRound = 0;
        if (activeRound?.id) {
          const [result] = await db
            .select({ count: sql<number>`cast(count(*) as int)` })
            .from(guesses)
            .where(eq(guesses.roundId, activeRound.id));
          totalGuessesInRound = result?.count || 0;
        }

        // Calculate pricing phase and lock status
        const pricingPhase = getPricingPhase(totalGuessesInRound);
        const packPriceWei = getPackPriceWei(totalGuessesInRound);
        const top10Locked = totalGuessesInRound >= PRICE_RAMP_START_GUESSES;
        const guessesToLock = top10Locked ? 0 : PRICE_RAMP_START_GUESSES - totalGuessesInRound;
        const eligibleGuesses = Math.min(totalGuessesInRound, PRICE_RAMP_START_GUESSES);
        const ineligibleGuesses = Math.max(0, totalGuessesInRound - PRICE_RAMP_START_GUESSES);

        const phaseLabels: Record<string, string> = {
          'BASE': 'Early round',
          'LATE_1': 'Late round',
          'LATE_2': 'Late round (max)',
        };

        // Get today's metrics
        let todayMetrics = { dau: 0, packPurchases: 0, paidGuesses: 0, revenueEth: 0 };
        let avg7dMetrics = { dau: 0, packPurchases: 0, paidGuesses: 0, revenueEth: 0 };

        try {
          const [todayDau] = await db.execute<{ count: number }>(sql`
            SELECT COUNT(DISTINCT user_id)::int as count
            FROM analytics_events
            WHERE DATE(created_at) = CURRENT_DATE
              AND user_id IS NOT NULL
          `);

          const [todayPacks] = await db.execute<{ count: number; revenue: number }>(sql`
            SELECT
              COUNT(*)::int as count,
              COALESCE(SUM(CAST(data->>'expected_cost_eth' AS NUMERIC)), 0) as revenue
            FROM analytics_events
            WHERE event_type = 'guess_pack_purchased'
              AND DATE(created_at) = CURRENT_DATE
          `);

          const [todayPaidGuesses] = await db.execute<{ count: number }>(sql`
            SELECT COUNT(*)::int as count
            FROM analytics_events
            WHERE event_type = 'paid_guess_used'
              AND DATE(created_at) = CURRENT_DATE
          `);

          todayMetrics = {
            dau: Number(todayDau?.count) || 0,
            packPurchases: Number(todayPacks?.count) || 0,
            paidGuesses: Number(todayPaidGuesses?.count) || 0,
            revenueEth: Number(todayPacks?.revenue) || 0,
          };

          const [avg7dDau] = await db.execute<{ avg: number }>(sql`
            SELECT AVG(daily_count)::numeric as avg FROM (
              SELECT COUNT(DISTINCT user_id) as daily_count
              FROM analytics_events
              WHERE created_at >= NOW() - INTERVAL '7 days'
                AND user_id IS NOT NULL
              GROUP BY DATE(created_at)
            ) sub
          `);

          const [avg7dPacks] = await db.execute<{ avg_count: number; avg_revenue: number }>(sql`
            SELECT
              AVG(daily_count)::numeric as avg_count,
              AVG(daily_revenue)::numeric as avg_revenue
            FROM (
              SELECT
                COUNT(*) as daily_count,
                COALESCE(SUM(CAST(data->>'expected_cost_eth' AS NUMERIC)), 0) as daily_revenue
              FROM analytics_events
              WHERE event_type = 'guess_pack_purchased'
                AND created_at >= NOW() - INTERVAL '7 days'
              GROUP BY DATE(created_at)
            ) sub
          `);

          const [avg7dPaidGuesses] = await db.execute<{ avg: number }>(sql`
            SELECT AVG(daily_count)::numeric as avg FROM (
              SELECT COUNT(*) as daily_count
              FROM analytics_events
              WHERE event_type = 'paid_guess_used'
                AND created_at >= NOW() - INTERVAL '7 days'
              GROUP BY DATE(created_at)
            ) sub
          `);

          avg7dMetrics = {
            dau: Number(avg7dDau?.avg) || 0,
            packPurchases: Number(avg7dPacks?.avg_count) || 0,
            paidGuesses: Number(avg7dPaidGuesses?.avg) || 0,
            revenueEth: Number(avg7dPacks?.avg_revenue) || 0,
          };
        } catch (err) {
          console.error('[dashboard-summary] Error fetching metrics:', err);
        }

        return {
          today: todayMetrics,
          avg7d: avg7dMetrics,
          currentRound: {
            roundId: activeRound?.id || null,
            prizePoolEth: activeRound?.prizePoolEth || '0',
            totalGuesses: totalGuessesInRound,
            pricingPhase,
            pricingPhaseLabel: phaseLabels[pricingPhase] || pricingPhase,
            packPriceEth: weiToEthString(packPriceWei),
            top10Locked,
            guessesToLock,
            eligibleGuesses,
            ineligibleGuesses,
            startedAt: activeRound?.startedAt?.toISOString() || null,
          },
        };
      })
    );

    return res.status(200).json(summary);
  } catch (error) {
    console.error('[dashboard-summary] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

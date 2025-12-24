/**
 * Pack Pricing Analytics API
 * Milestone 8.0: Track pack purchases by pricing phase
 *
 * Returns:
 * - Current pack price and phase
 * - Purchases breakdown by phase (Early vs Late vs Capped)
 * - Revenue by phase
 * - Early-round reinforcement impressions
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
import { cacheAside, CacheKeys, CacheTTL } from '../../../../src/lib/redis';

export interface PackPricingAnalytics {
  // Current state
  currentPhase: 'BASE' | 'LATE_1' | 'LATE_2';
  currentPhaseLabel: string;
  currentPackPriceEth: string;
  totalGuessesInRound: number;

  // Purchases by phase (last 24h)
  last24h: {
    base: { count: number; revenueEth: number; buyers: number };
    late1: { count: number; revenueEth: number; buyers: number };
    late2: { count: number; revenueEth: number; buyers: number };
    total: { count: number; revenueEth: number; buyers: number };
  };

  // Purchases by phase (last 7d)
  last7d: {
    base: { count: number; revenueEth: number; buyers: number };
    late1: { count: number; revenueEth: number; buyers: number };
    late2: { count: number; revenueEth: number; buyers: number };
    total: { count: number; revenueEth: number; buyers: number };
  };

  // Phase distribution percentages
  phaseDistribution24h: {
    base: number;
    late1: number;
    late2: number;
  };

  phaseDistribution7d: {
    base: number;
    late1: number;
    late2: number;
  };

  // Early-round reinforcement
  earlyRoundReinforcementCount: number;
  avgPacksPerEarlyBuyer: number;

  timeRange: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PackPricingAnalytics | { error: string }>
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

    // Get current round and guess count
    const [activeRound] = await db
      .select({ id: rounds.id })
      .from(rounds)
      .where(isNull(rounds.resolvedAt))
      .orderBy(desc(rounds.startedAt))
      .limit(1);

    let totalGuessesInRound = 0;
    if (activeRound?.id) {
      const [result] = await db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(guesses)
        .where(eq(guesses.roundId, activeRound.id));
      totalGuessesInRound = result?.count || 0;
    }

    const currentPhase = getPricingPhase(totalGuessesInRound);
    const currentPackPriceWei = getPackPriceWei(totalGuessesInRound);

    const phaseLabels: Record<string, string> = {
      'BASE': 'Early round',
      'LATE_1': 'Late round',
      'LATE_2': 'Late round (max)',
    };

    // Query purchases by phase - last 24h
    let last24h = {
      base: { count: 0, revenueEth: 0, buyers: 0 },
      late1: { count: 0, revenueEth: 0, buyers: 0 },
      late2: { count: 0, revenueEth: 0, buyers: 0 },
      total: { count: 0, revenueEth: 0, buyers: 0 },
    };

    let last7d = {
      base: { count: 0, revenueEth: 0, buyers: 0 },
      late1: { count: 0, revenueEth: 0, buyers: 0 },
      late2: { count: 0, revenueEth: 0, buyers: 0 },
      total: { count: 0, revenueEth: 0, buyers: 0 },
    };

    try {
      // Last 24h by phase
      const purchases24h = await db.execute<{
        phase: string;
        count: number;
        revenue: number;
        buyers: number;
      }>(sql`
        SELECT
          COALESCE(data->>'pricing_phase', 'BASE') as phase,
          COUNT(*)::int as count,
          COALESCE(SUM(CAST(data->>'expected_cost_eth' AS NUMERIC)), 0) as revenue,
          COUNT(DISTINCT user_id)::int as buyers
        FROM analytics_events
        WHERE event_type = 'guess_pack_purchased'
          AND created_at >= NOW() - INTERVAL '24 hours'
        GROUP BY COALESCE(data->>'pricing_phase', 'BASE')
      `);

      for (const row of purchases24h || []) {
        const phase = row.phase || 'BASE';
        const data = { count: Number(row.count), revenueEth: Number(row.revenue), buyers: Number(row.buyers) };
        if (phase === 'BASE') last24h.base = data;
        else if (phase === 'LATE_1') last24h.late1 = data;
        else if (phase === 'LATE_2') last24h.late2 = data;
        last24h.total.count += data.count;
        last24h.total.revenueEth += data.revenueEth;
      }

      // Get unique buyers for 24h total
      const [totalBuyers24h] = await db.execute<{ buyers: number }>(sql`
        SELECT COUNT(DISTINCT user_id)::int as buyers
        FROM analytics_events
        WHERE event_type = 'guess_pack_purchased'
          AND created_at >= NOW() - INTERVAL '24 hours'
      `);
      last24h.total.buyers = Number(totalBuyers24h?.buyers) || 0;

      // Last 7d by phase
      const purchases7d = await db.execute<{
        phase: string;
        count: number;
        revenue: number;
        buyers: number;
      }>(sql`
        SELECT
          COALESCE(data->>'pricing_phase', 'BASE') as phase,
          COUNT(*)::int as count,
          COALESCE(SUM(CAST(data->>'expected_cost_eth' AS NUMERIC)), 0) as revenue,
          COUNT(DISTINCT user_id)::int as buyers
        FROM analytics_events
        WHERE event_type = 'guess_pack_purchased'
          AND created_at >= NOW() - INTERVAL '7 days'
        GROUP BY COALESCE(data->>'pricing_phase', 'BASE')
      `);

      for (const row of purchases7d || []) {
        const phase = row.phase || 'BASE';
        const data = { count: Number(row.count), revenueEth: Number(row.revenue), buyers: Number(row.buyers) };
        if (phase === 'BASE') last7d.base = data;
        else if (phase === 'LATE_1') last7d.late1 = data;
        else if (phase === 'LATE_2') last7d.late2 = data;
        last7d.total.count += data.count;
        last7d.total.revenueEth += data.revenueEth;
      }

      // Get unique buyers for 7d total
      const [totalBuyers7d] = await db.execute<{ buyers: number }>(sql`
        SELECT COUNT(DISTINCT user_id)::int as buyers
        FROM analytics_events
        WHERE event_type = 'guess_pack_purchased'
          AND created_at >= NOW() - INTERVAL '7 days'
      `);
      last7d.total.buyers = Number(totalBuyers7d?.buyers) || 0;

    } catch (err) {
      console.error('[pack-pricing] Error fetching purchase data:', err);
    }

    // Calculate phase distributions
    const total24h = last24h.total.count || 1;
    const total7d = last7d.total.count || 1;

    const phaseDistribution24h = {
      base: (last24h.base.count / total24h) * 100,
      late1: (last24h.late1.count / total24h) * 100,
      late2: (last24h.late2.count / total24h) * 100,
    };

    const phaseDistribution7d = {
      base: (last7d.base.count / total7d) * 100,
      late1: (last7d.late1.count / total7d) * 100,
      late2: (last7d.late2.count / total7d) * 100,
    };

    // Early-round reinforcement count
    let earlyRoundReinforcementCount = 0;
    let avgPacksPerEarlyBuyer = 0;

    try {
      const [reinforcement] = await db.execute<{ count: number }>(sql`
        SELECT COUNT(*)::int as count
        FROM analytics_events
        WHERE event_type = 'early_round_pricing_reinforcement'
          AND created_at >= NOW() - INTERVAL '7 days'
      `);
      earlyRoundReinforcementCount = Number(reinforcement?.count) || 0;

      // Calculate avg packs per early buyer
      if (last7d.base.buyers > 0) {
        avgPacksPerEarlyBuyer = last7d.base.count / last7d.base.buyers;
      }
    } catch (err) {
      console.error('[pack-pricing] Error fetching reinforcement data:', err);
    }

    const analytics: PackPricingAnalytics = {
      currentPhase,
      currentPhaseLabel: phaseLabels[currentPhase],
      currentPackPriceEth: weiToEthString(currentPackPriceWei),
      totalGuessesInRound,
      last24h,
      last7d,
      phaseDistribution24h,
      phaseDistribution7d,
      earlyRoundReinforcementCount,
      avgPacksPerEarlyBuyer,
      timeRange: '7d',
    };

    return res.status(200).json(analytics);
  } catch (error) {
    console.error('[pack-pricing] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

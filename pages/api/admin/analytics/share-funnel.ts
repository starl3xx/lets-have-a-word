/**
 * Share & Referral Funnel Analytics API
 * Analytics v2: Share conversion, referral velocity, viral metrics
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../../src/db';
import { sql } from 'drizzle-orm';
import { isAdminFid } from '../me';
import { cacheAside, CacheKeys, CacheTTL, trackSlowQuery } from '../../../../src/lib/redis';

export interface ShareFunnelAnalytics {
  // Share funnel metrics
  sharePromptsShown: number;
  shareClicks: number;
  shareSuccesses: number;
  promptToClickRate: number;
  clickToSuccessRate: number;
  overallConversionRate: number;

  // Referral metrics
  totalReferralShares: number;
  referralJoins: number;
  referralGuesses: number;
  shareToJoinRate: number;
  joinToGuessRate: number;
  avgGuessesUnlockedViaShare: number;

  // Daily trends
  shareFunnelDaily: Array<{
    day: string;
    prompts_shown: number;
    clicks: number;
    successes: number;
    conversion_rate: number;
  }>;

  referralVelocityDaily: Array<{
    day: string;
    shares: number;
    joins: number;
    guesses: number;
  }>;

  // Channel breakdown
  sharesByChannel: Array<{
    channel: string;
    clicks: number;
    successes: number;
  }>;

  timeRange: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ShareFunnelAnalytics | { error: string }>
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

    // Query 1: Share funnel metrics
    const shareFunnel = await db.execute<{
      prompts_shown: number;
      clicks: number;
      successes: number;
    }>(sql`
      SELECT
        COUNT(*) FILTER (WHERE event_type = 'share_prompt_shown') as prompts_shown,
        COUNT(*) FILTER (WHERE event_type = 'share_clicked') as clicks,
        COUNT(*) FILTER (WHERE event_type = 'share_success') as successes
      FROM analytics_events
      WHERE created_at >= NOW() - INTERVAL '${sql.raw(daysBack.toString())} days'
        AND event_type IN ('share_prompt_shown', 'share_clicked', 'share_success')
    `);

    // Query 2: Referral metrics
    const referralMetrics = await db.execute<{
      total_shares: number;
      joins: number;
      guesses: number;
      avg_guesses_unlocked: number;
    }>(sql`
      SELECT
        COUNT(*) FILTER (WHERE event_type = 'referral_share') as total_shares,
        COUNT(*) FILTER (WHERE event_type = 'referral_join') as joins,
        COUNT(*) FILTER (WHERE event_type = 'referral_guess') as guesses,
        AVG(CAST(data->>'guesses_unlocked' AS INTEGER)) FILTER (WHERE event_type = 'share_bonus_unlocked') as avg_guesses_unlocked
      FROM analytics_events
      WHERE created_at >= NOW() - INTERVAL '${sql.raw(daysBack.toString())} days'
        AND event_type IN ('referral_share', 'referral_join', 'referral_guess', 'share_bonus_unlocked')
    `);

    // Query 3: Daily share funnel trend
    const dailyFunnel = await db.execute<{
      day: string;
      prompts_shown: number;
      clicks: number;
      successes: number;
    }>(sql`
      SELECT
        DATE(created_at) as day,
        COUNT(*) FILTER (WHERE event_type = 'share_prompt_shown') as prompts_shown,
        COUNT(*) FILTER (WHERE event_type = 'share_clicked') as clicks,
        COUNT(*) FILTER (WHERE event_type = 'share_success') as successes
      FROM analytics_events
      WHERE created_at >= NOW() - INTERVAL '${sql.raw(daysBack.toString())} days'
        AND event_type IN ('share_prompt_shown', 'share_clicked', 'share_success')
      GROUP BY DATE(created_at)
      ORDER BY day DESC
      LIMIT 30
    `);

    // Query 4: Daily referral velocity
    const dailyReferrals = await db.execute<{
      day: string;
      shares: number;
      joins: number;
      guesses: number;
    }>(sql`
      SELECT
        DATE(created_at) as day,
        COUNT(*) FILTER (WHERE event_type = 'referral_share') as shares,
        COUNT(*) FILTER (WHERE event_type = 'referral_join') as joins,
        COUNT(*) FILTER (WHERE event_type = 'referral_guess') as guesses
      FROM analytics_events
      WHERE created_at >= NOW() - INTERVAL '${sql.raw(daysBack.toString())} days'
        AND event_type IN ('referral_share', 'referral_join', 'referral_guess')
      GROUP BY DATE(created_at)
      ORDER BY day DESC
      LIMIT 30
    `);

    // Query 5: Share channel breakdown
    const channelBreakdown = await db.execute<{
      channel: string;
      clicks: number;
      successes: number;
    }>(sql`
      SELECT
        COALESCE(data->>'channel', 'unknown') as channel,
        COUNT(*) FILTER (WHERE event_type = 'share_clicked') as clicks,
        COUNT(*) FILTER (WHERE event_type = 'share_success') as successes
      FROM analytics_events
      WHERE created_at >= NOW() - INTERVAL '${sql.raw(daysBack.toString())} days'
        AND event_type IN ('share_clicked', 'share_success')
      GROUP BY data->>'channel'
      ORDER BY clicks DESC
    `);

    const funnelData = Array.isArray(shareFunnel) ? shareFunnel[0] : shareFunnel;
    const refData = Array.isArray(referralMetrics) ? referralMetrics[0] : referralMetrics;
    const dailyFunnelArray = Array.isArray(dailyFunnel) ? dailyFunnel : [];
    const dailyRefArray = Array.isArray(dailyReferrals) ? dailyReferrals : [];
    const channelArray = Array.isArray(channelBreakdown) ? channelBreakdown : [];

    const promptsShown = Number(funnelData?.prompts_shown) || 0;
    const clicks = Number(funnelData?.clicks) || 0;
    const successes = Number(funnelData?.successes) || 0;
    const totalShares = Number(refData?.total_shares) || 0;
    const joins = Number(refData?.joins) || 0;
    const guesses = Number(refData?.guesses) || 0;

    const analytics: ShareFunnelAnalytics = {
      sharePromptsShown: promptsShown,
      shareClicks: clicks,
      shareSuccesses: successes,
      promptToClickRate: promptsShown > 0 ? Number((clicks / promptsShown * 100).toFixed(2)) : 0,
      clickToSuccessRate: clicks > 0 ? Number((successes / clicks * 100).toFixed(2)) : 0,
      overallConversionRate: promptsShown > 0 ? Number((successes / promptsShown * 100).toFixed(2)) : 0,
      totalReferralShares: totalShares,
      referralJoins: joins,
      referralGuesses: guesses,
      shareToJoinRate: totalShares > 0 ? Number((joins / totalShares * 100).toFixed(2)) : 0,
      joinToGuessRate: joins > 0 ? Number((guesses / joins * 100).toFixed(2)) : 0,
      avgGuessesUnlockedViaShare: Number(refData?.avg_guesses_unlocked) || 0,
      shareFunnelDaily: dailyFunnelArray.map(d => {
        const dayPrompts = Number(d.prompts_shown) || 0;
        const daySuccesses = Number(d.successes) || 0;
        return {
          day: d.day?.toString() || '',
          prompts_shown: dayPrompts,
          clicks: Number(d.clicks) || 0,
          successes: daySuccesses,
          conversion_rate: dayPrompts > 0 ? Number((daySuccesses / dayPrompts * 100).toFixed(2)) : 0
        };
      }),
      referralVelocityDaily: dailyRefArray.map(d => ({
        day: d.day?.toString() || '',
        shares: Number(d.shares) || 0,
        joins: Number(d.joins) || 0,
        guesses: Number(d.guesses) || 0
      })),
      sharesByChannel: channelArray.map(c => ({
        channel: c.channel || 'unknown',
        clicks: Number(c.clicks) || 0,
        successes: Number(c.successes) || 0
      })),
      timeRange
    };

    console.log('[analytics/share-funnel] Returning analytics:', JSON.stringify(analytics).substring(0, 300));
    return res.status(200).json(analytics);
  } catch (error) {
    console.error('[analytics/share-funnel] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

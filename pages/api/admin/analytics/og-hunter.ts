/**
 * OG Hunter Splash Analytics API
 * Tracks engagement metrics from the OG Hunter splash page
 *
 * Metrics:
 * - Splash page views
 * - Add app clicks / completions
 * - Cast intent clicks / verified casts
 * - Badge claims
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../../src/db';
import { sql } from 'drizzle-orm';
import { isAdminFid } from '../me';

export interface OgHunterAnalytics {
  // Raw counts from database (actual completions)
  usersAddedApp: number;
  usersWithVerifiedCast: number;
  badgesAwarded: number;

  // Click events from analytics (intent/engagement)
  splashViews: number;
  addAppClicks: number;
  castIntentClicks: number;

  // Conversion rates
  addAppConversionRate: number; // addedApp / splashViews
  castConversionRate: number; // verifiedCast / splashViews
  claimEligibilityRate: number; // both completed / splashViews

  timeRange: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<OgHunterAnalytics | { error: string }>
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

    const timeRange = req.query.range as string || 'all';
    const daysBack = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 9999;

    // Query actual completions from database tables
    const [dbCounts] = await db.execute<{
      users_added_app: number;
      users_with_cast: number;
      badges_awarded: number;
    }>(sql`
      SELECT
        (SELECT COUNT(*)::int FROM users WHERE added_mini_app_at IS NOT NULL) as users_added_app,
        (SELECT COUNT(*)::int FROM og_hunter_cast_proofs) as users_with_cast,
        (SELECT COUNT(*)::int FROM user_badges WHERE badge_type = 'OG_HUNTER') as badges_awarded
    `);

    // Query click events from analytics (for funnel analysis)
    const [eventCounts] = await db.execute<{
      splash_views: number;
      add_app_clicks: number;
      cast_intent_clicks: number;
    }>(sql`
      SELECT
        COUNT(*) FILTER (WHERE event_type = 'splash_view')::int as splash_views,
        COUNT(*) FILTER (WHERE event_type = 'og_hunter_add_miniapp_click')::int as add_app_clicks,
        COUNT(*) FILTER (WHERE event_type = 'og_hunter_cast_intent_click')::int as cast_intent_clicks
      FROM analytics_events
      WHERE created_at >= NOW() - INTERVAL '${sql.raw(daysBack.toString())} days'
        AND event_type IN ('splash_view', 'og_hunter_add_miniapp_click', 'og_hunter_cast_intent_click')
    `);

    const usersAddedApp = Number(dbCounts?.users_added_app) || 0;
    const usersWithVerifiedCast = Number(dbCounts?.users_with_cast) || 0;
    const badgesAwarded = Number(dbCounts?.badges_awarded) || 0;

    const splashViews = Number(eventCounts?.splash_views) || 0;
    const addAppClicks = Number(eventCounts?.add_app_clicks) || 0;
    const castIntentClicks = Number(eventCounts?.cast_intent_clicks) || 0;

    // Calculate conversion rates
    const addAppConversionRate = splashViews > 0
      ? (usersAddedApp / splashViews) * 100
      : 0;

    const castConversionRate = splashViews > 0
      ? (usersWithVerifiedCast / splashViews) * 100
      : 0;

    const claimEligibilityRate = splashViews > 0
      ? (badgesAwarded / splashViews) * 100
      : 0;

    const analytics: OgHunterAnalytics = {
      usersAddedApp,
      usersWithVerifiedCast,
      badgesAwarded,
      splashViews,
      addAppClicks,
      castIntentClicks,
      addAppConversionRate,
      castConversionRate,
      claimEligibilityRate,
      timeRange,
    };

    return res.status(200).json(analytics);
  } catch (error) {
    console.error('[og-hunter] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

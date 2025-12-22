/**
 * Onboarding Funnel Analytics API
 * Milestone 8.0: Track onboarding flow completion rates
 *
 * Uses events:
 * - onboarding_how_it_works_viewed
 * - onboarding_how_it_works_completed
 * - onboarding_add_app_viewed
 * - onboarding_add_app_accepted
 * - onboarding_add_app_skipped
 * - onboarding_flow_completed
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../../src/db';
import { sql } from 'drizzle-orm';
import { isAdminFid } from '../me';

export interface OnboardingAnalytics {
  // Step counts
  howItWorksViewed: number;
  howItWorksCompleted: number;
  addAppViewed: number;
  addAppAccepted: number;
  addAppSkipped: number;
  flowCompleted: number;

  // Conversion rates
  tutorialCompletionRate: number;
  addAppAcceptRate: number;
  addAppSkipRate: number;
  overallCompletionRate: number;

  // Dropoff analysis
  tutorialDropoff: number;
  addAppDropoff: number;

  timeRange: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<OnboardingAnalytics | { error: string }>
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

    const timeRange = req.query.range as string || '7d';
    const daysBack = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 9999;

    // Query onboarding event counts
    const [counts] = await db.execute<{
      how_it_works_viewed: number;
      how_it_works_completed: number;
      add_app_viewed: number;
      add_app_accepted: number;
      add_app_skipped: number;
      flow_completed: number;
    }>(sql`
      SELECT
        COUNT(*) FILTER (WHERE event_type = 'onboarding_how_it_works_viewed')::int as how_it_works_viewed,
        COUNT(*) FILTER (WHERE event_type = 'onboarding_how_it_works_completed')::int as how_it_works_completed,
        COUNT(*) FILTER (WHERE event_type = 'onboarding_add_app_viewed')::int as add_app_viewed,
        COUNT(*) FILTER (WHERE event_type = 'onboarding_add_app_accepted')::int as add_app_accepted,
        COUNT(*) FILTER (WHERE event_type = 'onboarding_add_app_skipped')::int as add_app_skipped,
        COUNT(*) FILTER (WHERE event_type = 'onboarding_flow_completed')::int as flow_completed
      FROM analytics_events
      WHERE created_at >= NOW() - INTERVAL '${sql.raw(daysBack.toString())} days'
        AND event_type LIKE 'onboarding_%'
    `);

    const howItWorksViewed = Number(counts?.how_it_works_viewed) || 0;
    const howItWorksCompleted = Number(counts?.how_it_works_completed) || 0;
    const addAppViewed = Number(counts?.add_app_viewed) || 0;
    const addAppAccepted = Number(counts?.add_app_accepted) || 0;
    const addAppSkipped = Number(counts?.add_app_skipped) || 0;
    const flowCompleted = Number(counts?.flow_completed) || 0;

    // Calculate rates
    const tutorialCompletionRate = howItWorksViewed > 0
      ? (howItWorksCompleted / howItWorksViewed) * 100
      : 0;

    const addAppAcceptRate = addAppViewed > 0
      ? (addAppAccepted / addAppViewed) * 100
      : 0;

    const addAppSkipRate = addAppViewed > 0
      ? (addAppSkipped / addAppViewed) * 100
      : 0;

    const overallCompletionRate = howItWorksViewed > 0
      ? (flowCompleted / howItWorksViewed) * 100
      : 0;

    // Calculate dropoff
    const tutorialDropoff = howItWorksViewed - howItWorksCompleted;
    const addAppDropoff = addAppViewed - (addAppAccepted + addAppSkipped);

    const analytics: OnboardingAnalytics = {
      howItWorksViewed,
      howItWorksCompleted,
      addAppViewed,
      addAppAccepted,
      addAppSkipped,
      flowCompleted,
      tutorialCompletionRate,
      addAppAcceptRate,
      addAppSkipRate,
      overallCompletionRate,
      tutorialDropoff,
      addAppDropoff,
      timeRange,
    };

    return res.status(200).json(analytics);
  } catch (error) {
    console.error('[onboarding] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

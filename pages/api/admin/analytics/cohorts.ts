/**
 * Cohort Analytics API
 * Returns weekly cohort retention data for heatmap visualization
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../../src/db';
import { sql } from 'drizzle-orm';
import { isAdminFid } from '../me';

export interface CohortData {
  cohort_week: string; // Week user first played (YYYY-MM-DD)
  cohort_size: number; // Number of users in this cohort
  retention: Array<{
    weeks_after: number; // 0 = same week, 1 = week after, etc.
    active_users: number;
    retention_rate: number; // % still active
  }>;
}

export interface CohortAnalytics {
  cohorts: CohortData[];
  totalCohorts: number;
  oldestCohort: string;
  newestCohort: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CohortAnalytics | { error: string }>
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

    // Limit to last 8 weeks for manageable data
    const weeksToShow = 8;

    // Query: Get cohort retention data
    // This query:
    // 1. Assigns each user to their first activity week (cohort)
    // 2. For each cohort, counts how many users were active in subsequent weeks
    const cohortResult = await db.execute<{
      cohort_week: string;
      cohort_size: number;
      weeks_after: number;
      active_users: number;
    }>(sql`
      WITH user_first_week AS (
        SELECT
          user_fid,
          DATE_TRUNC('week', MIN(created_at))::date as cohort_week
        FROM guesses
        WHERE created_at >= NOW() - INTERVAL '${sql.raw(weeksToShow.toString())} weeks'
        GROUP BY user_fid
      ),
      user_activity_weeks AS (
        SELECT DISTINCT
          user_fid,
          DATE_TRUNC('week', created_at)::date as activity_week
        FROM guesses
        WHERE created_at >= NOW() - INTERVAL '${sql.raw(weeksToShow.toString())} weeks'
      ),
      cohort_retention AS (
        SELECT
          ufw.cohort_week,
          COUNT(DISTINCT ufw.user_fid) as cohort_size,
          EXTRACT(EPOCH FROM (uaw.activity_week - ufw.cohort_week)) / (7 * 24 * 60 * 60) as weeks_after,
          COUNT(DISTINCT uaw.user_fid) as active_users
        FROM user_first_week ufw
        LEFT JOIN user_activity_weeks uaw ON ufw.user_fid = uaw.user_fid
        WHERE uaw.activity_week >= ufw.cohort_week
        GROUP BY ufw.cohort_week, weeks_after
        ORDER BY ufw.cohort_week, weeks_after
      )
      SELECT
        cohort_week::text,
        cohort_size,
        weeks_after::int,
        active_users
      FROM cohort_retention
      WHERE weeks_after >= 0 AND weeks_after < ${weeksToShow}
      ORDER BY cohort_week DESC, weeks_after ASC
    `);

    const rawData = Array.isArray(cohortResult) ? cohortResult : [];

    // Group by cohort week
    const cohortMap = new Map<string, CohortData>();

    for (const row of rawData) {
      const cohortWeek = row.cohort_week?.toString() || '';
      const cohortSize = Number(row.cohort_size) || 0;
      const weeksAfter = Number(row.weeks_after) || 0;
      const activeUsers = Number(row.active_users) || 0;

      if (!cohortMap.has(cohortWeek)) {
        cohortMap.set(cohortWeek, {
          cohort_week: cohortWeek,
          cohort_size: cohortSize,
          retention: [],
        });
      }

      const cohort = cohortMap.get(cohortWeek)!;
      cohort.retention.push({
        weeks_after: weeksAfter,
        active_users: activeUsers,
        retention_rate: cohortSize > 0 ? Number(((activeUsers / cohortSize) * 100).toFixed(1)) : 0,
      });
    }

    // Convert to array and sort by cohort week descending
    const cohorts = Array.from(cohortMap.values()).sort((a, b) =>
      b.cohort_week.localeCompare(a.cohort_week)
    );

    const analytics: CohortAnalytics = {
      cohorts,
      totalCohorts: cohorts.length,
      oldestCohort: cohorts.length > 0 ? cohorts[cohorts.length - 1].cohort_week : '',
      newestCohort: cohorts.length > 0 ? cohorts[0].cohort_week : '',
    };

    console.log('[analytics/cohorts] Returning cohorts:', cohorts.length);
    return res.status(200).json(analytics);
  } catch (error) {
    console.error('[analytics/cohorts] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

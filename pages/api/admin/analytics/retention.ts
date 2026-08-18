/**
 * Retention Analytics API
 * Returns user retention metrics including return rate and churn indicators
 *
 * Every calendar day here is a US Central day — see src/lib/reporting-time.ts for
 * why a naive UTC column needs two conversions and a timestamptz one needs one.
 * WAU, MAU and the churn thresholds are deliberately left as rolling windows.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../../src/db';
import { sql } from 'drizzle-orm';
import { isAdminFid } from '../me';
import { centralDay, centralDaysAgo, centralDayStart } from '../../../../src/lib/reporting-time';

export interface RetentionAnalytics {
  // Day-over-day return rate
  returnRate: number; // % of yesterday's users who returned today
  yesterdayUsers: number;
  returningUsers: number;

  // Weekly metrics
  wau: number;
  mau: number;
  stickiness: number; // DAU/WAU ratio

  // Churn indicators
  churnedUsers7d: number; // Users who haven't played in 7+ days
  churnedUsers30d: number; // Users who haven't played in 30+ days
  totalUsers: number;
  churnRate7d: number; // % of users who churned in last 7 days

  // Power users
  powerUsers: number; // Users with 10+ rounds played
  powerUserPercentage: number;

  // Daily retention trend
  dailyRetention: Array<{
    day: string;
    returning_users: number;
    previous_day_users: number;
    return_rate: number;
  }>;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<RetentionAnalytics | { error: string }>
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

    // "Today" and "yesterday" are Central calendar days. guesses.created_at is a
    // NAIVE column holding UTC, so each boundary is built as a Central date, then
    // localized to an instant and flattened back to naive UTC to match the column.
    // Reused verbatim by the DAU query below so the two cannot disagree.
    const centralTodayStart = centralDayStart(0);
    const centralYesterdayStart = centralDayStart(1);

    // Query 1: Day-over-day return rate
    const returnRateResult = await db.execute<{
      yesterday_users: number;
      returning_users: number;
    }>(sql`
      WITH yesterday_users AS (
        SELECT DISTINCT fid
        FROM guesses
        WHERE created_at >= ${centralYesterdayStart}
          AND created_at < ${centralTodayStart}
      ),
      today_users AS (
        SELECT DISTINCT fid
        FROM guesses
        WHERE created_at >= ${centralTodayStart}
      )
      SELECT
        (SELECT COUNT(*) FROM yesterday_users) as yesterday_users,
        (SELECT COUNT(*) FROM yesterday_users WHERE fid IN (SELECT fid FROM today_users)) as returning_users
    `);

    // Query 2: WAU and MAU
    // Genuine rolling windows (168h / 720h), not calendar buckets, so they stay
    // rolling. NOW() is flattened to naive UTC because created_at is naive: the
    // bare comparison would be resolved with the session TimeZone, which nothing
    // in this app pins.
    const wauMauResult = await db.execute<{
      wau: number;
      mau: number;
    }>(sql`
      SELECT
        (SELECT COUNT(DISTINCT fid) FROM guesses WHERE created_at >= (NOW() AT TIME ZONE 'UTC') - INTERVAL '7 days') as wau,
        (SELECT COUNT(DISTINCT fid) FROM guesses WHERE created_at >= (NOW() AT TIME ZONE 'UTC') - INTERVAL '30 days') as mau
    `);

    // Query 3: Churn indicators
    // last_active is MAX() of a naive column, so it is naive UTC too — same
    // flattened NOW() as above. Churn thresholds are rolling by design.
    const churnResult = await db.execute<{
      churned_7d: number;
      churned_30d: number;
      total_users: number;
    }>(sql`
      WITH user_last_activity AS (
        SELECT fid, MAX(created_at) as last_active
        FROM guesses
        GROUP BY fid
      )
      SELECT
        COUNT(*) FILTER (WHERE last_active < (NOW() AT TIME ZONE 'UTC') - INTERVAL '7 days' AND last_active >= (NOW() AT TIME ZONE 'UTC') - INTERVAL '14 days') as churned_7d,
        COUNT(*) FILTER (WHERE last_active < (NOW() AT TIME ZONE 'UTC') - INTERVAL '30 days') as churned_30d,
        COUNT(*) as total_users
      FROM user_last_activity
    `);

    // Query 4: Power users (10+ rounds played)
    const powerUserResult = await db.execute<{
      power_users: number;
    }>(sql`
      SELECT COUNT(*) as power_users
      FROM (
        SELECT fid, COUNT(DISTINCT round_id) as rounds_played
        FROM guesses
        GROUP BY fid
        HAVING COUNT(DISTINCT round_id) >= 10
      ) as power_users
    `);

    // Query 5: Daily retention trend (last 14 days)
    // Buckets are Central calendar days, so the window snaps to Central midnight
    // 15 days back instead of a rolling 360 hours — otherwise the oldest bucket is
    // a partial day whose size depends on when the page was loaded. GROUP BY uses
    // the output alias because centralDay() emits a bind parameter for the zone,
    // and two copies of it would not match as one grouping expression.
    const dailyRetentionResult = await db.execute<{
      day: string;
      returning_users: number;
      previous_day_users: number;
    }>(sql`
      WITH daily_users AS (
        SELECT
          ${centralDay('created_at')} as day,
          ARRAY_AGG(DISTINCT fid) as user_fids
        FROM guesses
        WHERE created_at >= ${centralDayStart(15)}
        GROUP BY day
      ),
      retention_calc AS (
        SELECT
          d1.day,
          CARDINALITY(d1.user_fids) as day_users,
          CARDINALITY(d0.user_fids) as previous_day_users,
          CARDINALITY(
            ARRAY(SELECT UNNEST(d1.user_fids) INTERSECT SELECT UNNEST(d0.user_fids))
          ) as returning_users
        FROM daily_users d1
        LEFT JOIN daily_users d0 ON d0.day = d1.day - INTERVAL '1 day'
        WHERE d1.day >= ${centralDaysAgo(14)}
      )
      SELECT
        day::text,
        returning_users,
        previous_day_users
      FROM retention_calc
      WHERE previous_day_users > 0
      ORDER BY day DESC
      LIMIT 14
    `);

    // Parse results
    const returnData = Array.isArray(returnRateResult) ? returnRateResult[0] : returnRateResult;
    const wauMauData = Array.isArray(wauMauResult) ? wauMauResult[0] : wauMauResult;
    const churnData = Array.isArray(churnResult) ? churnResult[0] : churnResult;
    const powerData = Array.isArray(powerUserResult) ? powerUserResult[0] : powerUserResult;
    const dailyData = Array.isArray(dailyRetentionResult) ? dailyRetentionResult : [];

    const yesterdayUsers = Number(returnData?.yesterday_users) || 0;
    const returningUsers = Number(returnData?.returning_users) || 0;
    const wau = Number(wauMauData?.wau) || 0;
    const mau = Number(wauMauData?.mau) || 0;
    const churnedUsers7d = Number(churnData?.churned_7d) || 0;
    const churnedUsers30d = Number(churnData?.churned_30d) || 0;
    const totalUsers = Number(churnData?.total_users) || 0;
    const powerUsers = Number(powerData?.power_users) || 0;

    // Get today's DAU for stickiness calculation. Same Central "today" boundary as
    // the today_users CTE in Query 1, or the two would disagree on when today began.
    const dauResult = await db.execute<{ dau: number }>(sql`
      SELECT COUNT(DISTINCT fid) as dau
      FROM guesses
      WHERE created_at >= ${centralTodayStart}
    `);
    const dauData = Array.isArray(dauResult) ? dauResult[0] : dauResult;
    const dau = Number(dauData?.dau) || 0;

    const analytics: RetentionAnalytics = {
      returnRate: yesterdayUsers > 0 ? Number(((returningUsers / yesterdayUsers) * 100).toFixed(1)) : 0,
      yesterdayUsers,
      returningUsers,
      wau,
      mau,
      stickiness: wau > 0 ? Number(((dau / wau) * 100).toFixed(1)) : 0,
      churnedUsers7d,
      churnedUsers30d,
      totalUsers,
      churnRate7d: totalUsers > 0 ? Number(((churnedUsers7d / totalUsers) * 100).toFixed(1)) : 0,
      powerUsers,
      powerUserPercentage: totalUsers > 0 ? Number(((powerUsers / totalUsers) * 100).toFixed(1)) : 0,
      dailyRetention: dailyData.map(d => ({
        day: d.day?.toString() || '',
        returning_users: Number(d.returning_users) || 0,
        previous_day_users: Number(d.previous_day_users) || 0,
        return_rate: Number(d.previous_day_users) > 0
          ? Number(((Number(d.returning_users) / Number(d.previous_day_users)) * 100).toFixed(1))
          : 0,
      })),
    };

    console.log('[analytics/retention] Returning analytics');
    return res.status(200).json(analytics);
  } catch (error) {
    console.error('[analytics/retention] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

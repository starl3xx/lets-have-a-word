/**
 * Retention Analytics API
 * Returns user retention metrics including return rate and churn indicators
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../../src/db';
import { sql } from 'drizzle-orm';
import { isAdminFid } from '../me';

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

    // Query 1: Day-over-day return rate
    const returnRateResult = await db.execute<{
      yesterday_users: number;
      returning_users: number;
    }>(sql`
      WITH yesterday_users AS (
        SELECT DISTINCT user_fid
        FROM guesses
        WHERE created_at >= DATE_TRUNC('day', NOW() - INTERVAL '1 day')
          AND created_at < DATE_TRUNC('day', NOW())
      ),
      today_users AS (
        SELECT DISTINCT user_fid
        FROM guesses
        WHERE created_at >= DATE_TRUNC('day', NOW())
      )
      SELECT
        (SELECT COUNT(*) FROM yesterday_users) as yesterday_users,
        (SELECT COUNT(*) FROM yesterday_users WHERE user_fid IN (SELECT user_fid FROM today_users)) as returning_users
    `);

    // Query 2: WAU and MAU
    const wauMauResult = await db.execute<{
      wau: number;
      mau: number;
    }>(sql`
      SELECT
        (SELECT COUNT(DISTINCT user_fid) FROM guesses WHERE created_at >= NOW() - INTERVAL '7 days') as wau,
        (SELECT COUNT(DISTINCT user_fid) FROM guesses WHERE created_at >= NOW() - INTERVAL '30 days') as mau
    `);

    // Query 3: Churn indicators
    const churnResult = await db.execute<{
      churned_7d: number;
      churned_30d: number;
      total_users: number;
    }>(sql`
      WITH user_last_activity AS (
        SELECT user_fid, MAX(created_at) as last_active
        FROM guesses
        GROUP BY user_fid
      )
      SELECT
        COUNT(*) FILTER (WHERE last_active < NOW() - INTERVAL '7 days' AND last_active >= NOW() - INTERVAL '14 days') as churned_7d,
        COUNT(*) FILTER (WHERE last_active < NOW() - INTERVAL '30 days') as churned_30d,
        COUNT(*) as total_users
      FROM user_last_activity
    `);

    // Query 4: Power users (10+ rounds played)
    const powerUserResult = await db.execute<{
      power_users: number;
    }>(sql`
      SELECT COUNT(*) as power_users
      FROM (
        SELECT user_fid, COUNT(DISTINCT round_id) as rounds_played
        FROM guesses
        GROUP BY user_fid
        HAVING COUNT(DISTINCT round_id) >= 10
      ) as power_users
    `);

    // Query 5: Daily retention trend (last 14 days)
    const dailyRetentionResult = await db.execute<{
      day: string;
      returning_users: number;
      previous_day_users: number;
    }>(sql`
      WITH daily_users AS (
        SELECT
          DATE(created_at) as day,
          ARRAY_AGG(DISTINCT user_fid) as user_fids
        FROM guesses
        WHERE created_at >= NOW() - INTERVAL '15 days'
        GROUP BY DATE(created_at)
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
        WHERE d1.day >= NOW() - INTERVAL '14 days'
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

    // Get today's DAU for stickiness calculation
    const dauResult = await db.execute<{ dau: number }>(sql`
      SELECT COUNT(DISTINCT user_fid) as dau
      FROM guesses
      WHERE created_at >= DATE_TRUNC('day', NOW())
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

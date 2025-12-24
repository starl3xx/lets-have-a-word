/**
 * WAU Analytics API
 * Milestone 5.2: Analytics system
 *
 * Returns Weekly Active Users data
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../../src/db';
import { sql } from 'drizzle-orm';
import { isAdminFid } from '../me';
import { cacheAside, CacheKeys, CacheTTL } from '../../../../src/lib/redis';

export interface WAUDataPoint {
  week_start: string;
  active_users: number;
}

/**
 * GET /api/admin/analytics/wau
 *
 * Returns WAU data (requires admin access)
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WAUDataPoint[] | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check if analytics is enabled
  if (process.env.ANALYTICS_ENABLED !== 'true') {
    return res.status(200).json([]);
  }

  try {
    // Get FID from query params (dev mode)
    let fid: number | null = null;
    if (req.query.devFid) {
      fid = parseInt(req.query.devFid as string, 10);
    } else if (req.cookies.siwn_fid) {
      fid = parseInt(req.cookies.siwn_fid, 10);
    }

    if (!fid || !isAdminFid(fid)) {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }

    // Cache WAU data (60s TTL)
    const cacheKey = CacheKeys.adminAnalytics('wau');
    const serializedData = await cacheAside<WAUDataPoint[]>(
      cacheKey,
      CacheTTL.adminAnalytics,
      async () => {
        // Query WAU view
        const result = await db.execute<WAUDataPoint>(
          sql`SELECT * FROM view_wau ORDER BY week_start DESC LIMIT 12`
        );

        console.log('[analytics/wau] Raw result:', JSON.stringify(result).substring(0, 300));

        // db.execute returns the array directly, not an object with rows property
        const rows = Array.isArray(result) ? result : [];

        // Ensure proper serialization
        return rows.map(row => ({
          week_start: row.week_start?.toString() || '',
          active_users: Number(row.active_users) || 0
        }));
      }
    );

    console.log('[analytics/wau] Returning data:', JSON.stringify(serializedData).substring(0, 200));
    return res.status(200).json(serializedData);
  } catch (error) {
    console.error('[analytics/wau] Error fetching WAU:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

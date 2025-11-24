/**
 * DAU Analytics API
 * Milestone 5.2: Analytics system
 *
 * Returns Daily Active Users data
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../../src/db';
import { sql } from 'drizzle-orm';
import { isAdminFid } from '../me';

export interface DAUDataPoint {
  day: string;
  active_users: number;
}

/**
 * GET /api/admin/analytics/dau
 *
 * Returns DAU data (requires admin access)
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<DAUDataPoint[] | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check if analytics is enabled
  if (process.env.ANALYTICS_ENABLED !== 'true') {
    console.log('[analytics/dau] Analytics disabled: ANALYTICS_ENABLED not set to "true"');
    return res.status(503).json({ error: 'Analytics not enabled. Set ANALYTICS_ENABLED=true in environment variables.' });
  }

  try {
    // Get FID from query params (dev mode)
    let fid: number | null = null;
    if (req.query.devFid) {
      fid = parseInt(req.query.devFid as string, 10);
      console.log('[analytics/dau] Using devFid:', fid);
    } else if (req.cookies.siwn_fid) {
      fid = parseInt(req.cookies.siwn_fid, 10);
      console.log('[analytics/dau] Using cookie FID:', fid);
    }

    if (!fid) {
      console.log('[analytics/dau] No FID provided');
      return res.status(401).json({ error: 'Authentication required: No FID provided' });
    }

    if (!isAdminFid(fid)) {
      console.log('[analytics/dau] FID is not admin:', fid);
      return res.status(403).json({ error: `Forbidden: FID ${fid} is not an admin. Set LHAW_ADMIN_USER_IDS environment variable.` });
    }

    // Query DAU view
    const result = await db.execute<DAUDataPoint>(
      sql`SELECT * FROM view_dau ORDER BY day DESC LIMIT 30`
    );

    return res.status(200).json(result.rows);
  } catch (error) {
    console.error('[analytics/dau] Error fetching DAU:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

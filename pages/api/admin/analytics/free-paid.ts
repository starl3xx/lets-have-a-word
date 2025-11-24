/**
 * Free/Paid Ratio Analytics API
 * Milestone 5.2: Analytics system
 *
 * Returns free vs paid guess data
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../../src/db';
import { sql } from 'drizzle-orm';
import { isAdminFid } from '../me';

export interface FreePaidDataPoint {
  day: string;
  free_guesses: number;
  paid_guesses: number;
  free_to_paid_ratio: number | null;
}

/**
 * GET /api/admin/analytics/free-paid
 *
 * Returns free/paid ratio data (requires admin access)
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<FreePaidDataPoint[] | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check if analytics is enabled
  if (process.env.ANALYTICS_ENABLED !== 'true') {
    console.log('[analytics/free-paid] Analytics disabled: ANALYTICS_ENABLED not set to "true"');
    return res.status(503).json({ error: 'Analytics not enabled. Set ANALYTICS_ENABLED=true in environment variables.' });
  }

  try {
    // Get FID from query params (dev mode)
    let fid: number | null = null;
    if (req.query.devFid) {
      fid = parseInt(req.query.devFid as string, 10);
      console.log('[analytics/free-paid] Using devFid:', fid);
    } else if (req.cookies.siwn_fid) {
      fid = parseInt(req.cookies.siwn_fid, 10);
      console.log('[analytics/free-paid] Using cookie FID:', fid);
    }

    if (!fid) {
      console.log('[analytics/free-paid] No FID provided');
      return res.status(401).json({ error: 'Authentication required: No FID provided' });
    }

    if (!isAdminFid(fid)) {
      console.log('[analytics/free-paid] FID is not admin:', fid);
      return res.status(403).json({ error: `Forbidden: FID ${fid} is not an admin. Set LHAW_ADMIN_USER_IDS environment variable.` });
    }

    // Query free/paid ratio view
    const result = await db.execute<FreePaidDataPoint>(
      sql`SELECT * FROM view_free_paid_ratio ORDER BY day DESC LIMIT 30`
    );

    return res.status(200).json(result.rows);
  } catch (error) {
    console.error('[analytics/free-paid] Error fetching free/paid data:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

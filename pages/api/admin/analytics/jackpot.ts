/**
 * Jackpot Growth Analytics API
 * Milestone 5.2: Analytics system
 *
 * Returns jackpot growth data
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../../src/db';
import { sql } from 'drizzle-orm';
import { isAdminFid } from '../me';

export interface JackpotDataPoint {
  day: string;
  round_id: string;
  jackpot_eth: string;
  winner_fid: number | null;
}

/**
 * GET /api/admin/analytics/jackpot
 *
 * Returns jackpot growth data (requires admin access)
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<JackpotDataPoint[] | { error: string }>
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

    // Query jackpot growth view
    const result = await db.execute<JackpotDataPoint>(
      sql`SELECT * FROM view_jackpot_growth ORDER BY day DESC LIMIT 30`
    );

    // Ensure proper serialization
    const serializedData = result.rows.map(row => ({
      day: row.day?.toString() || '',
      round_id: row.round_id?.toString() || '',
      jackpot_eth: row.jackpot_eth?.toString() || '0',
      winner_fid: row.winner_fid !== null ? Number(row.winner_fid) : null
    }));

    console.log('[analytics/jackpot] Returning data:', JSON.stringify(serializedData).substring(0, 200));
    return res.status(200).json(serializedData);
  } catch (error) {
    console.error('[analytics/jackpot] Error fetching jackpot data:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

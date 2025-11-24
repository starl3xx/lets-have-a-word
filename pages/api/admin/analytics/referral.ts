/**
 * Referral Funnel Analytics API
 * Milestone 5.2: Analytics system
 *
 * Returns referral funnel data
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../../src/db';
import { sql } from 'drizzle-orm';
import { isAdminFid } from '../me';

export interface ReferralDataPoint {
  day: string;
  referral_shares: number;
  referral_joins: number;
  referral_wins: number;
  bonus_unlocked: number;
}

/**
 * GET /api/admin/analytics/referral
 *
 * Returns referral funnel data (requires admin access)
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ReferralDataPoint[] | { error: string }>
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

    // Query referral funnel view
    const result = await db.execute<ReferralDataPoint>(
      sql`SELECT * FROM view_referral_funnel ORDER BY day DESC LIMIT 30`
    );

    console.log('[analytics/referral] Raw result:', JSON.stringify(result).substring(0, 300));

    // db.execute returns the array directly, not an object with rows property
    const rows = Array.isArray(result) ? result : [];

    // Ensure proper serialization
    const serializedData = rows.map(row => ({
      day: row.day?.toString() || '',
      referral_shares: Number(row.referral_shares) || 0,
      referral_joins: Number(row.referral_joins) || 0,
      referral_wins: Number(row.referral_wins) || 0,
      bonus_unlocked: Number(row.bonus_unlocked) || 0
    }));

    console.log('[analytics/referral] Returning data:', JSON.stringify(serializedData).substring(0, 200));
    return res.status(200).json(serializedData);
  } catch (error) {
    console.error('[analytics/referral] Error fetching referral data:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

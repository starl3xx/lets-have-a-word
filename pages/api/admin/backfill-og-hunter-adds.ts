/**
 * Backfill addedMiniAppAt for OG Hunter users
 * Sets addedMiniAppAt for users who have verified casts but missing addedMiniAppAt
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../src/db';
import { sql } from 'drizzle-orm';
import { isAdminFid } from './me';

interface BackfillResponse {
  success: boolean;
  updatedCount?: number;
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<BackfillResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    // Check admin auth
    let fid: number | null = null;
    if (req.query.devFid) {
      fid = parseInt(req.query.devFid as string, 10);
    } else if (req.cookies.siwn_fid) {
      fid = parseInt(req.cookies.siwn_fid, 10);
    }

    if (!fid || !isAdminFid(fid)) {
      return res.status(403).json({ success: false, error: 'Forbidden: Admin access required' });
    }

    // Backfill: set addedMiniAppAt from cast verification time for users missing it
    const result = await db.execute(sql`
      UPDATE users
      SET added_mini_app_at = og_hunter_cast_proofs.verified_at,
          updated_at = NOW()
      FROM og_hunter_cast_proofs
      WHERE users.fid = og_hunter_cast_proofs.fid
        AND users.added_mini_app_at IS NULL
    `);

    const updatedCount = result.rowCount ?? 0;
    console.log(`[backfill] Updated ${updatedCount} users with addedMiniAppAt from cast proofs`);

    return res.status(200).json({
      success: true,
      updatedCount,
    });
  } catch (error) {
    console.error('[backfill] Error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

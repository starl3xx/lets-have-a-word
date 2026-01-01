/**
 * Backfill addedMiniAppAt for OG Hunter users
 * Sets addedMiniAppAt for users who have verified casts but missing addedMiniAppAt
 * Also creates user records if they don't exist yet
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../src/db';
import { sql } from 'drizzle-orm';
import { isAdminFid } from './me';

interface BackfillResponse {
  success: boolean;
  updatedCount?: number;
  insertedCount?: number;
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

    // Step 1: Update existing users who have cast proofs but no addedMiniAppAt
    const updateResult = await db.execute(sql`
      UPDATE users
      SET added_mini_app_at = og_hunter_cast_proofs.verified_at,
          updated_at = NOW()
      FROM og_hunter_cast_proofs
      WHERE users.fid = og_hunter_cast_proofs.fid
        AND users.added_mini_app_at IS NULL
    `);

    const updatedCount = updateResult.rowCount ?? 0;

    // Step 2: Insert new users for cast proofs where no user exists
    const insertResult = await db.execute(sql`
      INSERT INTO users (fid, added_mini_app_at, xp, has_seen_intro, has_seen_og_hunter_thanks, created_at, updated_at)
      SELECT
        og_hunter_cast_proofs.fid,
        og_hunter_cast_proofs.verified_at,
        0,
        false,
        false,
        NOW(),
        NOW()
      FROM og_hunter_cast_proofs
      LEFT JOIN users ON users.fid = og_hunter_cast_proofs.fid
      WHERE users.fid IS NULL
    `);

    const insertedCount = insertResult.rowCount ?? 0;

    console.log(`[backfill] Updated ${updatedCount}, inserted ${insertedCount} users with addedMiniAppAt from cast proofs`);

    return res.status(200).json({
      success: true,
      updatedCount,
      insertedCount,
    });
  } catch (error) {
    console.error('[backfill] Error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

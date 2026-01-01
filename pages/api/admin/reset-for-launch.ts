/**
 * Reset Database for Launch API
 *
 * POST /api/admin/reset-for-launch
 *
 * DESTRUCTIVE: Clears all rounds, guesses, and resets sequences for a fresh Round #1 launch.
 * Requires admin authentication and explicit confirmation.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from './me';
import { db } from '../../../src/db';
import { rounds, guesses, users, roundArchive } from '../../../src/db/schema';
import { sql } from 'drizzle-orm';

interface ResetResponse {
  success: boolean;
  message: string;
  deletedRounds?: number;
  deletedGuesses?: number;
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResetResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      message: 'Method not allowed. Use POST.',
    });
  }

  try {
    // Get FID from request
    const devFid = req.query.devFid || req.body?.devFid;
    const fid = devFid ? parseInt(String(devFid), 10) : null;

    if (!fid || !isAdminFid(fid)) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required',
      });
    }

    // Require explicit confirmation
    const { confirm } = req.body || {};
    if (confirm !== 'RESET_FOR_LAUNCH') {
      return res.status(400).json({
        success: false,
        message: 'Must include { "confirm": "RESET_FOR_LAUNCH" } in request body',
      });
    }

    console.log(`[reset-for-launch] Admin FID ${fid} initiating database reset...`);

    // Delete all guesses first (foreign key to rounds)
    const deletedGuesses = await db.delete(guesses).returning();
    console.log(`[reset-for-launch] Deleted ${deletedGuesses.length} guesses`);

    // Delete all round archives
    const deletedArchives = await db.delete(roundArchive).returning();
    console.log(`[reset-for-launch] Deleted ${deletedArchives.length} archive entries`);

    // Delete all rounds
    const deletedRounds = await db.delete(rounds).returning();
    console.log(`[reset-for-launch] Deleted ${deletedRounds.length} rounds`);

    // Reset the rounds sequence to start at 1
    await db.execute(sql`ALTER SEQUENCE rounds_id_seq RESTART WITH 1`);
    console.log(`[reset-for-launch] Reset rounds_id_seq to 1`);

    // Reset user daily stats (optional - keeps user accounts but clears daily progress)
    await db.execute(sql`
      UPDATE users SET
        guesses_today = 0,
        has_shared_today = false,
        share_bonus_claimed_today = false,
        paid_packs_purchased_today = 0
    `);
    console.log(`[reset-for-launch] Reset user daily stats`);

    return res.status(200).json({
      success: true,
      message: `Database reset complete! Ready for Round #1 launch.`,
      deletedRounds: deletedRounds.length,
      deletedGuesses: deletedGuesses.length,
    });
  } catch (error) {
    console.error('[reset-for-launch] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to reset database',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

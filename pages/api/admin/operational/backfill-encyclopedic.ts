/**
 * Backfill ENCYCLOPEDIC wordmarks for users who have guessed words with all 26 letters
 *
 * POST: Award ENCYCLOPEDIC to all qualifying users
 * GET: Preview how many users would be awarded
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from '../me';
import { db, userBadges } from '../../../../src/db';
import { sql } from 'drizzle-orm';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Verify admin authentication
  const devFid = req.query.devFid as string;
  if (!devFid || !isAdminFid(parseInt(devFid, 10))) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    // Find all users who have guessed words starting with all 26 letters
    const qualifyingUsers = await db.execute<{ fid: number; letter_count: number }>(sql`
      SELECT fid, COUNT(DISTINCT UPPER(LEFT(word, 1))) as letter_count
      FROM guesses
      WHERE word ~ '^[A-Za-z]'
      GROUP BY fid
      HAVING COUNT(DISTINCT UPPER(LEFT(word, 1))) = 26
    `);

    console.log(`[backfill-encyclopedic] Found ${qualifyingUsers.length} users with all 26 letters`);

    if (req.method === 'GET') {
      // Preview mode
      return res.status(200).json({
        message: 'Preview - POST to execute backfill',
        qualifyingUsers: qualifyingUsers.length,
        preview: qualifyingUsers.slice(0, 20).map(u => ({ fid: u.fid })),
      });
    }

    if (req.method === 'POST') {
      // Execute backfill
      let awarded = 0;
      let alreadyHad = 0;

      for (const user of qualifyingUsers) {
        try {
          const result = await db
            .insert(userBadges)
            .values({
              fid: user.fid,
              badgeType: 'ENCYCLOPEDIC',
              metadata: { letterCount: 26, backfilled: true },
            })
            .onConflictDoNothing()
            .returning();

          if (result.length > 0) {
            awarded++;
            console.log(`[backfill-encyclopedic] 📚 Awarded ENCYCLOPEDIC to FID ${user.fid}`);
          } else {
            alreadyHad++;
          }
        } catch (error) {
          console.error(`[backfill-encyclopedic] Error awarding to FID ${user.fid}:`, error);
        }
      }

      console.log(`[backfill-encyclopedic] ✅ Complete: ${awarded} awarded, ${alreadyHad} already had`);

      return res.status(200).json({
        success: true,
        awarded,
        alreadyHad,
        total: qualifyingUsers.length,
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('[backfill-encyclopedic] Error:', error);
    return res.status(500).json({
      error: 'Failed to backfill ENCYCLOPEDIC wordmarks',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

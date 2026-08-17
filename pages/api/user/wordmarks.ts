/**
 * GET /api/user/wordmarks
 * Fetch all wordmarks for a user with earned status
 *
 * Query params:
 * - fid: User's Farcaster ID
 *
 * Response:
 * - wordmarks: Array of wordmark objects with earned status
 * - earnedCount: Number of wordmarks earned
 * - totalCount: Total number of available wordmarks
 *
 * The two Round-34 launch marks (Early Adopter, Trailblazer) are hidden —
 * earned or not — until a $WORD round exists. The reveal is part of the
 * relaunch, so the backfill can run ahead of launch without leaking.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getUserWordmarks, ROUND34_WORDMARK_TYPES, type UserWordmark } from '../../../src/lib/wordmarks';
import { db, rounds } from '../../../src/db';
import { eq } from 'drizzle-orm';

export interface UserWordmarksResponse {
  wordmarks: UserWordmark[];
  earnedCount: number;
  totalCount: number;
}

// The era never un-flips, so a module-level latch avoids re-querying once a
// 'word' round has been seen.
let wordEraSeen = false;
async function isWordEraLive(): Promise<boolean> {
  if (wordEraSeen) return true;
  const [row] = await db
    .select({ id: rounds.id })
    .from(rounds)
    .where(eq(rounds.prizeCurrency, 'word'))
    .limit(1);
  wordEraSeen = row !== undefined;
  return wordEraSeen;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<UserWordmarksResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { fid } = req.query;

  if (!fid || typeof fid !== 'string') {
    return res.status(400).json({ error: 'fid is required' });
  }

  const fidNum = parseInt(fid, 10);
  if (isNaN(fidNum) || fidNum <= 0) {
    return res.status(400).json({ error: 'Invalid fid' });
  }

  try {
    const [allWordmarks, round34Visible] = await Promise.all([
      getUserWordmarks(fidNum),
      isWordEraLive(),
    ]);

    const wordmarks = round34Visible
      ? allWordmarks
      : allWordmarks.filter(w => !ROUND34_WORDMARK_TYPES.includes(w.id));
    const earnedCount = wordmarks.filter(w => w.earned).length;

    return res.status(200).json({
      wordmarks,
      earnedCount,
      totalCount: wordmarks.length,
    });
  } catch (error) {
    console.error('[api/user/wordmarks] Error fetching wordmarks:', error);
    return res.status(500).json({ error: 'Failed to fetch wordmarks' });
  }
}

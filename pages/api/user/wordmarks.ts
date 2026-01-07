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
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getUserWordmarks, getAllWordmarkDefinitions, type UserWordmark } from '../../../src/lib/wordmarks';

export interface UserWordmarksResponse {
  wordmarks: UserWordmark[];
  earnedCount: number;
  totalCount: number;
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
    const wordmarks = await getUserWordmarks(fidNum);
    const earnedCount = wordmarks.filter(w => w.earned).length;
    const totalCount = getAllWordmarkDefinitions().length;

    return res.status(200).json({
      wordmarks,
      earnedCount,
      totalCount,
    });
  } catch (error) {
    console.error('[api/user/wordmarks] Error fetching wordmarks:', error);
    return res.status(500).json({ error: 'Failed to fetch wordmarks' });
  }
}

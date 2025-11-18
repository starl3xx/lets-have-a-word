import type { NextApiRequest, NextApiResponse } from 'next';
import { getActiveWheelData } from '../../src/lib/wheel';

/**
 * GET /api/wheel
 *
 * Returns the wheel words for the current active round
 * Milestone 2.3: Wheel + Visual State + Top Ticker
 *
 * Response:
 * {
 *   "roundId": 1,
 *   "words": ["ABORT", "ABOUT", "ACTOR", ...]
 * }
 *
 * Words are sorted alphabetically and include:
 * - Seed words (cosmetic pre-population)
 * - Wrong guesses from real players
 *
 * Automatically creates a round if none exists.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ roundId: number; words: string[] } | { error: string }>
) {
  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const wheelData = await getActiveWheelData();
    return res.status(200).json(wheelData);
  } catch (error: any) {
    console.error('Error in /api/wheel:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

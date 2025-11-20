import type { NextApiRequest, NextApiResponse } from 'next';
import { getActiveWheelData } from '../../src/lib/wheel';
import { ensureDevMidRound } from '../../src/lib/devMidRound';

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
 * In dev mode with NEXT_PUBLIC_TEST_MID_ROUND=true, populates with test data.
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
    // Milestone 4.5: Ensure dev mid-round test mode is initialized (dev only, no-op in prod)
    await ensureDevMidRound();

    const wheelData = await getActiveWheelData();
    return res.status(200).json(wheelData);
  } catch (error: any) {
    console.error('Error in /api/wheel:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

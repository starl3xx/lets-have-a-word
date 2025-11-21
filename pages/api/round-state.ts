import type { NextApiRequest, NextApiResponse } from 'next';
import { getActiveRoundStatus } from '../../src/lib/wheel';
import type { RoundStatus } from '../../src/lib/wheel';
import { ensureDevMidRound } from '../../src/lib/devMidRound';
import { isDevModeEnabled } from '../../src/lib/devGameState';

/**
 * GET /api/round-state
 *
 * Returns the current active round's status for the top ticker
 * Milestone 2.3: Wheel + Visual State + Top Ticker
 *
 * Response:
 * {
 *   "roundId": 1,
 *   "prizePoolEth": "0.5",
 *   "prizePoolUsd": "1500.00",
 *   "globalGuessCount": 42
 * }
 *
 * Automatically creates a round if none exists.
 * In dev mode with NEXT_PUBLIC_TEST_MID_ROUND=true, creates a mid-round test scenario.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<RoundStatus | { error: string }>
) {
  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Milestone 4.8: Check for dev mode first
    if (isDevModeEnabled()) {
      console.log('🎮 Dev mode: Returning synthetic round status');

      // Return synthetic round status for dev mode
      const syntheticStatus: RoundStatus = {
        roundId: 999999,
        prizePoolEth: '0.42',
        prizePoolUsd: '1260.00',
        globalGuessCount: 73,
        lastUpdatedAt: new Date().toISOString(),
      };

      return res.status(200).json(syntheticStatus);
    }

    // Production mode: fetch from database
    // Milestone 4.5: Ensure dev mid-round test mode is initialized (dev only, no-op in prod)
    await ensureDevMidRound();

    const roundStatus = await getActiveRoundStatus();
    return res.status(200).json(roundStatus);
  } catch (error: any) {
    console.error('Error in /api/round-state:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

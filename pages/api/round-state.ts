import type { NextApiRequest, NextApiResponse } from 'next';
import { getActiveRoundStatus } from '../../src/lib/wheel';
import type { RoundStatus } from '../../src/lib/wheel';

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
    const roundStatus = await getActiveRoundStatus();
    return res.status(200).json(roundStatus);
  } catch (error: any) {
    console.error('Error in /api/round-state:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

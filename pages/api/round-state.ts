import type { NextApiRequest, NextApiResponse } from 'next';
import { getActiveRoundStatus } from '../../src/lib/wheel';
import type { RoundStatus } from '../../src/lib/wheel';
import { ensureDevMidRound } from '../../src/lib/devMidRound';
import { isDevModeEnabled } from '../../src/lib/devGameState';
import { getEthUsdPrice } from '../../src/lib/prices';

/**
 * GET /api/round-state
 *
 * Returns the current active round's status for the top ticker
 * Milestone 2.3: Wheel + Visual State + Top Ticker
 * Milestone 4.12: ETH/USD conversion via CoinGecko (works in dev & prod)
 *
 * Response:
 * {
 *   "roundId": 1,
 *   "prizePoolEth": "0.5",
 *   "prizePoolUsd": "1500.00",  // Live from CoinGecko
 *   "globalGuessCount": 42,
 *   "lastUpdatedAt": "2025-01-15T12:00:00Z"
 * }
 *
 * Automatically creates a round if none exists.
 * In dev mode with NEXT_PUBLIC_TEST_MID_ROUND=true, creates a mid-round test scenario.
 * In dev mode with LHAW_DEV_MODE=true, returns synthetic data with live ETH/USD price.
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
      console.log('🎮 Dev mode: Returning randomized synthetic round status');

      // Generate random values for dev mode
      const prizePoolEthNum = 0.1 + Math.random() * 0.3; // 0.1 - 0.4 ETH
      const globalGuessCount = Math.floor(100 + Math.random() * 5900); // 100 - 6000
      const roundId = Math.floor(5 + Math.random() * 296); // 5 - 300

      // Fetch live ETH/USD price even in dev mode (Milestone 4.12)
      const ethUsdRate = await getEthUsdPrice();
      const prizePoolUsd = ethUsdRate != null
        ? (prizePoolEthNum * ethUsdRate).toFixed(2)
        : (prizePoolEthNum * 3000).toFixed(2); // Fallback estimate

      // Return synthetic round status for dev mode
      const syntheticStatus: RoundStatus = {
        roundId,
        prizePoolEth: prizePoolEthNum.toFixed(4),
        prizePoolUsd,
        globalGuessCount,
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

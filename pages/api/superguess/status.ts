/**
 * Superguess Availability & Pricing API
 * Milestone 15: Returns current tier + price for purchase UI
 *
 * GET /api/superguess/status
 *
 * Returns:
 * - available: boolean (guess count >= 850, no active session)
 * - tier?: { id, usdPrice }
 * - wordTokenPrice?: string (amount of $WORD tokens needed, in display format)
 * - activeSession?: boolean
 * - globalGuessCount: number
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  isSuperguessFeatureEnabled,
  getActiveSuperguess,
  getSuperguessCurrentTier,
  hasUsedSuperguessThisRound,
  SUPERGUESS_MIN_GUESS_COUNT,
} from '../../../src/lib/superguess';
import { getActiveRound } from '../../../src/lib/rounds';
import { getTotalGuessCountInRound } from '../../../src/lib/guesses';
import { getGuessWords } from '../../../src/lib/word-lists';
import { isDevModeEnabled } from '../../../src/lib/devGameState';
import { getEthUsdPrice } from '../../../src/lib/prices';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (!isSuperguessFeatureEnabled()) {
      return res.status(200).json({ available: false, reason: 'feature_disabled' });
    }

    // In dev mode, use the dev round (not the live production round)
    let roundId: number;
    if (isDevModeEnabled()) {
      const { ensureDevRound } = await import('../../../src/lib/devGameState');
      roundId = await ensureDevRound();
    } else {
      const activeRound = await getActiveRound();
      if (!activeRound) {
        return res.status(200).json({ available: false, reason: 'no_active_round' });
      }
      roundId = activeRound.id;
    }

    const realGuessCount = await getTotalGuessCountInRound(roundId);
    const totalDictionaryWords = getGuessWords().length;

    // In dev mode, use a synthetic guess count above threshold so the UI is always testable
    const globalGuessCount = isDevModeEnabled()
      ? Math.max(realGuessCount, SUPERGUESS_MIN_GUESS_COUNT + 100)
      : realGuessCount;

    // Check if we've reached the threshold
    if (globalGuessCount < SUPERGUESS_MIN_GUESS_COUNT) {
      return res.status(200).json({
        available: false,
        reason: 'below_threshold',
        globalGuessCount,
        threshold: SUPERGUESS_MIN_GUESS_COUNT,
      });
    }

    // Check for active session
    const activeSession = await getActiveSuperguess(roundId);
    if (activeSession) {
      return res.status(200).json({
        available: false,
        reason: 'session_active',
        activeSession: true,
        globalGuessCount,
      });
    }

    // Check if Superguess already used this round (by any player)
    const roundUsed = await hasUsedSuperguessThisRound(roundId);
    if (roundUsed) {
      return res.status(200).json({
        available: false,
        reason: 'already_used_this_round',
        globalGuessCount,
      });
    }

    // Available! Return tier + pricing
    const tier = getSuperguessCurrentTier(globalGuessCount, totalDictionaryWords);

    // Price the tier in ETH.
    //
    // Superguess is bought with ETH: players earn $WORD by playing — jackpot,
    // bonus words, top ten — and spend ETH to buy, so a first-time player does
    // not have to acquire the reward token before they can use it.
    //
    // Returns an exact decimal string rather than a display abbreviation. The
    // client previously received "64M" and parsed it back to a number to build
    // the transaction: a lossy round-trip through a human-readable label, on
    // the value being paid.
    let ethAmount: string | null = null;
    let ethUsdRate: number | null = null;

    if (tier) {
      ethUsdRate = await getEthUsdPrice();
      if (ethUsdRate && ethUsdRate > 0) {
        // 6 dp is well under a cent at any plausible ETH price, and the server
        // accepts a floor below the quote anyway.
        ethAmount = (tier.usdPrice / ethUsdRate).toFixed(6);
      }
    }

    return res.status(200).json({
      available: true,
      tier: tier ? { id: tier.id, usdPrice: tier.usdPrice } : null,
      ethAmount,
      ethUsdRate,
      globalGuessCount,
      roundId: roundId,
    });
  } catch (error) {
    console.error('[superguess/status] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

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

    // Fetch $WORD price for token conversion display
    let wordTokenAmount: string | null = null;
    if (tier) {
      try {
        const { fetchWordTokenMarketCap } = await import('../../../src/lib/word-oracle');
        const marketData = await fetchWordTokenMarketCap();
        if (marketData && marketData.priceUsd > 0) {
          const tokensNeeded = tier.usdPrice / marketData.priceUsd;
          // Format as human-readable: "64M", "128M", etc.
          if (tokensNeeded >= 1_000_000_000) {
            wordTokenAmount = `${(tokensNeeded / 1_000_000_000).toFixed(1)}B`;
          } else if (tokensNeeded >= 1_000_000) {
            wordTokenAmount = `${Math.round(tokensNeeded / 1_000_000)}M`;
          } else if (tokensNeeded >= 1_000) {
            wordTokenAmount = `${Math.round(tokensNeeded / 1_000)}K`;
          } else {
            wordTokenAmount = Math.round(tokensNeeded).toString();
          }
        }
      } catch (err) {
        console.warn('[superguess/status] Failed to fetch $WORD price:', err);
      }
    }

    // Check if user already used Superguess this round (optional fid param)
    let alreadyUsedThisRound = false;
    const fidParam = req.query.fid ? parseInt(req.query.fid as string, 10) : null;
    if (fidParam && !isNaN(fidParam)) {
      alreadyUsedThisRound = await hasUsedSuperguessThisRound(roundId, fidParam);
    }

    if (alreadyUsedThisRound) {
      return res.status(200).json({
        available: false,
        reason: 'already_used',
        globalGuessCount,
      });
    }

    return res.status(200).json({
      available: true,
      tier: tier ? { id: tier.id, usdPrice: tier.usdPrice } : null,
      wordTokenAmount,
      globalGuessCount,
      roundId: roundId,
    });
  } catch (error) {
    console.error('[superguess/status] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Superguess Availability & Pricing API
 * Milestone 15: Returns current tier + price for purchase UI
 *
 * GET /api/superguess/status
 *
 * Returns:
 * - available: boolean (guess count >= 850, no active session, no cooldown)
 * - tier?: { id, usdPrice }
 * - wordTokenPrice?: string (amount of $WORD tokens needed, in display format)
 * - activeSession?: boolean
 * - cooldown?: { endsAt }
 * - globalGuessCount: number
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  isSuperguessFeatureEnabled,
  getActiveSuperguess,
  isCooldownActive,
  getSuperguessCurrentTier,
  SUPERGUESS_MIN_GUESS_COUNT,
} from '../../../src/lib/superguess';
import { getActiveRound } from '../../../src/lib/rounds';
import { getTotalGuessCountInRound } from '../../../src/lib/guesses';
import { getGuessWords } from '../../../src/lib/word-lists';

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

    const activeRound = await getActiveRound();
    if (!activeRound) {
      return res.status(200).json({ available: false, reason: 'no_active_round' });
    }

    const globalGuessCount = await getTotalGuessCountInRound(activeRound.id);
    const totalDictionaryWords = getGuessWords().length;

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
    const activeSession = await getActiveSuperguess(activeRound.id);
    if (activeSession) {
      return res.status(200).json({
        available: false,
        reason: 'session_active',
        activeSession: true,
        globalGuessCount,
      });
    }

    // Check cooldown
    const cooldown = await isCooldownActive(activeRound.id);
    if (cooldown.active) {
      return res.status(200).json({
        available: false,
        reason: 'cooldown',
        cooldown: { endsAt: cooldown.endsAt },
        globalGuessCount,
      });
    }

    // Available! Return tier + pricing
    const tier = getSuperguessCurrentTier(globalGuessCount, totalDictionaryWords);

    return res.status(200).json({
      available: true,
      tier: tier ? { id: tier.id, usdPrice: tier.usdPrice } : null,
      globalGuessCount,
      roundId: activeRound.id,
    });
  } catch (error) {
    console.error('[superguess/status] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

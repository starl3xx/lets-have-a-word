/**
 * Superguess State API
 * Milestone 15: Returns current Superguess state for polling
 *
 * GET /api/superguess/state
 *
 * Returns:
 * - active: boolean
 * - session?: { fid, username, guessesUsed, guessesAllowed, expiresAt, ... }
 * - cooldown?: { endsAt }
 * - eligible: boolean
 *
 * Polled every 3 seconds by clients when superguessActive is true in round-state.
 * Redis-cached with 2s TTL, invalidated on each Superguess guess.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  isSuperguessFeatureEnabled,
  getSuperguessState,
} from '../../../src/lib/superguess';
import { getActiveRound } from '../../../src/lib/rounds';
import { getTotalGuessCountInRound } from '../../../src/lib/guesses';
import { getGuessWords } from '../../../src/lib/word-lists';
import { cacheAside, CacheKeys, CacheTTL } from '../../../src/lib/redis';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (!isSuperguessFeatureEnabled()) {
      return res.status(200).json({ active: false, eligible: false });
    }

    const activeRound = await getActiveRound();
    if (!activeRound) {
      return res.status(200).json({ active: false, eligible: false });
    }

    const totalDictionaryWords = getGuessWords().length;

    // Use cache-aside with 2s TTL (invalidated on each Superguess guess)
    const state = await cacheAside(
      CacheKeys.superguessState(activeRound.id),
      CacheTTL.superguessState,
      async () => {
        const globalGuessCount = await getTotalGuessCountInRound(activeRound.id);
        return getSuperguessState(activeRound.id, globalGuessCount, totalDictionaryWords);
      }
    );

    res.setHeader('Cache-Control', 'public, s-maxage=2, stale-while-revalidate=3');
    return res.status(200).json(state);
  } catch (error) {
    console.error('[superguess/state] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

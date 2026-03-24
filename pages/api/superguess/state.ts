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
import { isDevModeEnabled } from '../../../src/lib/devGameState';
import { SUPERGUESS_MIN_GUESS_COUNT } from '../../../src/lib/superguess';

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

    // In dev mode, use the dev round (not the live production round)
    let roundId: number;
    if (isDevModeEnabled()) {
      const { ensureDevRound } = await import('../../../src/lib/devGameState');
      roundId = await ensureDevRound();
    } else {
      const activeRound = await getActiveRound();
      if (!activeRound) {
        return res.status(200).json({ active: false, eligible: false });
      }
      roundId = activeRound.id;
    }

    const totalDictionaryWords = getGuessWords().length;

    // Use cache-aside with 2s TTL (invalidated on each Superguess guess)
    const state = await cacheAside(
      CacheKeys.superguessState(roundId),
      CacheTTL.superguessState,
      async () => {
        const realCount = await getTotalGuessCountInRound(roundId);
        const globalGuessCount = isDevModeEnabled()
          ? Math.max(realCount, SUPERGUESS_MIN_GUESS_COUNT + 100)
          : realCount;
        return getSuperguessState(roundId, globalGuessCount, totalDictionaryWords);
      }
    );

    res.setHeader('Cache-Control', 'public, s-maxage=2, stale-while-revalidate=3');
    return res.status(200).json(state);
  } catch (error) {
    console.error('[superguess/state] Error:', error);
    return res.status(500).json({
      error: 'Internal server error',
    });
  }
}

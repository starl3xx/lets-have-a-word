import type { NextApiRequest, NextApiResponse } from 'next';
import type { GameStateResponse } from '../../src/types';
import {
  synthesizeDevGameState,
  synthesizeDevGameStateAsync,
  isDevModeEnabled,
  isForceStateEnabled,
  getDevFixedSolution,
  getDevUserId,
  isValidDevBackendState,
} from '../../src/lib/devGameState';
import { getActiveRoundStatus } from '../../src/lib/wheel';
import { getGuessWords } from '../../src/lib/word-lists';
import { getOrCreateDailyState, getFreeGuessesRemaining } from '../../src/lib/daily-limits';

/**
 * GET /api/game
 *
 * Milestone 4.8: Unified game state endpoint for dev mode preview and interactive play
 * Milestone 4.12: Updated to use live ETH/USD conversion via CoinGecko
 *
 * Returns complete game state including:
 * - Round info (prize pool, guess count)
 * - User state (guesses remaining)
 * - Wheel words
 * - Dev mode indicators
 *
 * Supports two dev modes:
 * 1. Forced-state preview: ?devState=RESULT_CORRECT&devInput=CRANE
 *    - Returns snapshot for QC/screenshots
 *    - Requires LHAW_DEV_FORCE_STATE_ENABLED=true
 *
 * 2. Interactive dev mode: (no query params)
 *    - Returns fresh dev round with fixed solution
 *    - Requires LHAW_DEV_MODE=true
 *
 * Query params:
 * - devState: Backend state to preview (SUBMITTING|RESULT_CORRECT|RESULT_WRONG_VALID|OUT_OF_GUESSES)
 * - devInput: Current input word for preview (e.g., CRANE)
 * - devFid: User FID for dev mode (defaults to LHAW_DEV_USER_ID or 12345)
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<GameStateResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { devState, devInput, devFid } = req.query;

    // Get FID (from query param or env default)
    const fid = devFid
      ? parseInt(devFid as string, 10)
      : getDevUserId();

    // Check for forced-state preview mode
    if (devState) {
      // Validate that forced-state preview is enabled
      if (!isForceStateEnabled()) {
        return res.status(403).json({
          error: 'Forced-state preview is disabled. Set LHAW_DEV_FORCE_STATE_ENABLED=true',
        });
      }

      // Validate devState is a valid backend state
      if (!isValidDevBackendState(devState as string)) {
        return res.status(400).json({
          error: `Invalid devState. Must be one of: SUBMITTING, RESULT_CORRECT, RESULT_WRONG_VALID, OUT_OF_GUESSES`,
        });
      }

      // Validate devInput if provided
      if (devInput && typeof devInput !== 'string') {
        return res.status(400).json({
          error: 'devInput must be a string',
        });
      }

      // Generate and return snapshot with live ETH/USD price (Milestone 4.12)
      const snapshot = await synthesizeDevGameStateAsync({
        devState: devState as any,
        devInput: devInput as string | undefined,
        solution: getDevFixedSolution(),
        fid,
      });

      return res.status(200).json(snapshot);
    }

    // Check for interactive dev mode
    if (isDevModeEnabled()) {
      // Interactive dev mode: return fresh dev round with live ETH/USD price (Milestone 4.12)
      const devGameState = await synthesizeDevGameStateAsync({
        solution: getDevFixedSolution(),
        fid,
      });

      return res.status(200).json(devGameState);
    }

    // Production mode: return real game state
    // Fetch round status
    const roundStatus = await getActiveRoundStatus();

    // Fetch user state (use devFid if provided, for development)
    const isDevelopment = !process.env.NEYNAR_API_KEY;
    if (!isDevelopment && !devFid) {
      return res.status(401).json({
        error: 'Authentication required in production mode',
      });
    }

    const dailyState = await getOrCreateDailyState(fid);
    const freeRemaining = getFreeGuessesRemaining(dailyState);

    // Fetch wheel words - Milestone 4.11: Use canonical GUESS_WORDS list
    const wheelWords = getGuessWords();

    const gameState: GameStateResponse = {
      roundId: roundStatus.roundId,
      prizePoolEth: roundStatus.prizePoolEth,
      prizePoolUsd: roundStatus.prizePoolUsd,
      globalGuessCount: roundStatus.globalGuessCount,
      userState: {
        fid,
        freeGuessesRemaining: freeRemaining,
        paidGuessesRemaining: dailyState.paidGuessCredits,
        totalGuessesRemaining: freeRemaining + dailyState.paidGuessCredits,
        clanktonBonusActive: dailyState.freeAllocatedClankton > 0,
      },
      wheelWords,
      devMode: false,
    };

    return res.status(200).json(gameState);
  } catch (error: any) {
    console.error('Error in /api/game:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

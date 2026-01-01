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
import { getOrCreateDailyState, getFreeGuessesRemaining } from '../../src/lib/daily-limits';

/**
 * GET /api/game
 *
 * Milestone 4.8: Unified game state endpoint for dev mode preview and interactive play
 * Milestone 4.12: Updated to use live ETH/USD conversion and real wallet data in dev mode
 *
 * Returns complete game state including:
 * - Round info (prize pool, guess count)
 * - User state (guesses remaining) - now uses REAL data even in dev mode
 * - Wheel words
 * - Dev mode indicators
 *
 * Supports two dev modes:
 * 1. Forced-state preview: ?devState=RESULT_CORRECT&devInput=CRANE
 *    - Returns snapshot for QC/screenshots
 *    - Uses real user state (CLANKTON balance, guess counts)
 *    - Requires LHAW_DEV_FORCE_STATE_ENABLED=true
 *
 * 2. Interactive dev mode: (no query params)
 *    - Returns fresh dev round with fixed solution
 *    - Uses real user state (CLANKTON balance, guess counts)
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

      console.log('🎮 Forced-state preview: Using real user state with synthetic round data');

      // Fetch real user state for accurate guess counts and CLANKTON bonus (Milestone 4.12)
      const dailyState = await getOrCreateDailyState(fid);
      const freeRemaining = getFreeGuessesRemaining(dailyState);

      // Generate and return snapshot with live ETH/USD price (Milestone 4.12)
      const snapshot = await synthesizeDevGameStateAsync({
        devState: devState as any,
        devInput: devInput as string | undefined,
        solution: getDevFixedSolution(),
        fid,
      });

      // Override user state with real values
      snapshot.userState.freeGuessesRemaining = freeRemaining;
      snapshot.userState.paidGuessesRemaining = dailyState.paidGuessCredits;
      snapshot.userState.totalGuessesRemaining = freeRemaining + dailyState.paidGuessCredits;
      snapshot.userState.clanktonBonusActive = dailyState.freeAllocatedClankton > 0;

      return res.status(200).json(snapshot);
    }

    // Check for interactive dev mode
    if (isDevModeEnabled()) {
      console.log('🎮 Dev mode: Using real user state with synthetic round data');

      // Fetch real user state for accurate guess counts and CLANKTON bonus (Milestone 4.12)
      const dailyState = await getOrCreateDailyState(fid);
      const freeRemaining = getFreeGuessesRemaining(dailyState);

      // Interactive dev mode: return fresh dev round with live ETH/USD price and real user state
      const devGameState = await synthesizeDevGameStateAsync({
        solution: getDevFixedSolution(),
        fid,
      });

      // Override user state with real values
      devGameState.userState.freeGuessesRemaining = freeRemaining;
      devGameState.userState.paidGuessesRemaining = dailyState.paidGuessCredits;
      devGameState.userState.totalGuessesRemaining = freeRemaining + dailyState.paidGuessCredits;
      devGameState.userState.clanktonBonusActive = dailyState.freeAllocatedClankton > 0;

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
      devMode: false,
    };

    return res.status(200).json(gameState);
  } catch (error: any) {
    console.error('Error in /api/game:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

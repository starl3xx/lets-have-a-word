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
 *    - Uses real user state ($WORD balance, guess counts)
 *    - Requires LHAW_DEV_FORCE_STATE_ENABLED=true
 *
 * 2. Interactive dev mode: (no query params)
 *    - Returns fresh dev round with fixed solution
 *    - Uses real user state ($WORD balance, guess counts)
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

      // Fetch real user state for accurate guess counts and $WORD bonus (Milestone 4.12)
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
      snapshot.userState.wordBonusActive = dailyState.freeAllocatedClankton > 0; // legacy DB column name

      return res.status(200).json(snapshot);
    }

    // Check for interactive dev mode
    if (isDevModeEnabled()) {
      console.log('🎮 Dev mode: Using real user state with synthetic round data');

      // Fetch real user state for accurate guess counts and $WORD bonus (Milestone 4.12)
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
      devGameState.userState.wordBonusActive = dailyState.freeAllocatedClankton > 0; // legacy DB column name

      return res.status(200).json(devGameState);
    }

    // DEV MODE ONLY, which is what this endpoint has always claimed to be.
    //
    // docs/GAME_DOCUMENTATION.md documents it as "GET /api/game (Dev Mode
    // Only)" and nothing in the app calls it — it returned 500 for six weeks
    // during the ETH-to-$WORD gap and nobody noticed. The production branch
    // that used to live here did not enforce that at all: it gated on
    // `isDevelopment = !process.env.NEYNAR_API_KEY` and refused only when a
    // devFid was ALSO absent, so in production anyone could pass
    // `?devFid=<someone else>` and read that player's free and paid guess
    // balances. `fid` came straight from that query parameter and was never
    // verified against anything.
    //
    // Low severity — a read, of numbers that are not secret — but an
    // unauthenticated read of another player's state, with no legitimate
    // production caller to break by closing it. Rather than leave the branch
    // unreachable behind a guard, it is gone: dev mode answers above, and
    // everything else is a 404.
    return res.status(404).json({ error: 'Not found' });
  } catch (error: any) {
    console.error('Error in /api/game:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

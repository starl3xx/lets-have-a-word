import type { NextApiRequest, NextApiResponse } from 'next';
import { ensureActiveRound } from '../../src/lib/rounds';
import { verifyFrameMessage, verifySigner } from '../../src/lib/farcaster';
import { upsertUserFromFarcaster } from '../../src/lib/users';
import { submitGuessWithDailyLimits } from '../../src/lib/daily-limits';
import type { SubmitGuessResult } from '../../src/types';
import { ensureDevMidRound } from '../../src/lib/devMidRound';
import {
  isDevModeEnabled,
  isForceStateEnabled,
  isValidDevBackendState,
  ensureDevRound,
} from '../../src/lib/devGameState';
import {
  checkUserQuality,
  logBlockedAttempt,
  INSUFFICIENT_USER_SCORE_ERROR,
  MIN_USER_SCORE,
} from '../../src/lib/user-quality';

/**
 * POST /api/guess
 *
 * Submit a guess for the current active round
 *
 * Milestone 2.1: Now uses Farcaster authentication
 * Milestone 2.2: Now enforces daily limits (free + paid guesses)
 * Milestone 4.8: Now supports dev mode with fixed solution and preview states
 * Milestone 6.5.1: Dev mode now uses real daily limits (same as production)
 *
 * Request body:
 * {
 *   "word": "CRANE",
 *   "frameMessage"?: "0x..." (for frame requests),
 *   "signerUuid"?: "uuid-..." (for mini app SDK),
 *   "ref"?: 12345 (optional referrer FID)
 * }
 *
 * For development (when NEYNAR_API_KEY not set):
 * {
 *   "word": "CRANE",
 *   "devFid": 12345 (bypasses Farcaster auth)
 * }
 *
 * For dev mode preview (Milestone 4.8):
 * {
 *   "word": "CRANE",
 *   "devState": "RESULT_CORRECT" | "RESULT_WRONG_VALID" | "OUT_OF_GUESSES",
 *   "devFid": 12345
 * }
 *
 * Response: SubmitGuessResult
 *   May return { status: 'no_guesses_left_today' } if user has no guesses remaining
 *
 * Dev Mode Behavior (Milestone 6.5.1):
 *   - Uses the same daily limits logic as production
 *   - Guesses consume from the same sources (free, CLANKTON, share, paid)
 *   - Share bonus only awarded after actual share via modal
 *   - Pack purchases work the same as production
 *   - Only difference: round uses a fixed solution (LHAW_DEV_FIXED_SOLUTION env var)
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SubmitGuessResult | { error: string }>
) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { word, frameMessage, signerUuid, ref, devFid, devState } = req.body;

    // Debug: Log environment variables (Milestone 4.8)
    console.log('🔍 Environment check:', {
      LHAW_DEV_MODE: process.env.LHAW_DEV_MODE,
      LHAW_DEV_FIXED_SOLUTION: process.env.LHAW_DEV_FIXED_SOLUTION,
      LHAW_DEV_FORCE_STATE_ENABLED: process.env.LHAW_DEV_FORCE_STATE_ENABLED,
      isDevModeEnabled: isDevModeEnabled(),
      isForceStateEnabled: isForceStateEnabled(),
    });

    // Validate request
    if (typeof word !== 'string' || !word) {
      return res.status(400).json({ error: 'Invalid request: word is required' });
    }

    // Normalize word to uppercase
    const normalizedWord = word.toUpperCase();

    // ========================================
    // Milestone 4.8: Dev Mode Early Check
    // ========================================
    // Check dev mode BEFORE any database operations

    // Determine FID early for dev mode
    // Accept devFid if either:
    // 1. NEYNAR_API_KEY is not set (local development)
    // 2. LHAW_DEV_MODE is enabled (Farcaster preview with dev mode)
    let fid: number;
    const isDevelopment = !process.env.NEYNAR_API_KEY || isDevModeEnabled();

    // For forced-state preview mode, handle immediately
    if (devState) {
      if (!isForceStateEnabled()) {
        return res.status(403).json({ error: 'Forced-state preview is disabled' });
      }

      if (!isValidDevBackendState(devState)) {
        return res.status(400).json({ error: 'Invalid devState value' });
      }

      // Get FID for response
      fid = isDevelopment && devFid ? (typeof devFid === 'number' ? devFid : parseInt(devFid, 10)) : 12345;

      // Return snapshot based on devState
      if (devState === 'RESULT_CORRECT') {
        return res.status(200).json({
          status: 'correct',
          word: normalizedWord,
          roundId: 999999,
          winnerFid: fid,
        });
      } else if (devState === 'RESULT_WRONG_VALID') {
        return res.status(200).json({
          status: 'incorrect',
          word: normalizedWord,
          totalGuessesForUserThisRound: 1,
        });
      } else if (devState === 'OUT_OF_GUESSES') {
        return res.status(200).json({
          status: 'no_guesses_left_today',
        });
      }
    }

    // ========================================
    // DEV MODE CRANE BYPASS - Guaranteed win for CRANE
    // ========================================
    // If dev mode is enabled and the word is CRANE (or fixed solution), return success immediately
    // This bypasses ALL database operations to guarantee the solution always wins
    const devFixedSolution = (process.env.LHAW_DEV_FIXED_SOLUTION || 'CRANE').toUpperCase();
    if (isDevModeEnabled() && normalizedWord === devFixedSolution) {
      const devFidValue = devFid ? (typeof devFid === 'number' ? devFid : parseInt(devFid, 10)) : 6500;
      console.log(`🎮 Dev mode: Correct guess! Returning instant win for FID ${devFidValue}`);
      return res.status(200).json({
        status: 'correct',
        word: devFixedSolution,
        roundId: 999999, // Fake round ID for dev mode
        winnerFid: devFidValue,
      });
    }

    // ========================================
    // Milestone 6.5.1: Dev Mode Guess Economy Parity
    // ========================================
    // Dev mode tries to use the same daily limits logic as production.
    // If database is unavailable, falls back to offline mock responses.

    // Milestone 4.5: Ensure dev mid-round test mode is initialized (dev only, no-op in prod)
    await ensureDevMidRound();

    // Ensure there's an active round
    let roundId: number | undefined;
    let useOfflineDevMode = false;

    if (isDevModeEnabled()) {
      // In dev mode, try to ensure a round exists with the fixed solution
      console.log('🎮 Dev mode: Attempting to use real daily limits with fixed solution round');
      try {
        roundId = await ensureDevRound();
        console.log(`🎮 Dev mode: ensureDevRound succeeded, roundId=${roundId}`);
      } catch (devRoundError: any) {
        // Database unavailable - fall back to offline dev mode
        console.warn('🎮 Dev mode: Database unavailable, using offline mode');
        console.warn('🎮 Dev mode: Error was:', devRoundError.message);
        useOfflineDevMode = true;
      }
    } else {
      // Production: create a normal round if needed
      await ensureActiveRound();
    }

    // ========================================
    // DEV MODE OFFLINE FALLBACK
    // ========================================
    // When database is unavailable in dev mode, return mock responses
    if (useOfflineDevMode) {
      const devFidValue = devFid ? (typeof devFid === 'number' ? devFid : parseInt(devFid, 10)) : 6500;
      console.log(`🎮 Dev mode offline: Returning mock incorrect response for "${normalizedWord}"`);
      console.log(`🎮 Dev mode offline: (Guess "${devFixedSolution}" to win)`);
      return res.status(200).json({
        status: 'incorrect',
        word: normalizedWord,
        totalGuessesForUserThisRound: 1,
      });
    }

    let signerWallet: string | null = null;
    let spamScore: number | null = null;

    if (isDevelopment && devFid) {
      // Development mode: allow explicit FID for testing
      fid = typeof devFid === 'number' ? devFid : parseInt(devFid, 10);
      console.log(`⚠️  Development mode: using devFid ${fid}`);
    } else {
      // Production mode: require Farcaster authentication

      // Verify Farcaster request and extract user context
      let farcasterContext;

      if (frameMessage) {
        // Frame request (from Warpcast or other frame clients)
        try {
          farcasterContext = await verifyFrameMessage(frameMessage);
        } catch (error: any) {
          console.error('Frame verification failed:', error);
          return res.status(401).json({ error: 'Invalid Farcaster frame signature' });
        }
      } else if (signerUuid) {
        // Mini app SDK request (using Farcaster SDK signer)
        try {
          farcasterContext = await verifySigner(signerUuid);
        } catch (error: any) {
          console.error('Signer verification failed:', error);
          return res.status(401).json({ error: 'Invalid Farcaster signer' });
        }
      } else {
        return res.status(400).json({
          error: 'Authentication required: provide frameMessage or signerUuid (or devFid in development)',
        });
      }

      fid = farcasterContext.fid;
      signerWallet = farcasterContext.signerWallet;
      spamScore = farcasterContext.spamScore;

      // Parse referral parameter
      const referrerFid = ref ? (typeof ref === 'number' ? ref : parseInt(ref, 10)) : null;

      // Upsert user with Farcaster data
      await upsertUserFromFarcaster({
        fid,
        signerWallet,
        spamScore,
        referrerFid,
      });

      // Milestone 5.3: Check user quality score for anti-bot protection
      // Skip in development mode
      if (process.env.USER_QUALITY_GATING_ENABLED === 'true') {
        const qualityCheck = await checkUserQuality(fid);

        if (!qualityCheck.eligible) {
          // Log the blocked attempt
          await logBlockedAttempt(fid, qualityCheck.score, 'guess');

          return res.status(403).json({
            error: qualityCheck.errorCode || INSUFFICIENT_USER_SCORE_ERROR,
            message: qualityCheck.reason || `User quality score below minimum (${MIN_USER_SCORE})`,
            score: qualityCheck.score,
            minRequired: MIN_USER_SCORE,
            helpUrl: qualityCheck.helpUrl,
          } as any);
        }
      }
    }

    // Submit the guess with daily limits enforcement (Milestone 2.2)
    console.log(`📝 Submitting guess: FID=${fid}, word=${normalizedWord}`);
    try {
      const result = await submitGuessWithDailyLimits({
        fid,
        word,
      });
      console.log(`📝 Guess result:`, result);

      // Return the result
      return res.status(200).json(result);
    } catch (submitError: any) {
      console.error('📝 submitGuessWithDailyLimits FAILED:', submitError);
      console.error('📝 Stack trace:', submitError.stack);
      throw submitError;
    }

  } catch (error: any) {
    console.error('Error in /api/guess:', error);
    console.error('Error stack:', error.stack);

    // In dev mode, return more detailed error info
    if (isDevModeEnabled()) {
      return res.status(500).json({
        error: 'Internal server error',
        devDetails: error.message,
        devStack: error.stack?.split('\n').slice(0, 5).join('\n'),
      } as any);
    }

    return res.status(500).json({ error: 'Internal server error' });
  }
}

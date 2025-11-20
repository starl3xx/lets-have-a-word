import type { NextApiRequest, NextApiResponse } from 'next';
import { ensureActiveRound } from '../../src/lib/rounds';
import { verifyFrameMessage, verifySigner } from '../../src/lib/farcaster';
import { upsertUserFromFarcaster } from '../../src/lib/users';
import { submitGuessWithDailyLimits } from '../../src/lib/daily-limits';
import type { SubmitGuessResult } from '../../src/types';
import { ensureDevMidRound } from '../../src/lib/devMidRound';
import {
  isDevModeEnabled,
  getDevFixedSolution,
  isForceStateEnabled,
  isValidDevBackendState,
} from '../../src/lib/devGameState';
import { isValidGuess } from '../../src/lib/word-lists';

/**
 * POST /api/guess
 *
 * Submit a guess for the current active round
 *
 * Milestone 2.1: Now uses Farcaster authentication
 * Milestone 2.2: Now enforces daily limits (free + paid guesses)
 * Milestone 4.8: Now supports dev mode with fixed solution and preview states
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

    // Validate request
    if (typeof word !== 'string' || !word) {
      return res.status(400).json({ error: 'Invalid request: word is required' });
    }

    // Normalize word to uppercase
    const normalizedWord = word.toUpperCase();

    // Milestone 4.5: Ensure dev mid-round test mode is initialized (dev only, no-op in prod)
    await ensureDevMidRound();

    // Ensure there's an active round (create one if needed)
    await ensureActiveRound();

    let fid: number;
    let signerWallet: string | null = null;
    let spamScore: number | null = null;

    // Check if we're in development mode (no Neynar API key)
    const isDevelopment = !process.env.NEYNAR_API_KEY;

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
    }

    // ========================================
    // Milestone 4.8: Dev Mode Handling
    // ========================================

    // Check for forced-state preview mode (devState in request)
    if (devState) {
      if (!isForceStateEnabled()) {
        return res.status(403).json({ error: 'Forced-state preview is disabled' });
      }

      if (!isValidDevBackendState(devState)) {
        return res.status(400).json({ error: 'Invalid devState value' });
      }

      // Return snapshot based on devState
      // Map devState to SubmitGuessResult
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

    // Check for interactive dev mode (no onchain, fixed solution)
    if (isDevModeEnabled()) {
      console.log('🎮 Dev mode: Processing guess interactively');

      // Validate word format
      if (normalizedWord.length !== 5) {
        return res.status(200).json({
          status: 'invalid_word',
          reason: 'not_5_letters',
        });
      }

      if (!/^[A-Z]+$/.test(normalizedWord)) {
        return res.status(200).json({
          status: 'invalid_word',
          reason: 'non_alpha',
        });
      }

      // Check if word is in valid guess list
      if (!isValidGuess(normalizedWord)) {
        return res.status(200).json({
          status: 'invalid_word',
          reason: 'not_in_dictionary',
        });
      }

      // Compare against fixed solution
      const solution = getDevFixedSolution();

      if (normalizedWord === solution) {
        // Correct guess!
        console.log(`✅ Dev mode: Correct guess! ${normalizedWord} === ${solution}`);
        return res.status(200).json({
          status: 'correct',
          word: normalizedWord,
          roundId: 999999,
          winnerFid: fid,
        });
      } else {
        // Incorrect guess
        console.log(`❌ Dev mode: Incorrect guess. ${normalizedWord} !== ${solution}`);
        return res.status(200).json({
          status: 'incorrect',
          word: normalizedWord,
          totalGuessesForUserThisRound: 1, // In dev mode, we don't track actual count
        });
      }
    }

    // ========================================
    // Production Mode: Database & Onchain
    // ========================================

    // Submit the guess with daily limits enforcement (Milestone 2.2)
    const result = await submitGuessWithDailyLimits({
      fid,
      word,
    });

    // Return the result
    return res.status(200).json(result);

  } catch (error: any) {
    console.error('Error in /api/guess:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
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
import { applyGameplayGuard } from '../../src/lib/operational-guard';
import {
  checkGuessRateLimit,
  checkDuplicateGuess,
  extractRequestMetadata,
} from '../../src/lib/rateLimit';
import { AppErrorCodes } from '../../src/lib/appErrors';

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
    const { word, frameMessage, signerUuid, ref, devFid, devState, miniAppFid } = req.body;

    // Debug: Log referral parameter from request body
    console.log(`[Referral] Backend received ref=${ref} (type: ${typeof ref}) from request body`);

    // Extract request metadata for rate limiting
    const { fid: metadataFid, ip, userAgent } = extractRequestMetadata(req);
    const rateLimitFid = miniAppFid || devFid || metadataFid;

    // Milestone 9.6: Conservative rate limiting (8/10s burst, 30/60s sustained)
    // Runs BEFORE any DB operations to fail fast and cheap
    const rateCheck = await checkGuessRateLimit(rateLimitFid, ip, userAgent);
    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', rateCheck.retryAfterSeconds?.toString() || '10');
      return res.status(429).json({
        ok: false,
        error: AppErrorCodes.RATE_LIMITED,
        message: 'Too fast — try again in a moment',
        retryAfterSeconds: rateCheck.retryAfterSeconds,
      });
    }

    // Milestone 9.5: Check operational guard (kill switch / dead day)
    const guardBlocked = await applyGameplayGuard(req, res);
    if (guardBlocked) return;

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
    console.log(`📝 [guess] Step 1: Word validated and normalized: ${normalizedWord}`);

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
    console.log(`📝 [guess] Step 2: About to call ensureDevMidRound (isDevelopment=${isDevelopment})`);
    await ensureDevMidRound();
    console.log(`📝 [guess] Step 3: ensureDevMidRound completed`);

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
      console.log(`📝 [guess] Step 4: Production mode - calling ensureActiveRound`);
      await ensureActiveRound();
      console.log(`📝 [guess] Step 5: ensureActiveRound completed`);
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
    } else if (isDevModeEnabled()) {
      // Dev mode enabled but no devFid provided - use default FID
      // This allows the web UI to work in dev mode without requiring auth
      fid = 6500; // Default dev FID
      console.log(`🎮 Dev mode: Using default FID ${fid} (no devFid in request)`);
    } else if (miniAppFid) {
      // SECURITY: miniAppFid from client cannot be trusted without verification
      // The Farcaster SDK context is client-side only - anyone can spoof this value
      // TODO: Implement proper SIWF (Sign In With Farcaster) authentication
      // For now, reject unverified miniAppFid requests
      console.error(`🚨 SECURITY: Rejected unverified miniAppFid=${miniAppFid}. Require frameMessage or signerUuid.`);
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Please sign in with Farcaster to play. Refresh the app and try again.',
      });
    } else {
      // Production mode: require Farcaster authentication
      console.log(`📝 [guess] Step 6: Production auth - frameMessage=${!!frameMessage}, signerUuid=${!!signerUuid}`);

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
          error: 'Authentication required: provide frameMessage or signerUuid',
        });
      }

      fid = farcasterContext.fid;
      // Priority: primary wallet > signer wallet (verified addresses)
      signerWallet = farcasterContext.primaryWallet || farcasterContext.signerWallet;
      spamScore = farcasterContext.spamScore;

      // Milestone 9.2: Set Sentry user context for error tracking
      Sentry.setUser({ id: fid.toString(), username: `fid:${fid}` });
      Sentry.setTag('wallet', signerWallet || 'unknown');

      // Parse referral parameter
      const referrerFid = ref ? (typeof ref === 'number' ? ref : parseInt(ref, 10)) : null;
      console.log(`[Referral] Frame/signer auth: parsed referrerFid=${referrerFid} from ref=${ref} for FID ${fid}`);

      // Upsert user with Farcaster data
      console.log(`[Referral] Calling upsertUserFromFarcaster with referrerFid=${referrerFid}`);
      await upsertUserFromFarcaster({
        fid,
        signerWallet,
        spamScore,
        referrerFid,
      });
    }

    // Milestone 5.3: Check user quality score for anti-bot protection
    // Skip in development mode - applies to ALL auth paths (miniApp, frame, signer)
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

    // Milestone 9.6: Check for duplicate submission (same FID + same word within 10s)
    // This catches accidental double-submits and flaky network retries
    const duplicateCheck = await checkDuplicateGuess(fid, normalizedWord);
    if (duplicateCheck.isDuplicate) {
      console.log(`📝 Duplicate guess ignored: FID=${fid}, word=${normalizedWord}`);
      // Return a soft success - don't penalize the user, don't consume credits
      // The guess was already processed, so we return as if it succeeded
      return res.status(200).json({
        status: 'duplicate_ignored',
        message: 'Guess already submitted',
        word: normalizedWord,
      } as any);
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

    // Milestone 9.2: Report to Sentry with context
    Sentry.captureException(error, {
      tags: { endpoint: 'guess' },
      extra: {
        word: req.body?.word,
        hasFrameMessage: !!req.body?.frameMessage,
        hasSignerUuid: !!req.body?.signerUuid,
        devMode: isDevModeEnabled(),
      },
    });

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

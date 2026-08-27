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
import {
  checkAccountAge,
  logBlockedAccountAgeAttempt,
  ACCOUNT_TOO_NEW_ERROR,
} from '../../src/lib/account-age';
import {
  checkWalletHistory,
  logBlockedWalletHistoryAttempt,
  WALLET_TOO_FRESH_ERROR,
} from '../../src/lib/wallet-history';
import {
  checkWalletCluster,
  logBlockedWalletClusterAttempt,
  WALLET_IN_BOT_CLUSTER_ERROR,
} from '../../src/lib/wallet-cluster';
import { applyGameplayGuard } from '../../src/lib/operational-guard';
import {
  checkGuessRateLimit,
  checkDuplicateGuess,
  clearDuplicateGuess,
  markDuplicateProcessed,
  extractRequestMetadata,
} from '../../src/lib/rateLimit';
import { guessWasRecorded } from '../../src/lib/guesses';
import { AppErrorCodes } from '../../src/lib/appErrors';
import { resolveRequestFid } from '../../src/lib/requestAuth';
import { PLAYER_SESSION_COOKIE, PLAYER_SESSION_HEADER } from '../../src/lib/playerSession';

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
 *   - Guesses consume from the same sources (free, $WORD, share, paid)
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
    // authToken and miniAppFid are read by resolveRequestFid straight off the
    // request; they are not destructured here because nothing else uses them.
    const { word, frameMessage, signerUuid, ref, devFid, devState } = req.body;

    // Debug: Log referral parameter from request body
    console.log(`[Referral] Backend received ref=${ref} (type: ${typeof ref}) from request body`);

    // Extract request metadata for rate limiting
    const { fid: metadataFid, ip, userAgent } = extractRequestMetadata(req);
    // For SIWF, we don't have FID until verified, so use other identifiers for initial rate limit
    const rateLimitFid = devFid || metadataFid;

    // Milestone 9.6: Conservative rate limiting (8/10s burst, 30/60s sustained)
    // Runs BEFORE any DB operations to fail fast and cheap
    // Note: Superguessers are NOT exempt — 8/10s burst is generous enough
    // for the ~1 guess/24s average pace of a 25-guess, 10-minute window
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

    // Dev mode, Quick Auth, the unverified-miniAppFid refusal and the
    // wallet-native player session all live in resolveRequestFid now, in that
    // order — the same order this block used to spell out inline. The only
    // addition is the session, which slots in AFTER the miniAppFid refusal so
    // that branch keeps its exact previous behaviour (a Base App client never
    // sends miniAppFid, so it costs wallet players nothing).
    //
    // The dev path is gated on NEXT_PUBLIC_LHAW_DEV_MODE alone. It used to be
    // widened by `isDevelopment`, which is `|| !process.env.NEYNAR_API_KEY` —
    // meaning one unset variable would have let any caller authenticate as any
    // FID by putting it in the body. See the note in requestAuth.ts.
    const auth = await resolveRequestFid(req, {
      rejectUnverifiedMiniAppFid: true,
    });

    if (auth.ok) {
      fid = auth.fid;

      if (auth.origin === 'dev') {
        console.log(`⚠️  Development mode: using FID ${fid}`);
      } else if (auth.origin === 'quick_auth') {
        console.log(`📱 [QuickAuth] Verified FID ${fid}`);
        Sentry.setUser({ id: fid.toString(), username: `fid:${fid}` });
        Sentry.setTag('auth_type', 'quick_auth');

        const referrerFid = ref ? (typeof ref === 'number' ? ref : parseInt(ref, 10)) : null;
        console.log(`[Referral] QuickAuth: parsed referrerFid=${referrerFid} from ref=${ref} for FID ${fid}`);

        await upsertUserFromFarcaster({
          fid,
          signerWallet: null,
          spamScore: null,
          referrerFid,
        });
      } else {
        // Wallet-native player. No upsert: /api/auth/siwe already created or
        // linked the row before it minted the session, and re-upserting here
        // would need an FID-shaped identity this player does not have.
        console.log(`🪪 [PlayerSession] Verified FID ${fid} (${auth.playerOrigin})`);
        Sentry.setUser({ id: fid.toString(), username: `fid:${fid}` });
        Sentry.setTag('auth_type', 'player_session');
        if (auth.provenWallet) Sentry.setTag('wallet', auth.provenWallet);
      }
    } else if (auth.reason !== 'no_credential') {
      // A credential was presented and was bad, or an unverified miniAppFid was
      // presented. Neither may fall through to frame/signer.
      return res.status(auth.status).json({ error: auth.error, message: auth.message });
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
        // NO CREDENTIAL OF ANY KIND.
        //
        // This message was written when every player was a Farcaster player and
        // the only ways in were a frame message or a signer. A wallet-native
        // player whose session cookie is missing or expired lands here too, and
        // telling them to "provide frameMessage or signerUuid" is meaningless —
        // the client cannot recognise it either, so it renders as "Something
        // went wrong", which is how a Base App sign-in problem looked
        // indistinguishable from a server fault.
        //
        // Reported to Sentry because this is now the signature of a lost
        // session, not just a malformed request.
        //
        // The extras answer the questions 2026-08-27 could not: did a session
        // token arrive at all (header or cookie), was one presented and
        // refused, and WHICH CLIENT BUILD sent the request — a Base App
        // webview can resume a bundle from days before the current deploy.
        const cookieHeader = req.headers?.cookie ?? '';
        const noCredentialExtra = {
          hasCookieHeader: !!req.headers?.cookie,
          hasPlayerSessionCookie: cookieHeader
            .split(';')
            .some((p) => p.trim().startsWith(`${PLAYER_SESSION_COOKIE}=`)),
          hasPlayerSessionHeader: !!req.headers?.[PLAYER_SESSION_HEADER],
          clientBuild: req.headers?.['x-lhaw-build'] ?? null,
          hasFrameMessage: !!frameMessage,
          hasSignerUuid: !!signerUuid,
          userAgent: req.headers?.['user-agent'],
        };
        if (auth.presentedSessionToken) {
          // A real session was presented and refused — the lost-session
          // signature, and the event worth guaranteeing. Flushed before
          // responding, because in a serverless function the runtime can
          // freeze the instant the response is sent, which is how the only
          // diagnostic event of 2026-08-27 appears to have been lost. The
          // flush is safe to await here precisely because producing this
          // event requires having held a session: a zero-credential caller
          // cannot reach it, so it cannot be farmed into a 2s-per-request
          // hold or a Sentry quota burn.
          Sentry.captureMessage('[Guess] Session token presented but refused', {
            level: 'warning',
            extra: noCredentialExtra,
          });
          await Sentry.flush(2000).catch(() => {});
        } else {
          // Nothing presented at all: bots and malformed callers can hit this
          // at line rate with no credential, so it stays fire-and-forget.
          Sentry.captureMessage('[Guess] No credential presented', {
            level: 'warning',
            extra: noCredentialExtra,
          });
        }
        return res.status(401).json({
          error: AppErrorCodes.AUTHENTICATION_REQUIRED,
          message: 'Your session has expired. Sign in again to keep playing.',
        });
      }

      fid = farcasterContext.fid;
      // Priority: primary wallet > signer wallet (verified addresses)
      signerWallet = farcasterContext.primaryWallet || farcasterContext.signerWallet;
      spamScore = farcasterContext.spamScore;
      const username = farcasterContext.username;

      // Milestone 9.2: Set Sentry user context for error tracking
      Sentry.setUser({ id: fid.toString(), username: username || `fid:${fid}` });
      Sentry.setTag('wallet', signerWallet || 'unknown');

      // Parse referral parameter
      const referrerFid = ref ? (typeof ref === 'number' ? ref : parseInt(ref, 10)) : null;
      console.log(`[Referral] Frame/signer auth: parsed referrerFid=${referrerFid} from ref=${ref} for FID ${fid}`);

      // Upsert user with Farcaster data (including username from Neynar)
      console.log(`[Referral] Calling upsertUserFromFarcaster with username=${username}, referrerFid=${referrerFid}`);
      await upsertUserFromFarcaster({
        fid,
        username,
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

    // Post-Round-28 sybil defense: gate on Farcaster FID registration age.
    // Quality score rubber-stamps normal-looking fresh accounts — age is the
    // orthogonal signal that actually blocks coordinated farming ops.
    if (process.env.ACCOUNT_AGE_GATING_ENABLED === 'true') {
      const ageCheck = await checkAccountAge(fid);

      if (!ageCheck.eligible) {
        await logBlockedAccountAgeAttempt(fid, ageCheck, 'guess');

        return res.status(403).json({
          error: ageCheck.errorCode || ACCOUNT_TOO_NEW_ERROR,
          message: ageCheck.reason || 'Account too new',
          registeredAt: ageCheck.registeredAt?.toISOString() ?? null,
          ageDays: ageCheck.ageDays,
          daysUntilEligible: ageCheck.daysUntilEligible,
        } as any);
      }
    }

    // Post-Round-29 sybil defense: gate on connected-wallet onchain activity.
    // Round 28/29 farming wallets all clustered at 8–12 Base txs and ~$0.01
    // ETH — the cost-floor footprint of a Coinbase Smart Wallet that was
    // deployed, registered a basename, and added a Farcaster signer, never
    // used for anything else. Real player wallets sit at hundreds-to-thousands
    // of txs. Two-orders-of-magnitude separation makes this a clean filter.
    if (process.env.WALLET_HISTORY_GATING_ENABLED === 'true') {
      const walletCheck = await checkWalletHistory(fid);

      if (!walletCheck.eligible) {
        await logBlockedWalletHistoryAttempt(fid, walletCheck, 'guess');

        return res.status(403).json({
          error: walletCheck.errorCode || WALLET_TOO_FRESH_ERROR,
          message: walletCheck.reason || 'Wallet too fresh',
          txCount: walletCheck.txCount,
        } as any);
      }
    }

    // Wallet-cluster gate: catches the R28/R29 fingerprint of `.base.eth`
    // wallets co-deployed in tight time windows. Per the empirical 168-user
    // sample, real LHAW players have wallet-deployment timestamps spread
    // across months; bot batches show 5–22 wallets within a 1-hour window.
    // Scoped to `.base.eth` users with low score so the signal doesn't
    // touch pure Farcaster/Warpcast users (who have no Base activity by
    // design) or established/high-score users.
    if (process.env.WALLET_CLUSTER_GATING_ENABLED === 'true') {
      const clusterCheck = await checkWalletCluster(fid);

      if (!clusterCheck.eligible) {
        await logBlockedWalletClusterAttempt(fid, clusterCheck, 'guess');

        return res.status(403).json({
          error: clusterCheck.errorCode || WALLET_IN_BOT_CLUSTER_ERROR,
          message: clusterCheck.reason || 'Account flagged for review',
          clusterSize: clusterCheck.clusterSize,
        } as any);
      }
    }

    // Reward gate (round 34+): hold or stake the play bar in $WORD, unless
    // grandfathered. Runs after the identity gates and covers FREE and PAID
    // guessing alike — the allocation floor alone would let paid credits
    // through, and there is deliberately no pack bypass. Uses the round's
    // frozen seed price for the bar and the 5-minute cache for the read.
    {
      const { checkPlayEligibility, isRewardGateEnabled } = await import('../../src/lib/reward-gate');
      if (isRewardGateEnabled()) {
        const { getActiveRound } = await import('../../src/lib/rounds');
        const activeRound = await getActiveRound().catch(() => null);
        const gate = await checkPlayEligibility(fid, {
          round: activeRound,
          useCache: true,
        });
        if (!gate.eligible) {
          console.log(
            `🚧 [RewardGate] Guess blocked: FID=${fid}, reason=${gate.reason}, bar=${gate.barTokens}`
          );
          return res.status(403).json({
            error: 'REWARD_GATE_LOCKED',
            message: 'Playing needs about $3 of $WORD, held or staked.',
            reason: gate.reason,
            barTokens: gate.barTokens,
          } as any);
        }
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

      // Close out the duplicate claim taken above. Keeping it absorbs retries
      // for the rest of the window; releasing it lets a retry do real work.
      // Left open, the claim would swallow the player's next attempt at this
      // word for 30 seconds and show them nothing.
      if (guessWasRecorded(result)) {
        await markDuplicateProcessed(fid, normalizedWord);
      } else {
        await clearDuplicateGuess(fid, normalizedWord);
      }

      // Return the result
      return res.status(200).json(result);
    } catch (submitError: any) {
      console.error('📝 submitGuessWithDailyLimits FAILED:', submitError);
      console.error('📝 Stack trace:', submitError.stack);

      // Nothing was recorded, so the retry must be allowed through. This is the
      // case the old code got wrong: it held the claim, the client retried
      // after the 12s frontend timeout, and got a silent `duplicate_ignored`
      // for a guess that had never been written.
      await clearDuplicateGuess(fid, normalizedWord);
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

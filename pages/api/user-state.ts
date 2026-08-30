/**
 * User State API
 * Milestone 4.1
 *
 * Returns user's daily guess allocations and $WORD bonus status
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
import { getOrCreateDailyState, getFreeGuessesRemaining, getOrGenerateWheelStartIndex, getGuessSourceState, getWordBonusTierForConnectedWallet, resetDevDailyStateForUser, DEV_MODE_FID } from '../../src/lib/daily-limits';
import type { GuessSourceState } from '../../src/types';
import { verifyFrameMessage, getUserByFid, type FarcasterContext } from '../../src/lib/farcaster';

/**
 * Is `wallet` an address Neynar says this FID actually owns?
 *
 * The FID reaching this endpoint is asserted by the caller and not
 * authenticated, so a client-supplied wallet cannot be trusted on its own.
 * Neynar's verified-address list (plus the custody address) is the
 * authoritative answer to "does this account own this wallet", and it is not
 * something a caller can influence.
 *
 * Returns false when Neynar data is unavailable — failing closed here only
 * means a wallet is not updated, whereas failing open would leave the
 * payout-redirect hole open whenever the lookup happens to error.
 */
function isWalletOwnedByFid(
  wallet: string | null,
  user: FarcasterContext | null
): boolean {
  if (!wallet || !user) return false;
  const w = wallet.toLowerCase();
  return (
    user.primaryWallet?.toLowerCase() === w ||
    user.signerWallet?.toLowerCase() === w ||
    user.custodyAddress?.toLowerCase() === w ||
    (user.verifiedAddresses ?? []).includes(w)
  );
}
import { getGuessWords } from '../../src/lib/word-lists';
import { db } from '../../src/db';
import { users } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { isDevModeEnabled, getDevUserId } from '../../src/lib/devGameState';
import { isSuperguessFeatureEnabled, getActiveSuperguess } from '../../src/lib/superguess';
import { getActiveRound as getActiveRoundForSuperguess } from '../../src/lib/rounds';

export interface UserStateResponse {
  fid: number;
  freeGuessesRemaining: number;
  paidGuessesRemaining: number;
  totalGuessesRemaining: number;
  wordBonusActive: boolean;
  freeAllocations: {
    base: number;
    wordToken: number; // Legacy DB column: free_allocated_clankton
    shareBonus: number;
  };
  paidPacksPurchased: number;
  maxPaidPacksPerDay: number;
  canBuyMorePacks: boolean;
  wheelStartIndex: number | null; // Milestone 4.14: Per-user random wheel start position
  // Milestone 6.3: New fields
  hasSharedToday: boolean; // Whether user has already claimed share bonus today
  isWordTokenHolder: boolean; // Whether user holds $WORD tokens
  wordBonusTier: number; // Milestone 14: 0-3 holder tier
  // Milestone 6.5: Source-level tracking for unified guess bar
  sourceState: GuessSourceState;
  // Milestone 15: Superguess status
  isSuperguessing: boolean;
  // Round 34+ reward gate. enabled=false until the launch flag flips;
  // locked=true means the player must hold/stake the bar to play.
  rewardGate: { enabled: boolean; locked: boolean; grandfathered: boolean };
}

interface ErrorResponse {
  error: string;
  details?: string;
  hasNeynarKey?: boolean;
  hasDatabaseUrl?: boolean;
  stack?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<UserStateResponse | ErrorResponse>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('[user-state] API called with query params:', req.query);
  console.log('[user-state] Environment check:', {
    hasNeynarKey: !!process.env.NEYNAR_API_KEY,
    hasDatabaseUrl: !!process.env.DATABASE_URL,
    nodeEnv: process.env.NODE_ENV,
  });

  try {
    // Get FID from query params or frame message
    let fid: number | null = null;
    let walletAddress: string | null = null;

    // Check for wallet address (from Wagmi connection)
    if (req.query.walletAddress) {
      walletAddress = req.query.walletAddress as string;
      console.log(`[user-state] Using connected wallet: ${walletAddress}`);
    }

    // Check for referral parameter
    let referrerFid: number | null = null;
    if (req.query.ref) {
      const refParam = parseInt(req.query.ref as string, 10);
      if (!isNaN(refParam) && refParam > 0) {
        referrerFid = refParam;
        console.log(`[Referral] user-state received ref=${referrerFid}`);
      }
    }

    // Check for devFid (development mode)
    if (req.query.devFid) {
      fid = parseInt(req.query.devFid as string, 10);
      console.log(`[user-state] Using dev FID: ${fid}`);
    }
    // Check for frameMessage (Farcaster production)
    else if (req.query.frameMessage) {
      const frameMessage = req.query.frameMessage as string;
      const frameData = await verifyFrameMessage(frameMessage);
      if (frameData) {
        fid = frameData.fid;
        console.log(`[user-state] Using Farcaster FID from frame: ${fid}`);
      }
    }

    if (!fid) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Milestone 4.12: Dev mode now uses real wallet data for $WORD bonus
    // No longer returns synthetic data - falls through to real implementation
    const isDevMode = isDevModeEnabled();
    if (isDevMode) {
      console.log('🎮 Dev mode: Using real wallet and $WORD balance');

      // Milestone 6.5.1: Reset daily state for dev FID on initial page load only
      // IMPORTANT: Only reset when initialLoad=true query param is passed
      // This prevents resetting on every API call which would wipe share bonuses
      const isInitialLoad = req.query.initialLoad === 'true';
      if (fid === DEV_MODE_FID && isInitialLoad) {
        console.log(`🔄 Dev mode: Resetting daily state for dev FID ${fid} (initial page load)`);
        await resetDevDailyStateForUser(fid);
      }
    }

    // Production mode: Ensure user exists in database
    // If not, fetch from Neynar and create record
    console.log(`[user-state] Checking if user ${fid} exists...`);
    let existingUser;
    try {
      existingUser = await db
        .select()
        .from(users)
        .where(eq(users.fid, fid))
        .limit(1);
      console.log(`[user-state] Database query successful, found ${existingUser.length} users`);
    } catch (dbError) {
      console.error('[user-state] Database query failed:', dbError);
      throw new Error(`Database error: ${dbError instanceof Error ? dbError.message : 'Unknown'}`);
    }

    if (existingUser.length === 0) {
      console.log(`[user-state] User ${fid} not found, fetching from Neynar...`);

      // Fetch user data from Neynar
      let farcasterUser;
      const hasNeynarKey = !!process.env.NEYNAR_API_KEY;

      if (hasNeynarKey) {
        try {
          farcasterUser = await getUserByFid(fid);
          console.log(`[user-state] Neynar API returned user:`, farcasterUser?.username || 'null');
        } catch (neynarError) {
          console.error('[user-state] Neynar API failed:', neynarError);
          console.log('[user-state] Falling back to minimal user creation');
          farcasterUser = null;
        }
      } else {
        console.log('[user-state] NEYNAR_API_KEY not set, creating minimal user record');
        farcasterUser = null;
      }

      // Create user record.
      //
      // Prefer a wallet Neynar confirms this FID owns, then Neynar's own
      // primary/signer address, and only then the unverified client-supplied
      // one. Unlike the update path below this stays permissive on purpose:
      // a brand-new record has no winnings to redirect, and refusing outright
      // would leave users with no verified Farcaster address unable to be paid
      // at all. If a record is ever pre-created with the wrong wallet, the
      // owner's next visit overwrites it via the verified path below.
      const verifiedClientWallet = isWalletOwnedByFid(walletAddress, farcasterUser)
        ? walletAddress
        : null;

      // Fall back to the custody address before ever accepting an unverified
      // client wallet. Every real Farcaster account has one and it comes from
      // Neynar, so whenever Neynar knows this FID there is always a trustworthy
      // value available. Skipping it would let an attacker pre-create a record
      // for any FID that happens to have no primary/signer address, planting
      // their own wallet — and the fail-closed update path below would then
      // stop the real owner from correcting it.
      const userWallet =
        verifiedClientWallet ||
        farcasterUser?.primaryWallet ||
        farcasterUser?.signerWallet ||
        farcasterUser?.custodyAddress ||
        // Only when Neynar has no record of this FID at all is there nothing
        // better to use — and an FID Neynar does not know has no winnings to
        // redirect.
        (farcasterUser ? null : walletAddress) ||
        null;

      if (walletAddress && !verifiedClientWallet) {
        console.warn(
          `[user-state] New FID ${fid}: ${walletAddress} is not Neynar-verified; using ${userWallet ?? 'no'} address instead`
        );
      }
      const username = farcasterUser?.username || `user-${fid}`;

      // Validate referrer (cannot refer yourself)
      const validReferrerFid = referrerFid && referrerFid !== fid ? referrerFid : null;
      if (referrerFid && validReferrerFid === null && referrerFid === fid) {
        console.log(`[Referral] Self-referral blocked: fid=${fid}`);
      }

      console.log(`[user-state] Creating user ${fid} with wallet ${userWallet || 'null'}, referrerFid=${validReferrerFid}`);
      try {
        await db.insert(users).values({
          fid,
          username,
          signerWalletAddress: userWallet,
          custodyAddress: farcasterUser?.custodyAddress || null,
          spamScore: farcasterUser?.spamScore || 0,
          referrerFid: validReferrerFid,
        }).onConflictDoNothing();
        if (validReferrerFid) {
          console.log(`[Referral] ✅ Created new user FID ${fid} with referrer FID ${validReferrerFid}`);
        } else {
          console.log(`[user-state] User ${fid} created successfully`);
        }
      } catch (insertError) {
        console.error('[user-state] User insert failed:', insertError);
        throw new Error(`Database insert error: ${insertError instanceof Error ? insertError.message : 'Unknown'}`);
      }
      // Case-INSENSITIVE, because an address is the same address whatever its
      // casing. The column holds both checksummed (Neynar) and lowercased
      // (ours) forms, so a strict !== read a wallet-native player's own
      // checksummed address as an attempted CHANGE on every poll: a Neynar
      // lookup for an FID Neynar has never heard of, a refusal, and a Sentry
      // warning, several times a minute (2026-08-27).
    } else if (
      walletAddress &&
      existingUser[0].signerWalletAddress?.toLowerCase() !== walletAddress.toLowerCase()
    ) {
      // SECURITY: signer_wallet_address decides where money is sent —
      // getWinnerPayoutAddress() resolves through it for the ETH jackpot and
      // economics.ts reads it for top-10 $WORD rewards. The FID here is
      // asserted by the caller (req.query.devFid) and is not authenticated, so
      // an unverified overwrite would let anyone redirect another user's
      // winnings to a wallet of their choosing.
      //
      // Only accept a wallet Neynar confirms this FID has verified. Neynar is
      // the authority on account ownership and is not client-controlled.
      let neynarUser: Awaited<ReturnType<typeof getUserByFid>> = null;
      try {
        neynarUser = await getUserByFid(fid);
      } catch (lookupError) {
        console.error(`[user-state] Neynar lookup failed for FID ${fid}`, lookupError);
      }

      if (!isWalletOwnedByFid(walletAddress, neynarUser)) {
        console.warn(
          `[user-state] Refusing wallet change for FID ${fid}: ${walletAddress} is not a verified address for that account`
        );
        Sentry.captureMessage('[user-state] Unverified wallet change refused', {
          level: 'warning',
          extra: {
            fid,
            attemptedWallet: walletAddress,
            currentWallet: existingUser[0].signerWalletAddress,
          },
        });
      } else {
        console.log(`[user-state] Updating wallet for user ${fid} to ${walletAddress}`);
        try {
          await db
            .update(users)
            .set({ signerWalletAddress: walletAddress })
            .where(eq(users.fid, fid));
          console.log(`[user-state] Wallet address updated successfully`);
        } catch (updateError) {
          console.error('[user-state] Wallet update failed:', updateError);
          throw new Error(`Database update error: ${updateError instanceof Error ? updateError.message : 'Unknown'}`);
        }
      }
    }

    // Get or create daily state (now that user exists)
    console.log(`[user-state] Fetching daily state for user ${fid}...`);
    let dailyState;
    try {
      dailyState = await getOrCreateDailyState(fid);
      console.log(`[user-state] Daily state retrieved successfully`);
    } catch (dailyStateError) {
      console.error('[user-state] getOrCreateDailyState failed:', dailyStateError);
      throw new Error(`Daily state error: ${dailyStateError instanceof Error ? dailyStateError.message : 'Unknown'}`);
    }

    // Calculate remaining guesses
    const freeRemaining = getFreeGuessesRemaining(dailyState);
    const paidRemaining = dailyState.paidGuessCredits;
    const totalRemaining = freeRemaining + paidRemaining;

    // OPTIMIZATION: Run ALL independent async operations in parallel.
    //
    // The superguess check and the reward-gate check used to run serially
    // AFTER this block — and the reward gate is the expensive one: live in
    // production, its cache-miss path reads the chain (checkPlayEligibility
    // → getEffectiveBalanceChecked). Appended serially it added its full
    // latency to every response; inside the Promise.all it overlaps the
    // other reads. The wheel/source helpers take the already-fetched
    // dailyState so they stop re-reading the same row (it was read three
    // times per request), and the tier read is the wallet-keyed CACHED one
    // — this endpoint paid 1-2 uncached serial RPC calls per poll before.
    const totalGuessWords = getGuessWords().length;
    const [wordTierResult, wheelStartIndex, sourceState, isSuperguessing, rewardGate] =
      await Promise.all([
        // Milestone 14: $WORD tier check (if wallet provided) — returns 0-3,
        // or null when the chain was unreachable (fall back to the DB value;
        // an outage is never cached).
        walletAddress
          ? getWordBonusTierForConnectedWallet(walletAddress).catch((err) => {
              console.error('[user-state] $WORD tier check failed:', err);
              return null; // Fallback to database value
            })
          : Promise.resolve(null),
        // Wheel start index (reuses the row fetched above)
        getOrGenerateWheelStartIndex(fid, undefined, totalGuessWords, dailyState),
        // Source-level state for unified guess bar (reuses the row fetched above)
        getGuessSourceState(fid, dailyState),
        // Milestone 15: Check if user is currently Superguessing. The two
        // reads inside are dependent (session needs the round), so they stay
        // serial to each other but run parallel to everything else.
        (async (): Promise<boolean> => {
          if (!isSuperguessFeatureEnabled()) return false;
          const sgRound = await getActiveRoundForSuperguess();
          if (!sgRound) return false;
          const sgSession = await getActiveSuperguess(sgRound.id);
          return sgSession !== null && sgSession.fid === fid;
        })(),
        // Reward gate status for the guess bar (round 34+). Cached read, same
        // 5-minute posture as the tier; dormant while the flag is off. The
        // gate itself stays server-authoritative and money points still run
        // it uncached — this only changes WHEN the read happens, not what it
        // decides.
        (async (): Promise<UserStateResponse['rewardGate']> => {
          const { checkPlayEligibility, isRewardGateEnabled } = await import(
            '../../src/lib/reward-gate'
          );
          if (!isRewardGateEnabled()) {
            return { enabled: false, locked: false, grandfathered: false };
          }
          const gate = await checkPlayEligibility(fid, { useCache: true });
          return {
            enabled: true,
            locked: !gate.eligible,
            grandfathered: gate.grandfathered,
          };
        })(),
      ]);

    // Determine $WORD bonus: use live tier if available, otherwise database value
    const wordBonusTier = wordTierResult !== null
      ? wordTierResult
      : dailyState.freeAllocatedClankton; // legacy DB column name, stores tier (0-3)
    const wordBonusActive = wordBonusTier > 0;

    if (walletAddress) {
      console.log(`[user-state] $WORD tier result: ${wordBonusTier} (active: ${wordBonusActive})`);
    }

    // Check if can buy more packs
    const canBuyMorePacks = dailyState.paidPacksPurchased < 3; // DAILY_LIMITS_RULES.maxPaidPacksPerDay

    // Milestone 6.3: Check if user has already shared today
    const hasSharedToday = dailyState.freeAllocatedShareBonus > 0;

    const response: UserStateResponse = {
      fid,
      freeGuessesRemaining: freeRemaining,
      paidGuessesRemaining: paidRemaining,
      totalGuessesRemaining: totalRemaining,
      wordBonusActive,
      freeAllocations: {
        base: dailyState.freeAllocatedBase,
        wordToken: dailyState.freeAllocatedClankton, // Legacy DB column name
        shareBonus: dailyState.freeAllocatedShareBonus,
      },
      paidPacksPurchased: dailyState.paidPacksPurchased,
      maxPaidPacksPerDay: 3,
      canBuyMorePacks,
      wheelStartIndex, // Milestone 4.14 (now with dev mode override)
      // Milestone 6.3: New fields
      hasSharedToday,
      isWordTokenHolder: wordBonusActive,
      wordBonusTier, // Milestone 14: 0-3 holder tier
      // Milestone 6.5: Source-level tracking for unified guess bar
      sourceState,
      // Milestone 15: Superguess
      isSuperguessing,
      rewardGate,
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error('[user-state] Error fetching user state:', error);

    // Return detailed error in development
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;

    console.error('[user-state] Error message:', errorMessage);
    console.error('[user-state] Error stack:', errorStack);

    // Milestone 9.2: Report to Sentry with context
    Sentry.captureException(error, {
      tags: { endpoint: 'user-state' },
      extra: {
        devFid: req.query?.devFid,
        hasFrameMessage: !!req.query?.frameMessage,
        walletAddress: req.query?.walletAddress,
      },
    });

    // Return detailed error information for debugging
    return res.status(500).json({
      error: 'Failed to fetch user state',
      // Always include details to help diagnose production issues
      details: errorMessage,
      hasNeynarKey: !!process.env.NEYNAR_API_KEY,
      hasDatabaseUrl: !!process.env.DATABASE_URL,
      stack: process.env.NODE_ENV === 'development' ? errorStack : undefined,
    });
  }
}

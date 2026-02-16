/**
 * User State API
 * Milestone 4.1
 *
 * Returns user's daily guess allocations and $WORD bonus status
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
import { getOrCreateDailyState, getFreeGuessesRemaining, getOrGenerateWheelStartIndex, getGuessSourceState, resetDevDailyStateForUser, DEV_MODE_FID } from '../../src/lib/daily-limits';
import type { GuessSourceState } from '../../src/types';
import { verifyFrameMessage, getUserByFid } from '../../src/lib/farcaster';
import { hasWordTokenBonus } from '../../src/lib/word-token';
import { getGuessWords } from '../../src/lib/word-lists';
import { db } from '../../src/db';
import { users } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { isDevModeEnabled, getDevUserId } from '../../src/lib/devGameState';

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
  // Milestone 6.5: Source-level tracking for unified guess bar
  sourceState: GuessSourceState;
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

      // Create user record
      // If Neynar data available, use it; otherwise create minimal record
      // Priority: SDK wallet > Neynar primary wallet > Neynar signer wallet
      const userWallet = walletAddress || farcasterUser?.primaryWallet || farcasterUser?.signerWallet || null;
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
        });
        if (validReferrerFid) {
          console.log(`[Referral] ✅ Created new user FID ${fid} with referrer FID ${validReferrerFid}`);
        } else {
          console.log(`[user-state] User ${fid} created successfully`);
        }
      } catch (insertError) {
        console.error('[user-state] User insert failed:', insertError);
        throw new Error(`Database insert error: ${insertError instanceof Error ? insertError.message : 'Unknown'}`);
      }
    } else if (walletAddress && existingUser[0].signerWalletAddress !== walletAddress) {
      // Update wallet address if different from what's in database
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

    // OPTIMIZATION: Run independent async operations in parallel
    // These have no dependencies on each other, so parallelizing saves ~100-200ms
    const totalGuessWords = getGuessWords().length;
    const [wordTokenResult, wheelStartIndex, sourceState] = await Promise.all([
      // $WORD bonus check (if wallet provided)
      walletAddress
        ? hasWordTokenBonus(walletAddress).catch((err) => {
            console.error('[user-state] $WORD check failed:', err);
            return null; // Fallback to database value
          })
        : Promise.resolve(null),
      // Wheel start index
      getOrGenerateWheelStartIndex(fid, undefined, totalGuessWords),
      // Source-level state for unified guess bar
      getGuessSourceState(fid),
    ]);

    // Determine $WORD bonus: use live check if available, otherwise database value
    const wordBonusActive = wordTokenResult !== null
      ? wordTokenResult
      : dailyState.freeAllocatedClankton > 0; // legacy DB column name

    if (walletAddress) {
      console.log(`[user-state] $WORD check result: ${wordBonusActive}`);
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
      // Milestone 6.5: Source-level tracking for unified guess bar
      sourceState,
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

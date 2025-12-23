/**
 * User State API
 * Milestone 4.1
 *
 * Returns user's daily guess allocations and CLANKTON bonus status
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
import { getOrCreateDailyState, getFreeGuessesRemaining, getOrGenerateWheelStartIndex, getGuessSourceState, resetDevDailyStateForUser, DEV_MODE_FID } from '../../src/lib/daily-limits';
import type { GuessSourceState } from '../../src/types';
import { verifyFrameMessage, getUserByFid } from '../../src/lib/farcaster';
import { hasClanktonBonus } from '../../src/lib/clankton';
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
  clanktonBonusActive: boolean;
  freeAllocations: {
    base: number;
    clankton: number;
    shareBonus: number;
  };
  paidPacksPurchased: number;
  maxPaidPacksPerDay: number;
  canBuyMorePacks: boolean;
  wheelStartIndex: number | null; // Milestone 4.14: Per-user random wheel start position
  // Milestone 6.3: New fields
  hasSharedToday: boolean; // Whether user has already claimed share bonus today
  isClanktonHolder: boolean; // Whether user holds CLANKTON tokens
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

    // Milestone 4.12: Dev mode now uses real wallet data for CLANKTON bonus
    // No longer returns synthetic data - falls through to real implementation
    const isDevMode = isDevModeEnabled();
    if (isDevMode) {
      console.log('🎮 Dev mode: Using real wallet and CLANKTON balance');

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
      const userWallet = walletAddress || farcasterUser?.signerWallet || null;
      const username = farcasterUser?.username || `user-${fid}`;

      console.log(`[user-state] Creating user ${fid} with wallet ${userWallet || 'null'}`);
      try {
        await db.insert(users).values({
          fid,
          username,
          signerWalletAddress: userWallet,
          custodyAddress: farcasterUser?.custodyAddress || null,
          spamScore: farcasterUser?.spamScore || 0,
        });
        console.log(`[user-state] User ${fid} created successfully`);
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

    // Check if CLANKTON bonus is active
    // If connected wallet provided, check it directly; otherwise use database value
    let clanktonBonusActive = dailyState.freeAllocatedClankton > 0;

    // If wallet address provided, do live check
    if (walletAddress) {
      console.log(`[user-state] Performing live CLANKTON check for wallet ${walletAddress}`);
      try {
        clanktonBonusActive = await hasClanktonBonus(walletAddress);
        console.log(`[user-state] Live CLANKTON check result: ${clanktonBonusActive}`);
      } catch (clanktonError) {
        console.error('[user-state] CLANKTON check failed:', clanktonError);
        // Non-fatal: continue with database value if live check fails
        console.log(`[user-state] Falling back to database value: ${clanktonBonusActive}`);
      }
    }

    // Check if can buy more packs
    const canBuyMorePacks = dailyState.paidPacksPurchased < 3; // DAILY_LIMITS_RULES.maxPaidPacksPerDay

    // Milestone 6.3: Check if user has already shared today
    const hasSharedToday = dailyState.freeAllocatedShareBonus > 0;

    // Milestone 4.14: Get wheel start index (with dev mode override support)
    // In production: stable per-day per-user, from database
    // In dev mode: fresh random on every request
    const totalGuessWords = getGuessWords().length;
    const wheelStartIndex = await getOrGenerateWheelStartIndex(fid, undefined, totalGuessWords);

    // Milestone 6.5: Get source-level state for unified guess bar
    const sourceState = await getGuessSourceState(fid);

    const response: UserStateResponse = {
      fid,
      freeGuessesRemaining: freeRemaining,
      paidGuessesRemaining: paidRemaining,
      totalGuessesRemaining: totalRemaining,
      clanktonBonusActive,
      freeAllocations: {
        base: dailyState.freeAllocatedBase,
        clankton: dailyState.freeAllocatedClankton,
        shareBonus: dailyState.freeAllocatedShareBonus,
      },
      paidPacksPurchased: dailyState.paidPacksPurchased,
      maxPaidPacksPerDay: 3,
      canBuyMorePacks,
      wheelStartIndex, // Milestone 4.14 (now with dev mode override)
      // Milestone 6.3: New fields
      hasSharedToday,
      isClanktonHolder: clanktonBonusActive,
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

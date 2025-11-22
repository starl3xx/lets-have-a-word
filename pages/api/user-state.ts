/**
 * User State API
 * Milestone 4.1
 *
 * Returns user's daily guess allocations and CLANKTON bonus status
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getOrCreateDailyState, getFreeGuessesRemaining } from '../../src/lib/daily-limits';
import { verifyFrameMessage, getUserByFid } from '../../src/lib/farcaster';
import { hasClanktonBonus } from '../../src/lib/clankton';
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
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<UserStateResponse | { error: string }>
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
      wheelStartIndex: dailyState.wheelStartIndex, // Milestone 4.14
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error('[user-state] Error fetching user state:', error);

    // Return detailed error in development
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;

    console.error('[user-state] Error message:', errorMessage);
    console.error('[user-state] Error stack:', errorStack);

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

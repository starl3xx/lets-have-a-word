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
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<UserStateResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

    // Ensure user exists in database
    // If not, fetch from Neynar and create record
    console.log(`[user-state] Checking if user ${fid} exists...`);
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.fid, fid))
      .limit(1);

    if (existingUser.length === 0) {
      console.log(`[user-state] User ${fid} not found, fetching from Neynar...`);

      // Fetch user data from Neynar
      const farcasterUser = await getUserByFid(fid);

      if (!farcasterUser) {
        console.error(`[user-state] Could not fetch user ${fid} from Neynar`);
        return res.status(404).json({ error: 'User not found' });
      }

      // Create user record
      // If connected wallet provided, use it; otherwise use Farcaster verified address
      const userWallet = walletAddress || farcasterUser.signerWallet;
      console.log(`[user-state] Creating user ${fid} with wallet ${userWallet || 'null'}`);
      await db.insert(users).values({
        fid,
        username: farcasterUser.username,
        signerWalletAddress: userWallet,
        custodyAddress: farcasterUser.custodyAddress,
        spamScore: farcasterUser.spamScore,
      });

      console.log(`[user-state] User ${fid} created successfully`);
    } else if (walletAddress && existingUser[0].signerWalletAddress !== walletAddress) {
      // Update wallet address if different from what's in database
      console.log(`[user-state] Updating wallet for user ${fid} to ${walletAddress}`);
      await db
        .update(users)
        .set({ signerWalletAddress: walletAddress })
        .where(eq(users.fid, fid));
    }

    // Get or create daily state (now that user exists)
    const dailyState = await getOrCreateDailyState(fid);

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
      clanktonBonusActive = await hasClanktonBonus(walletAddress);
      console.log(`[user-state] Live CLANKTON check result: ${clanktonBonusActive}`);
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
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error('[user-state] Error fetching user state:', error);
    return res.status(500).json({ error: 'Failed to fetch user state' });
  }
}

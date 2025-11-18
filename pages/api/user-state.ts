/**
 * User State API
 * Milestone 4.1
 *
 * Returns user's daily guess allocations and CLANKTON bonus status
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getOrCreateDailyState, getFreeGuessesRemaining } from '../../src/lib/daily-limits';
import { verifyFrameMessage } from '../../src/lib/farcaster';

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

    // Get or create daily state
    const dailyState = await getOrCreateDailyState(fid);

    // Calculate remaining guesses
    const freeRemaining = getFreeGuessesRemaining(dailyState);
    const paidRemaining = dailyState.paidGuessCredits;
    const totalRemaining = freeRemaining + paidRemaining;

    // Check if CLANKTON bonus is active
    const clanktonBonusActive = dailyState.freeAllocatedClankton > 0;

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

/**
 * Share Callback API
 * Milestone 4.2
 *
 * Handles share bonus verification and award after successful Farcaster cast
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { awardShareBonus, getOrCreateDailyState, getFreeGuessesRemaining } from '../../src/lib/daily-limits';

export interface ShareCallbackResponse {
  ok: boolean;
  newFreeGuessesRemaining?: number;
  message?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ShareCallbackResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, message: 'Method not allowed' });
  }

  console.log('[share-callback] API called with body:', req.body);

  try {
    const { fid, castHash } = req.body;

    // Validate inputs
    if (!fid || typeof fid !== 'number') {
      return res.status(400).json({ ok: false, message: 'Invalid FID' });
    }

    if (!castHash || typeof castHash !== 'string') {
      return res.status(400).json({ ok: false, message: 'Invalid cast hash' });
    }

    console.log(`[share-callback] Processing share bonus for FID ${fid}, cast ${castHash}`);

    // Award share bonus
    const updated = await awardShareBonus(fid);

    if (!updated) {
      // User already claimed share bonus today
      console.log(`[share-callback] FID ${fid} already claimed share bonus today`);
      return res.status(200).json({
        ok: false,
        message: 'Share bonus already claimed today',
      });
    }

    // Get updated state to return new free guesses count
    const dailyState = await getOrCreateDailyState(fid);
    const newFreeGuessesRemaining = getFreeGuessesRemaining(dailyState);

    console.log(`[share-callback] Share bonus awarded to FID ${fid}. New free guesses: ${newFreeGuessesRemaining}`);

    return res.status(200).json({
      ok: true,
      newFreeGuessesRemaining,
      message: 'Share bonus awarded! You earned +1 free guess.',
    });
  } catch (error) {
    console.error('[share-callback] Error processing share bonus:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[share-callback] Error details:', errorMessage);

    return res.status(500).json({
      ok: false,
      message: 'Failed to process share bonus',
    });
  }
}

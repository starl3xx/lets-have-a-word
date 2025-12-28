/**
 * Force Resolve Round API Endpoint
 * Allows admins to force-resolve an active round for testing purposes
 *
 * POST /api/admin/operational/force-resolve
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from '../me';
import { getActiveRound, getRoundById } from '../../../../src/lib/rounds';
import { submitGuess } from '../../../../src/lib/guesses';
import { db, users } from '../../../../src/db';

// Use a high FID to avoid conflicts with real users
const FORCE_RESOLVE_FID = 9999999;

// =============================================================================
// API Handler
// =============================================================================

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { devFid } = req.body;

  // Authorize using centralized admin check
  if (!devFid || !isAdminFid(devFid)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    // Get active round
    const activeRound = await getActiveRound();

    if (!activeRound) {
      return res.status(400).json({
        success: false,
        message: 'No active round to resolve',
      });
    }

    const roundId = activeRound.id;
    const answer = activeRound.answer;

    // Ensure the force-resolve user exists
    await db
      .insert(users)
      .values({
        fid: FORCE_RESOLVE_FID,
        username: 'force_resolve_admin',
        signerWalletAddress: `0x${'0'.repeat(40)}`,
      })
      .onConflictDoNothing();

    // Submit the winning guess to resolve the round
    const result = await submitGuess({
      fid: FORCE_RESOLVE_FID,
      word: answer,
      isPaidGuess: false,
    });

    if (result.status === 'correct') {
      // Get the final round state
      const resolvedRound = await getRoundById(roundId);

      return res.status(200).json({
        success: true,
        message: `Round ${roundId} resolved successfully`,
        roundId,
        answer,
        resolvedAt: resolvedRound?.resolvedAt,
      });
    } else {
      return res.status(500).json({
        success: false,
        message: `Unexpected result when resolving round: ${result.status}`,
        roundId,
      });
    }
  } catch (error: any) {
    console.error('Force resolve error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to force resolve round',
    });
  }
}

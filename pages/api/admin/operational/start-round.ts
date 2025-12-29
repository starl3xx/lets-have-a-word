/**
 * Start Round API Endpoint
 * Creates a new round with a random solution
 *
 * POST /api/admin/operational/start-round
 *
 * Requires admin authentication (FID in LHAW_ADMIN_USER_IDS)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from '../me';
import { createRound, getActiveRound } from '../../../../src/lib/rounds';

interface StartRoundResponse {
  success: boolean;
  message: string;
  roundId?: number;
  commitHash?: string;
  prizePoolEth?: string;
  startedAt?: string;
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<StartRoundResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      message: 'Method not allowed',
    });
  }

  try {
    // Get FID from request (supports devFid query param or cookie)
    let fid: number | null = null;

    if (req.query.devFid) {
      fid = parseInt(req.query.devFid as string, 10);
    } else if (req.cookies.siwn_fid) {
      fid = parseInt(req.cookies.siwn_fid, 10);
    } else if (req.body?.fid) {
      fid = parseInt(req.body.fid, 10);
    }

    if (!fid || isNaN(fid)) {
      return res.status(401).json({
        success: false,
        message: 'Not authenticated - FID required',
      });
    }

    // Check admin status
    if (!isAdminFid(fid)) {
      return res.status(403).json({
        success: false,
        message: `FID ${fid} is not authorized as admin`,
      });
    }

    // Check if there's already an active round
    const existingRound = await getActiveRound();
    if (existingRound) {
      return res.status(409).json({
        success: false,
        message: `Round ${existingRound.id} is already active. Resolve it first before starting a new round.`,
        roundId: existingRound.id,
        prizePoolEth: existingRound.prizePoolEth,
        startedAt: existingRound.startedAt.toISOString(),
      });
    }

    // Create new round
    console.log(`[start-round] Admin FID ${fid} starting new round...`);
    const round = await createRound();

    console.log(`[start-round] Round ${round.id} created successfully`);

    return res.status(200).json({
      success: true,
      message: `Round ${round.id} started successfully!`,
      roundId: round.id,
      commitHash: round.commitHash,
      prizePoolEth: round.prizePoolEth,
      startedAt: round.startedAt.toISOString(),
    });
  } catch (error) {
    console.error('[start-round] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to start round',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Sync Prize Pool from Contract
 *
 * POST /api/admin/operational/sync-prize-pool
 *
 * Syncs the database prize pool with the onchain contract value.
 * Useful when the database is out of sync (e.g., after round creation).
 *
 * Requires admin authentication.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from '../me';
import { getActiveRound } from '../../../../src/lib/rounds';
import { syncPrizePoolFromContract } from '../../../../src/lib/economics';

interface SyncResponse {
  success: boolean;
  message: string;
  roundId?: number;
  oldPrizePoolEth?: string;
  newPrizePoolEth?: string;
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SyncResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      message: `Method ${req.method} not allowed. Use POST.`,
    });
  }

  try {
    // Get FID from request
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

    if (!isAdminFid(fid)) {
      return res.status(403).json({
        success: false,
        message: `FID ${fid} is not authorized as admin`,
      });
    }

    // Get active round
    const activeRound = await getActiveRound();
    if (!activeRound) {
      return res.status(404).json({
        success: false,
        message: 'No active round to sync',
      });
    }

    const oldPrizePool = activeRound.prizePoolEth;

    // Sync from contract
    const newPrizePool = await syncPrizePoolFromContract(activeRound.id);

    return res.status(200).json({
      success: true,
      message: `Prize pool synced for round ${activeRound.id}`,
      roundId: activeRound.id,
      oldPrizePoolEth: oldPrizePool,
      newPrizePoolEth: newPrizePool,
    });
  } catch (error) {
    console.error('[sync-prize-pool] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to sync prize pool',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

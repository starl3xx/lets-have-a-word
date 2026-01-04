/**
 * Sync Archive API (Admin Only)
 * Milestone 5.4: Round archive
 *
 * Archives all unarchived resolved rounds
 *
 * POST /api/admin/archive/sync
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from '../me';
import { syncAllRounds, archiveRound } from '../../../../src/lib/archive';

export interface ArchiveSyncResponse {
  archived: number;
  alreadyArchived: number;
  failed: number;
  errors: string[];
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ArchiveSyncResponse | { error: string }>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get FID from dev mode or session
    let fid: number | null = null;

    if (req.query.devFid) {
      fid = parseInt(req.query.devFid as string, 10);
    } else if (req.cookies.siwn_fid) {
      fid = parseInt(req.cookies.siwn_fid, 10);
    }

    if (!fid || isNaN(fid)) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Check admin status
    if (!isAdminFid(fid)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Check if syncing a specific round
    const { roundId, force } = req.body || {};

    if (roundId) {
      // Archive specific round
      const roundNum = parseInt(roundId, 10);
      if (isNaN(roundNum)) {
        return res.status(400).json({ error: 'Invalid roundId' });
      }

      const result = await archiveRound({ roundId: roundNum, force: !!force });

      return res.status(200).json({
        archived: result.success && !result.alreadyArchived ? 1 : 0,
        alreadyArchived: result.alreadyArchived ? 1 : 0,
        failed: result.success ? 0 : 1,
        errors: result.error ? [`Round ${roundNum}: ${result.error}`] : [],
      });
    }

    // Sync all rounds
    const result = await syncAllRounds({ force: !!force });

    return res.status(200).json(result);
  } catch (error) {
    console.error('[api/admin/archive/sync] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

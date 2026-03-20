/**
 * Admin: Superguess Debug Status
 * Milestone 15: Dev/test tooling
 *
 * GET /api/admin/operational/superguess-status
 * Query: { roundId?: number, devFid?: number }
 *
 * Returns full debug state for the Superguess system.
 * Gated by isAdminFid().
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from '../me';
import { getDebugState, isSuperguessFeatureEnabled } from '../../../../src/lib/superguess';
import { getActiveRound } from '../../../../src/lib/rounds';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Auth check
    const devFid = req.query.devFid ? parseInt(req.query.devFid as string, 10) : null;
    const fidFromCookie = req.cookies.siwn_fid ? parseInt(req.cookies.siwn_fid, 10) : null;
    const adminFid = devFid || fidFromCookie;

    if (!adminFid || !isAdminFid(adminFid)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    let targetRoundId = req.query.roundId ? parseInt(req.query.roundId as string, 10) : null;
    if (!targetRoundId) {
      const activeRound = await getActiveRound();
      if (!activeRound) {
        return res.status(200).json({
          featureEnabled: isSuperguessFeatureEnabled(),
          noActiveRound: true,
        });
      }
      targetRoundId = activeRound.id;
    }

    const debugState = await getDebugState(targetRoundId);

    return res.status(200).json({
      roundId: targetRoundId,
      ...debugState,
    });
  } catch (error) {
    console.error('[admin] Superguess status failed:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

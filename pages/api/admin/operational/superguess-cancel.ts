/**
 * Admin: Force-Cancel Active Superguess Session
 * Milestone 15: Dev/test tooling
 *
 * POST /api/admin/operational/superguess-cancel
 * Body: { roundId?: number, devFid?: number }
 *
 * Force-cancels the active session with no cooldown.
 * Gated by isAdminFid().
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from '../me';
import { forceCancel } from '../../../../src/lib/superguess';
import { getActiveRound } from '../../../../src/lib/rounds';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Auth check
    const devFid = req.body.devFid ? parseInt(req.body.devFid as string, 10) : null;
    const fidFromCookie = req.cookies.siwn_fid ? parseInt(req.cookies.siwn_fid, 10) : null;
    const adminFid = devFid || fidFromCookie;

    if (!adminFid || !isAdminFid(adminFid)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    let targetRoundId = req.body.roundId;
    if (!targetRoundId) {
      const activeRound = await getActiveRound();
      if (!activeRound) {
        return res.status(400).json({ error: 'No active round and no roundId provided' });
      }
      targetRoundId = activeRound.id;
    }

    const cancelled = await forceCancel(targetRoundId);

    if (!cancelled) {
      return res.status(404).json({ error: 'No active Superguess session to cancel' });
    }

    console.log(`[admin] Superguess force-cancelled by FID ${adminFid} for round ${targetRoundId}`);

    return res.status(200).json({ success: true, roundId: targetRoundId });
  } catch (error) {
    console.error('[admin] Superguess cancel failed:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

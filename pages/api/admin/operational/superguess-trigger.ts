/**
 * Admin: Trigger Test Superguess Session
 * Milestone 15: Dev/test tooling
 *
 * POST /api/admin/operational/superguess-trigger
 * Body: { fid: number, roundId?: number, tier?: string, devFid?: number }
 *
 * Creates a Superguess session without $WORD payment for testing.
 * Gated by isAdminFid().
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from '../me';
import { createDevSession } from '../../../../src/lib/superguess';
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

    const { fid, roundId, tier } = req.body;

    if (!fid || typeof fid !== 'number') {
      return res.status(400).json({ error: 'fid is required (number)' });
    }

    // Get round ID (use provided or current active round)
    let targetRoundId = roundId;
    if (!targetRoundId) {
      const activeRound = await getActiveRound();
      if (!activeRound) {
        return res.status(400).json({ error: 'No active round and no roundId provided' });
      }
      targetRoundId = activeRound.id;
    }

    const session = await createDevSession({
      roundId: targetRoundId,
      fid,
      tier,
    });

    console.log(`[admin] Superguess test session triggered by FID ${adminFid} for FID ${fid} in round ${targetRoundId}`);

    return res.status(200).json({
      success: true,
      session: {
        id: session.id,
        fid: session.fid,
        roundId: session.roundId,
        tier: session.tier,
        status: session.status,
        guessesAllowed: session.guessesAllowed,
        expiresAt: session.expiresAt.toISOString(),
      },
    });
  } catch (error: any) {
    // Handle partial unique index violation (another session already active)
    if (error.code === '23505') {
      return res.status(409).json({
        error: 'A Superguess session is already active for this round',
      });
    }

    console.error('[admin] Superguess trigger failed:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Admin API to manually award guess packs to a user
 *
 * POST /api/admin/operational/award-pack
 * Body: { targetFid: number, packCount?: number, reason: string }
 *
 * Awards guess packs (3 guesses each) to a user.
 * Useful for support cases, promotions, or compensation.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from '../me';
import { awardPaidPack, getOrCreateDailyState, getTodayUTC, DAILY_LIMITS_RULES } from '../../../../src/lib/daily-limits';
import { db } from '../../../../src/db';
import { users, rounds } from '../../../../src/db/schema';
import { eq, isNull, desc } from 'drizzle-orm';

interface AwardPackResponse {
  ok: boolean;
  fid: number;
  username: string | null;
  packsAwarded: number;
  guessesAdded: number;
  newPaidCredits: number;
  reason: string;
  awardedBy: number;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AwardPackResponse | { error: string }>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth check
  const devFid = req.body.devFid ? parseInt(req.body.devFid, 10) : null;
  const fidFromCookie = req.cookies.siwn_fid ? parseInt(req.cookies.siwn_fid, 10) : null;
  const adminFid = devFid || fidFromCookie;

  if (!adminFid || !isAdminFid(adminFid)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { targetFid, packCount = 1, reason } = req.body;

  // Validate inputs
  if (!targetFid || typeof targetFid !== 'number' || targetFid <= 0) {
    return res.status(400).json({ error: 'targetFid is required and must be a positive number' });
  }

  if (typeof packCount !== 'number' || packCount < 1 || packCount > 10) {
    return res.status(400).json({ error: 'packCount must be between 1 and 10' });
  }

  if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
    return res.status(400).json({ error: 'reason is required and must be at least 10 characters' });
  }

  try {
    // Check if user exists
    const [user] = await db
      .select({ fid: users.fid, username: users.username })
      .from(users)
      .where(eq(users.fid, targetFid))
      .limit(1);

    if (!user) {
      return res.status(404).json({ error: `User with FID ${targetFid} not found` });
    }

    // Get current active round (if any) for pack tracking
    const [activeRound] = await db
      .select({ id: rounds.id })
      .from(rounds)
      .where(isNull(rounds.resolvedAt))
      .orderBy(desc(rounds.startedAt))
      .limit(1);

    const roundId = activeRound?.id;
    const dateStr = getTodayUTC();

    // Get state before awarding
    const stateBefore = await getOrCreateDailyState(targetFid, dateStr);
    const creditsBefore = stateBefore.paidGuessCredits;

    // Award packs
    let finalState = stateBefore;
    for (let i = 0; i < packCount; i++) {
      finalState = await awardPaidPack(targetFid, dateStr, roundId);
    }

    const guessesAdded = packCount * DAILY_LIMITS_RULES.paidGuessPackSize;

    console.log(
      `[admin/award-pack] Admin FID ${adminFid} awarded ${packCount} pack(s) to FID ${targetFid} (@${user.username || 'unknown'}). ` +
      `Credits: ${creditsBefore} → ${finalState.paidGuessCredits}. Reason: ${reason.trim()}`
    );

    return res.status(200).json({
      ok: true,
      fid: targetFid,
      username: user.username,
      packsAwarded: packCount,
      guessesAdded,
      newPaidCredits: finalState.paidGuessCredits,
      reason: reason.trim(),
      awardedBy: adminFid,
    });
  } catch (error) {
    console.error('[admin/award-pack] Error:', error);
    return res.status(500).json({
      error: 'Failed to award pack',
    });
  }
}

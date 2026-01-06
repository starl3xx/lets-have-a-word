/**
 * Admin API to manually grant share bonus to a user
 *
 * POST /api/admin/grant-share-bonus
 * Body: { targetFid: number, reason?: string }
 *
 * Awards +1 free share bonus guess to a user for the current day.
 * Useful when a user shared but missed the share modal detection.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from './me';
import { awardShareBonus, getOrCreateDailyState, getTodayUTC } from '../../../src/lib/daily-limits';
import { db } from '../../../src/db';
import { users } from '../../../src/db/schema';
import { eq } from 'drizzle-orm';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
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

  const { targetFid, reason } = req.body;

  if (!targetFid || typeof targetFid !== 'number' || targetFid <= 0) {
    return res.status(400).json({ error: 'targetFid is required and must be a positive number' });
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

    // Check current state before awarding
    const dateStr = getTodayUTC();
    const stateBefore = await getOrCreateDailyState(targetFid, dateStr);

    if (stateBefore.hasSharedToday) {
      return res.status(400).json({
        error: `User @${user.username || targetFid} already has share bonus for today`,
        currentState: {
          hasSharedToday: stateBefore.hasSharedToday,
          freeAllocatedShareBonus: stateBefore.freeAllocatedShareBonus,
        },
      });
    }

    // Award the share bonus
    const result = await awardShareBonus(targetFid, dateStr);

    if (!result) {
      return res.status(500).json({ error: 'Failed to award share bonus' });
    }

    console.log(
      `[admin/grant-share-bonus] Admin FID ${adminFid} granted share bonus to FID ${targetFid} (@${user.username || 'unknown'}). Reason: ${reason || 'No reason provided'}`
    );

    return res.status(200).json({
      success: true,
      message: `Share bonus granted to @${user.username || targetFid} (+1 free guess)`,
      targetFid,
      username: user.username,
      date: dateStr,
      reason: reason || null,
    });
  } catch (error) {
    console.error('[admin/grant-share-bonus] Error:', error);
    return res.status(500).json({
      error: 'Failed to grant share bonus',
    });
  }
}

/**
 * Admin API: Award XP Manually
 *
 * Allows admins to manually award XP events to users by FID.
 * Useful for correcting missed XP, compensating users, or testing.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { logXpEvent } from '../../../src/lib/xp';
import { XP_VALUES } from '../../../src/types';
import type { XpEventType } from '../../../src/types';
import { db } from '../../../src/db';
import { users } from '../../../src/db/schema';
import { eq } from 'drizzle-orm';

// Admin FIDs (same as other admin endpoints)
const ADMIN_FIDS = [
  213559,  // starl3xx
  6500,    // Dev mode FID
];

interface AwardXpRequest {
  devFid: number;
  targetFid: number;
  eventType: XpEventType;
  reason?: string;
}

interface AwardXpResponse {
  success: boolean;
  message: string;
  details?: {
    fid: number;
    eventType: XpEventType;
    xpAmount: number;
    reason?: string;
  };
}

// XP event type labels for display
export const XP_EVENT_LABELS: Record<XpEventType, string> = {
  DAILY_PARTICIPATION: 'Daily participation (first guess)',
  GUESS: 'Valid guess',
  WIN: 'Winning the jackpot',
  TOP_TEN_GUESSER: 'Top 10 guesser placement',
  REFERRAL_FIRST_GUESS: 'Referred user makes first guess',
  STREAK_DAY: 'Consecutive day streak',
  NEAR_MISS: 'Near miss (tracked only)',
  CLANKTON_BONUS_DAY: 'CLANKTON holder daily bonus',
  SHARE_CAST: 'Sharing to Farcaster/Base',
  PACK_PURCHASE: 'Buying a guess pack',
  OG_HUNTER_AWARD: 'OG Hunter badge',
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AwardXpResponse | { error: string }>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { devFid, targetFid, eventType, reason } = req.body as AwardXpRequest;

    // Validate admin
    if (!devFid || !ADMIN_FIDS.includes(devFid)) {
      return res.status(403).json({ error: 'Unauthorized: Admin access required' });
    }

    // Validate target FID
    if (!targetFid || typeof targetFid !== 'number' || targetFid <= 0) {
      return res.status(400).json({ error: 'Invalid target FID' });
    }

    // Validate event type
    if (!eventType || !(eventType in XP_VALUES)) {
      return res.status(400).json({
        error: `Invalid event type. Valid types: ${Object.keys(XP_VALUES).join(', ')}`
      });
    }

    // Check if user exists
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.fid, targetFid))
      .limit(1);

    if (!user) {
      return res.status(404).json({ error: `User with FID ${targetFid} not found` });
    }

    const xpAmount = XP_VALUES[eventType as XpEventType];

    // Log the XP event
    await logXpEvent(targetFid, eventType as XpEventType, {
      metadata: {
        manualAward: true,
        awardedBy: devFid,
        reason: reason || 'Manual admin award',
      },
    });

    console.log(`[Admin] XP awarded: FID ${targetFid} received ${xpAmount} XP for ${eventType} (by FID ${devFid})`);

    return res.status(200).json({
      success: true,
      message: `Successfully awarded ${xpAmount} XP to FID ${targetFid}`,
      details: {
        fid: targetFid,
        eventType: eventType as XpEventType,
        xpAmount,
        reason,
      },
    });

  } catch (error: any) {
    console.error('[Admin] Error awarding XP:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

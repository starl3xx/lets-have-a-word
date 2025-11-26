import type { NextApiRequest, NextApiResponse } from 'next';
import { awardPaidPack, getOrCreateDailyState, getTodayUTC, DAILY_LIMITS_RULES } from '../../src/lib/daily-limits';
import { logAnalyticsEvent, AnalyticsEventTypes } from '../../src/lib/analytics';
import { getActiveRound } from '../../src/lib/rounds';
import { logXpEvent } from '../../src/lib/xp';

/**
 * POST /api/purchase-guess-pack
 * Milestone 6.3
 *
 * Process guess pack purchase.
 *
 * Body:
 * - fid: number - Farcaster ID
 * - packCount: number - Number of packs to purchase (1, 2, or 3)
 *
 * Note: In production, this would validate payment on-chain before awarding packs.
 * For now, it awards packs directly (payment validation to be added in Milestone 6.4).
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { fid, packCount } = req.body;

    // Validate inputs
    if (!fid || typeof fid !== 'number') {
      return res.status(400).json({ error: 'Invalid FID' });
    }

    if (!packCount || typeof packCount !== 'number' || packCount < 1 || packCount > 3) {
      return res.status(400).json({ error: 'Invalid pack count. Must be 1, 2, or 3.' });
    }

    // Get current daily state
    const dateStr = getTodayUTC();
    const currentState = await getOrCreateDailyState(fid, dateStr);

    // Check if user can purchase requested packs
    const remainingPacks = DAILY_LIMITS_RULES.maxPaidPacksPerDay - currentState.paidPacksPurchased;
    if (packCount > remainingPacks) {
      return res.status(400).json({
        error: `Cannot purchase ${packCount} packs. You can only purchase ${remainingPacks} more today.`,
        remainingPacks,
      });
    }

    // Log analytics event - pack viewed (implicit in purchase flow)
    const activeRound = await getActiveRound();
    logAnalyticsEvent(AnalyticsEventTypes.GUESS_PACK_VIEWED, {
      userId: fid.toString(),
      roundId: activeRound?.id?.toString(),
      data: {
        pack_count: packCount,
        packs_already_purchased: currentState.paidPacksPurchased,
      },
    });

    // Award packs one by one (for proper tracking)
    let updatedState = currentState;
    for (let i = 0; i < packCount; i++) {
      updatedState = await awardPaidPack(fid, dateStr);
    }

    // Log analytics event - packs purchased
    logAnalyticsEvent(AnalyticsEventTypes.GUESS_PACK_PURCHASED, {
      userId: fid.toString(),
      roundId: activeRound?.id?.toString(),
      data: {
        pack_count: packCount,
        total_packs_today: updatedState.paidPacksPurchased,
        credits_added: packCount * DAILY_LIMITS_RULES.paidGuessPackSize,
        total_credits: updatedState.paidGuessCredits,
      },
    });

    // Milestone 6.7: Award PACK_PURCHASE XP (+20 XP per pack, fire-and-forget)
    for (let i = 0; i < packCount; i++) {
      logXpEvent(fid, 'PACK_PURCHASE', {
        roundId: activeRound?.id,
        metadata: {
          pack_number: currentState.paidPacksPurchased + i + 1,
          total_packs_today: updatedState.paidPacksPurchased,
        },
      });
    }

    console.log(
      `[purchase-guess-pack] FID ${fid} purchased ${packCount} pack(s). ` +
      `Total today: ${updatedState.paidPacksPurchased}/${DAILY_LIMITS_RULES.maxPaidPacksPerDay}. ` +
      `Credits: ${updatedState.paidGuessCredits}`
    );

    return res.status(200).json({
      ok: true,
      packsPurchased: packCount,
      totalPacksToday: updatedState.paidPacksPurchased,
      paidGuessCredits: updatedState.paidGuessCredits,
      remainingPacks: DAILY_LIMITS_RULES.maxPaidPacksPerDay - updatedState.paidPacksPurchased,
    });
  } catch (error) {
    console.error('[purchase-guess-pack] Error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to purchase pack',
    });
  }
}

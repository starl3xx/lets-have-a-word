import type { NextApiRequest, NextApiResponse } from 'next';
import { awardPaidPack, getOrCreateDailyState, getTodayUTC, DAILY_LIMITS_RULES } from '../../src/lib/daily-limits';
import { logAnalyticsEvent, AnalyticsEventTypes } from '../../src/lib/analytics';
import { getActiveRound } from '../../src/lib/rounds';
import { logXpEvent } from '../../src/lib/xp';
import { db } from '../../src/db';
import { guesses } from '../../src/db/schema';
import { eq, sql } from 'drizzle-orm';
import {
  getTotalPackCostWei,
  weiToEthString,
  getPricingPhase,
} from '../../src/lib/pack-pricing';
import {
  invalidateRoundStateCache,
  checkRateLimit,
  RateLimiters,
} from '../../src/lib/redis';

/**
 * POST /api/purchase-guess-pack
 * Milestone 6.3, Updated Milestone 7.1
 *
 * Process guess pack purchase with dynamic late-round pricing.
 *
 * Body:
 * - fid: number - Farcaster ID
 * - packCount: number - Number of packs to purchase (1, 2, or 3)
 *
 * Note: In production, this would validate payment on-chain before awarding packs.
 * For now, it awards packs directly (payment validation to be added in Milestone 6.4).
 * The expected cost is calculated and returned for logging/verification purposes.
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

    // Milestone 9.0: Rate limiting for pack purchases (by FID)
    if (fid && typeof fid === 'number') {
      const rateCheck = await checkRateLimit(RateLimiters.packPurchase, `pack:${fid}`);
      if (!rateCheck.success) {
        res.setHeader('X-RateLimit-Limit', rateCheck.limit?.toString() || '10');
        res.setHeader('X-RateLimit-Remaining', '0');
        res.setHeader('X-RateLimit-Reset', rateCheck.reset?.toString() || '');
        return res.status(429).json({ error: 'Too many requests. Please wait before purchasing again.' });
      }
    }

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

    // Get active round and calculate dynamic pricing
    const activeRound = await getActiveRound();

    // Get total guesses in current round for dynamic pricing
    let totalGuessesInRound = 0;
    if (activeRound?.id) {
      const [result] = await db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(guesses)
        .where(eq(guesses.roundId, activeRound.id));
      totalGuessesInRound = result?.count || 0;
    }

    // Calculate expected cost based on current round state
    const expectedCostWei = getTotalPackCostWei(totalGuessesInRound, packCount);
    const expectedCostEth = weiToEthString(expectedCostWei);
    const pricingPhase = getPricingPhase(totalGuessesInRound);

    // Log analytics event - pack viewed (implicit in purchase flow)
    logAnalyticsEvent(AnalyticsEventTypes.GUESS_PACK_VIEWED, {
      userId: fid.toString(),
      roundId: activeRound?.id?.toString(),
      data: {
        pack_count: packCount,
        packs_already_purchased: currentState.paidPacksPurchased,
        pricing_phase: pricingPhase,
        expected_cost_wei: expectedCostWei.toString(),
      },
    });

    // Award packs one by one (for proper tracking)
    let updatedState = currentState;
    for (let i = 0; i < packCount; i++) {
      updatedState = await awardPaidPack(fid, dateStr);
    }

    // Log analytics event - packs purchased with pricing info
    logAnalyticsEvent(AnalyticsEventTypes.GUESS_PACK_PURCHASED, {
      userId: fid.toString(),
      roundId: activeRound?.id?.toString(),
      data: {
        pack_count: packCount,
        total_packs_today: updatedState.paidPacksPurchased,
        credits_added: packCount * DAILY_LIMITS_RULES.paidGuessPackSize,
        total_credits: updatedState.paidGuessCredits,
        pricing_phase: pricingPhase,
        expected_cost_wei: expectedCostWei.toString(),
        expected_cost_eth: expectedCostEth,
        total_guesses_in_round: totalGuessesInRound,
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

    // Milestone 9.0: Invalidate round state cache (prize pool changed)
    if (activeRound?.id) {
      console.log(`[Cache] Invalidating round-state cache after pack purchase for round ${activeRound.id}`);
      invalidateRoundStateCache(activeRound.id).catch((err) => {
        console.error('[Cache] Failed to invalidate after pack purchase:', err);
      });
    }

    console.log(
      `[purchase-guess-pack] FID ${fid} purchased ${packCount} pack(s) @ ${expectedCostEth} ETH (${pricingPhase}). ` +
      `Total today: ${updatedState.paidPacksPurchased}/${DAILY_LIMITS_RULES.maxPaidPacksPerDay}. ` +
      `Credits: ${updatedState.paidGuessCredits}`
    );

    return res.status(200).json({
      ok: true,
      packsPurchased: packCount,
      totalPacksToday: updatedState.paidPacksPurchased,
      paidGuessCredits: updatedState.paidGuessCredits,
      remainingPacks: DAILY_LIMITS_RULES.maxPaidPacksPerDay - updatedState.paidPacksPurchased,
      // Milestone 7.1: Include pricing info in response
      expectedCostWei: expectedCostWei.toString(),
      expectedCostEth,
      pricingPhase,
    });
  } catch (error) {
    console.error('[purchase-guess-pack] Error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to purchase pack',
    });
  }
}

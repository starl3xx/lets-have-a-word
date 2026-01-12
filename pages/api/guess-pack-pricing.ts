import type { NextApiRequest, NextApiResponse } from 'next';
import { GUESS_PACK_SIZE } from '../../config/economy';
import {
  getPackPricingDetails,
  getTotalPackCostWei,
  weiToEthString,
  getPackCostBreakdown,
  getNextResetTime,
  getMillisUntilReset,
} from '../../src/lib/pack-pricing';
import { db } from '../../src/db';
import { guesses, rounds, dailyGuessState } from '../../src/db/schema';
import { eq, sql, and, isNull } from 'drizzle-orm';
import { isDevModeEnabled, getDevRoundStatus } from '../../src/lib/devGameState';
import { getTodayUTC } from '../../src/lib/daily-limits';

/**
 * GET /api/guess-pack-pricing
 * Milestone 6.3, Updated Milestone 7.1, X.X (Uncapped + Volume Tiers)
 *
 * Returns guess pack pricing information with:
 * - Dynamic stage-based pricing (0-849, 850-1249, 1250+)
 * - Volume-based multipliers (1×, 1.5×, 2×) based on daily purchases
 *
 * Query params:
 * - fid: (optional) Farcaster ID for user-specific volume tier pricing
 *
 * Response includes:
 * - Stage-based pricing info (pricingPhase, basePriceEth)
 * - Volume tier info (volumeTier, volumeMultiplier, packsPurchasedToday)
 * - Pack options with calculated prices including volume multiplier
 * - Reset time for paid guess expiration
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get FID from query params for user-specific pricing
    const fidParam = req.query.fid;
    const fid = fidParam && typeof fidParam === 'string' ? parseInt(fidParam, 10) : null;

    // Get current active round ID first (needed for volume tier reset check)
    let activeRoundId: number | null = null;
    if (!isDevModeEnabled()) {
      const [activeRound] = await db
        .select({ id: rounds.id })
        .from(rounds)
        .where(isNull(rounds.resolvedAt))
        .limit(1);
      activeRoundId = activeRound?.id ?? null;
    }

    // Get user's packs purchased today (if FID provided)
    // Volume tier resets when a new round starts, not just at daily reset
    let packsPurchasedToday = 0;
    if (fid && !isNaN(fid)) {
      const dateStr = getTodayUTC();
      const [userState] = await db
        .select({
          paidPacksPurchased: dailyGuessState.paidPacksPurchased,
          packPurchaseRoundId: dailyGuessState.packPurchaseRoundId,
        })
        .from(dailyGuessState)
        .where(and(
          eq(dailyGuessState.fid, fid),
          eq(dailyGuessState.date, dateStr)
        ))
        .limit(1);

      // Only count packs if they were purchased in the current round
      // This resets volume tier when a new round starts
      if (userState?.paidPacksPurchased && userState?.packPurchaseRoundId === activeRoundId) {
        packsPurchasedToday = userState.paidPacksPurchased;
      }
    }

    // Get total guesses in current round
    let totalGuessesInRound = 0;

    if (isDevModeEnabled()) {
      // In dev mode, use the same guess count displayed in TopTicker for consistency
      const devGuesses = req.query.devGuesses;
      if (devGuesses && typeof devGuesses === 'string') {
        totalGuessesInRound = parseInt(devGuesses, 10) || 0;
      } else {
        const devStatus = await getDevRoundStatus();
        totalGuessesInRound = devStatus.globalGuessCount;
      }
    } else if (activeRoundId) {
      // Production: get actual guess count from database (reuse activeRoundId from above)
      const [result] = await db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(guesses)
        .where(eq(guesses.roundId, activeRoundId));
      totalGuessesInRound = result?.count || 0;
    }

    // Get dynamic pricing details including volume tier
    const pricingDetails = getPackPricingDetails(totalGuessesInRound, packsPurchasedToday);

    // Build pack options with volume-aware pricing
    const packOptions = [1, 2, 3].map((packCount) => {
      const totalCostWei = getTotalPackCostWei(totalGuessesInRound, packCount, packsPurchasedToday);
      const breakdown = getPackCostBreakdown(totalGuessesInRound, packCount, packsPurchasedToday);

      // Check if this purchase spans multiple tiers
      const tiers = new Set(breakdown.map(b => b.tier));
      const spansTiers = tiers.size > 1;

      return {
        packCount,
        guessCount: GUESS_PACK_SIZE * packCount,
        totalPriceWei: totalCostWei.toString(),
        totalPriceEth: weiToEthString(totalCostWei),
        spansTiers,
        breakdown: spansTiers ? breakdown : undefined, // Only include if relevant
      };
    });

    // Calculate time until reset
    const millisUntilReset = getMillisUntilReset();
    const hoursUntilReset = Math.floor(millisUntilReset / (1000 * 60 * 60));
    const minutesUntilReset = Math.floor((millisUntilReset % (1000 * 60 * 60)) / (1000 * 60));

    return res.status(200).json({
      // Stage-based pricing info
      basePriceWei: pricingDetails.basePriceWei,
      basePriceEth: pricingDetails.basePriceEth,
      pricingPhase: pricingDetails.pricingPhase,
      isLateRoundPricing: pricingDetails.isLateRoundPricing,

      // Volume tier info
      volumeTier: pricingDetails.volumeTier,
      volumeMultiplier: pricingDetails.volumeMultiplier,
      packsPurchasedToday: pricingDetails.packsPurchasedToday,
      packsRemainingAtCurrentTier: pricingDetails.packsRemainingAtCurrentTier,
      nextTierMultiplier: pricingDetails.nextTierMultiplier,

      // Final price (base × volume multiplier)
      packPriceWei: pricingDetails.packPriceWei,
      packPriceEth: pricingDetails.packPriceEth,

      // Round context
      totalGuessesInRound: pricingDetails.totalGuessesInRound,
      priceRampStartGuesses: pricingDetails.priceRampStartGuesses,
      priceStepGuesses: pricingDetails.priceStepGuesses,

      // Pack configuration
      guessesPerPack: GUESS_PACK_SIZE,
      // Pack purchases are now UNLIMITED (no daily cap)
      packOptions,

      // Reset info - paid guesses expire at 11:00 UTC
      paidGuessesExpireAt: getNextResetTime(),
      hoursUntilReset,
      minutesUntilReset,
    });
  } catch (error) {
    console.error('[guess-pack-pricing] Error:', error);
    return res.status(500).json({ error: 'Failed to fetch pricing info' });
  }
}

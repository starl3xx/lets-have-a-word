import type { NextApiRequest, NextApiResponse } from 'next';
import { GUESS_PACK_SIZE, MAX_PACKS_PER_DAY } from '../../config/economy';
import {
  getPackPricingDetails,
  getTotalPackCostWei,
  weiToEthString,
} from '../../src/lib/pack-pricing';
import { db } from '../../src/db';
import { guesses, rounds } from '../../src/db/schema';
import { eq, sql, and, isNull } from 'drizzle-orm';
import { isDevModeEnabled } from '../../src/lib/devGameState';

/**
 * GET /api/guess-pack-pricing
 * Milestone 6.3, Updated Milestone 7.1
 *
 * Returns guess pack pricing information with dynamic late-round pricing.
 *
 * Response includes:
 * - packPriceWei: Current price per pack in wei
 * - packPriceEth: Current price per pack in ETH (display string)
 * - pricingPhase: BASE | LATE_1 | LATE_2
 * - isLateRoundPricing: boolean
 * - packOptions: Array of pack options with calculated prices
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get total guesses in current round
    let totalGuessesInRound = 0;

    if (isDevModeEnabled()) {
      // In dev mode, use a synthetic guess count for testing
      // Parse from query param if provided, otherwise use random value
      const devGuesses = req.query.devGuesses;
      if (devGuesses && typeof devGuesses === 'string') {
        totalGuessesInRound = parseInt(devGuesses, 10) || 0;
      } else {
        // Use a value that shows late-round pricing sometimes
        totalGuessesInRound = Math.floor(Math.random() * 1500);
      }
    } else {
      // Production: get actual guess count from database
      const [activeRound] = await db
        .select({ id: rounds.id })
        .from(rounds)
        .where(isNull(rounds.resolvedAt))
        .limit(1);

      if (activeRound) {
        const [result] = await db
          .select({ count: sql<number>`cast(count(*) as int)` })
          .from(guesses)
          .where(eq(guesses.roundId, activeRound.id));
        totalGuessesInRound = result?.count || 0;
      }
    }

    // Get dynamic pricing details
    const pricingDetails = getPackPricingDetails(totalGuessesInRound);

    // Build pack options with dynamic pricing
    const packOptions = [1, 2, 3].map((packCount) => {
      const totalCostWei = getTotalPackCostWei(totalGuessesInRound, packCount);
      return {
        packCount,
        guessCount: GUESS_PACK_SIZE * packCount,
        totalPriceWei: totalCostWei.toString(),
        totalPriceEth: weiToEthString(totalCostWei),
      };
    });

    return res.status(200).json({
      // Core pricing info
      packPriceWei: pricingDetails.packPriceWei,
      packPriceEth: pricingDetails.packPriceEth,
      pricingPhase: pricingDetails.pricingPhase,
      isLateRoundPricing: pricingDetails.isLateRoundPricing,

      // Round context
      totalGuessesInRound: pricingDetails.totalGuessesInRound,
      priceRampStartGuesses: pricingDetails.priceRampStartGuesses,
      priceStepGuesses: pricingDetails.priceStepGuesses,

      // Pack configuration
      guessesPerPack: GUESS_PACK_SIZE,
      maxPacksPerDay: MAX_PACKS_PER_DAY,
      packOptions,
    });
  } catch (error) {
    console.error('[guess-pack-pricing] Error:', error);
    return res.status(500).json({ error: 'Failed to fetch pricing info' });
  }
}

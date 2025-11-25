/**
 * Economy Configuration
 * Milestone 5.4c: CLANKTON Bonus Market Cap Tiers
 * Milestone 6.3: Guess Pack Configuration
 * Milestone 6.4: Animation Debug Settings
 *
 * Centralized configuration for economy-related constants
 * including CLANKTON holder bonuses, market cap thresholds,
 * and guess pack pricing.
 */

/**
 * CLANKTON holder threshold (100 million tokens)
 * Users must hold >= this amount to receive bonus guesses
 * Note: Actual threshold check uses ethers.parseUnits in clankton.ts
 */
export const CLANKTON_HOLDER_THRESHOLD = 100_000_000;

/**
 * Market cap threshold for tier upgrade (in USD)
 * Below this: TIER_LOW bonus, at or above: TIER_HIGH bonus
 */
export const CLANKTON_BONUS_MCAP_THRESHOLD_USD = 250_000;

/**
 * Bonus guesses per day for CLANKTON holders when market cap < $250k
 */
export const CLANKTON_BONUS_GUESSES_TIER_LOW = 2;

/**
 * Bonus guesses per day for CLANKTON holders when market cap >= $250k
 */
export const CLANKTON_BONUS_GUESSES_TIER_HIGH = 3;

/**
 * Current CLANKTON market cap in USD
 * Set via environment variable CLANKTON_MARKET_CAP_USD
 * Will be replaced with live oracle in future milestone
 */
export const CLANKTON_MARKET_CAP_USD = Number(
  process.env.CLANKTON_MARKET_CAP_USD ?? '0'
);

/**
 * Get the current CLANKTON holder bonus guesses based on market cap
 *
 * @param marketCapUsd - Current market cap in USD (defaults to env var)
 * @returns Number of bonus guesses (2 if below threshold, 3 if at/above)
 */
export function getClanktonHolderBonusGuesses(
  marketCapUsd: number = CLANKTON_MARKET_CAP_USD
): number {
  return marketCapUsd >= CLANKTON_BONUS_MCAP_THRESHOLD_USD
    ? CLANKTON_BONUS_GUESSES_TIER_HIGH
    : CLANKTON_BONUS_GUESSES_TIER_LOW;
}

/**
 * Get the current CLANKTON bonus tier info for display purposes
 *
 * @param marketCapUsd - Current market cap in USD (defaults to env var)
 * @returns Object with tier info for display
 */
export function getClanktonBonusTierInfo(
  marketCapUsd: number = CLANKTON_MARKET_CAP_USD
): {
  bonusGuesses: number;
  tier: 'low' | 'high';
  marketCapUsd: number;
  thresholdUsd: number;
  isAboveThreshold: boolean;
} {
  const isAboveThreshold = marketCapUsd >= CLANKTON_BONUS_MCAP_THRESHOLD_USD;
  return {
    bonusGuesses: isAboveThreshold
      ? CLANKTON_BONUS_GUESSES_TIER_HIGH
      : CLANKTON_BONUS_GUESSES_TIER_LOW,
    tier: isAboveThreshold ? 'high' : 'low',
    marketCapUsd,
    thresholdUsd: CLANKTON_BONUS_MCAP_THRESHOLD_USD,
    isAboveThreshold,
  };
}

/**
 * Format market cap for display
 *
 * @param marketCapUsd - Market cap in USD
 * @returns Formatted string (e.g., "$150k", "$1.2M")
 */
export function formatMarketCap(marketCapUsd: number): string {
  if (marketCapUsd >= 1_000_000) {
    return `$${(marketCapUsd / 1_000_000).toFixed(1)}M`;
  } else if (marketCapUsd >= 1_000) {
    return `$${Math.round(marketCapUsd / 1_000)}k`;
  } else {
    return `$${marketCapUsd}`;
  }
}

// =============================================================================
// Milestone 6.3: Guess Pack Configuration
// =============================================================================

/**
 * Guess pack size (guesses per pack)
 */
export const GUESS_PACK_SIZE = 3;

/**
 * Maximum guess packs purchasable per day
 */
export const MAX_PACKS_PER_DAY = 3;

/**
 * Price per guess pack in ETH
 * Can be overridden via GUESS_PACK_PRICE_ETH env variable
 */
export const GUESS_PACK_PRICE_ETH = process.env.GUESS_PACK_PRICE_ETH || '0.0003';

/**
 * Get pack pricing info for display
 */
export function getPackPricingInfo(): {
  pricePerPack: string;
  guessesPerPack: number;
  maxPacksPerDay: number;
  packOptions: Array<{
    packCount: number;
    guessCount: number;
    totalPrice: string;
  }>;
} {
  const priceNum = parseFloat(GUESS_PACK_PRICE_ETH);

  return {
    pricePerPack: GUESS_PACK_PRICE_ETH,
    guessesPerPack: GUESS_PACK_SIZE,
    maxPacksPerDay: MAX_PACKS_PER_DAY,
    packOptions: [
      {
        packCount: 1,
        guessCount: GUESS_PACK_SIZE,
        totalPrice: GUESS_PACK_PRICE_ETH,
      },
      {
        packCount: 2,
        guessCount: GUESS_PACK_SIZE * 2,
        totalPrice: (priceNum * 2).toFixed(4),
      },
      {
        packCount: 3,
        guessCount: GUESS_PACK_SIZE * 3,
        totalPrice: (priceNum * 3).toFixed(4),
      },
    ],
  };
}

// =============================================================================
// Milestone 6.4: Animation Debug Configuration
// =============================================================================

/**
 * Debug flag for slowing down wheel animations
 * Set NEXT_PUBLIC_WHEEL_ANIMATION_DEBUG_SLOW=true in .env to enable
 *
 * When enabled:
 * - Word wheel scroll animations are 3x slower
 * - CSS transitions are 3x slower
 * - Useful for debugging animation timing and visual artifacts
 *
 * Note: This is a NEXT_PUBLIC_ variable so it's available on the client side
 */
export const WHEEL_ANIMATION_DEBUG_SLOW = process.env.NEXT_PUBLIC_WHEEL_ANIMATION_DEBUG_SLOW === 'true';

/**
 * Animation timing configuration
 * These values control the word wheel animation performance
 */
export const WHEEL_ANIMATION_CONFIG = {
  /** Minimum scroll animation duration in milliseconds */
  durationMin: 100,
  /** Maximum scroll animation duration in milliseconds (caps long jumps like A->Z) */
  durationMax: 250,
  /** Default CSS transition duration in milliseconds */
  cssTransition: 200,
  /** Multiplier applied when debug slow mode is enabled */
  debugMultiplier: 3,
};

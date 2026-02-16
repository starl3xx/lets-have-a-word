/**
 * Economy Configuration
 * Milestone 5.4c: $WORD Token Bonus Market Cap Tiers (formerly CLANKTON)
 * Milestone 6.3: Guess Pack Configuration
 * Milestone 6.4: Animation Debug Settings
 * Milestone 14: $WORD Token Integration — tiered holder bonuses, burn words, top-10 rewards
 *
 * Centralized configuration for economy-related constants
 * including $WORD holder bonuses, market cap thresholds,
 * and guess pack pricing.
 */

// =============================================================================
// Milestone 14: $WORD Holder Bonus Tier Matrix
// =============================================================================

/**
 * Market cap breakpoints (USD) for holder tier thresholds
 */
export const MCAP_TIER_1 = 150_000; // $150K
export const MCAP_TIER_2 = 300_000; // $300K

/**
 * Balance thresholds in whole tokens (without 18 decimals) per market cap tier
 * Each tier has 3 levels: +1, +2, +3 bonus guesses
 */
export const HOLDER_TIER_MATRIX = {
  low: {   // mcap < $150K
    bonus1: 100_000_000,  // 100M tokens → +1
    bonus2: 200_000_000,  // 200M tokens → +2
    bonus3: 300_000_000,  // 300M tokens → +3
  },
  mid: {   // $150K <= mcap < $300K
    bonus1: 50_000_000,   // 50M tokens → +1
    bonus2: 100_000_000,  // 100M tokens → +2
    bonus3: 150_000_000,  // 150M tokens → +3
  },
  high: {  // mcap >= $300K
    bonus1: 25_000_000,   // 25M tokens → +1
    bonus2: 50_000_000,   // 50M tokens → +2
    bonus3: 75_000_000,   // 75M tokens → +3
  },
};

/**
 * Get the tier thresholds (in whole tokens) for a given market cap
 */
export function getHolderTierThresholds(marketCapUsd: number): typeof HOLDER_TIER_MATRIX.low {
  if (marketCapUsd >= MCAP_TIER_2) return HOLDER_TIER_MATRIX.high;
  if (marketCapUsd >= MCAP_TIER_1) return HOLDER_TIER_MATRIX.mid;
  return HOLDER_TIER_MATRIX.low;
}

/**
 * Current $WORD market cap in USD
 * Set via environment variable WORD_MARKET_CAP_USD
 * Updated by live oracle via cron job
 */
export const WORD_MARKET_CAP_USD = Number(
  process.env.WORD_MARKET_CAP_USD ?? '0'
);

/**
 * @deprecated Use getHolderTierThresholds() — kept for backward compat during migration
 */
export const WORD_HOLDER_THRESHOLD = 100_000_000;

/**
 * @deprecated Use getHolderTierThresholds() with market cap
 */
export const WORD_BONUS_MCAP_THRESHOLD_USD = 250_000;

/**
 * @deprecated Replaced by tier matrix
 */
export const WORD_BONUS_GUESSES_TIER_LOW = 2;

/**
 * @deprecated Replaced by tier matrix
 */
export const WORD_BONUS_GUESSES_TIER_HIGH = 3;

/**
 * Get the current $WORD holder bonus guesses based on market cap
 * Milestone 14: Now returns tier-appropriate max (for backward compat uses max tier value)
 *
 * @param marketCapUsd - Current market cap in USD (defaults to env var)
 * @returns Number of bonus guesses (1, 2, or 3)
 */
export function getWordHolderBonusGuesses(
  marketCapUsd: number = WORD_MARKET_CAP_USD
): number {
  // Backward compat: this is called with a binary check from daily-limits.ts
  // After M14, daily-limits calls getWordBonusTier() directly for the tier value.
  // This function is now only used as a fallback.
  if (marketCapUsd >= MCAP_TIER_2) return 3;
  if (marketCapUsd >= MCAP_TIER_1) return 2;
  return 2; // Keep at 2 for backward compat when called from legacy code
}

/**
 * Get the current $WORD bonus tier info for display purposes
 *
 * @param marketCapUsd - Current market cap in USD (defaults to env var)
 * @returns Object with tier info for display
 */
export function getWordBonusTierInfo(
  marketCapUsd: number = WORD_MARKET_CAP_USD
): {
  bonusGuesses: number;
  tier: 'low' | 'mid' | 'high';
  marketCapUsd: number;
  thresholds: typeof HOLDER_TIER_MATRIX.low;
} {
  const tier = marketCapUsd >= MCAP_TIER_2 ? 'high'
    : marketCapUsd >= MCAP_TIER_1 ? 'mid'
    : 'low';
  const thresholds = getHolderTierThresholds(marketCapUsd);
  return {
    bonusGuesses: 3, // max possible
    tier,
    marketCapUsd,
    thresholds,
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
// Milestone 14: Burn Words Configuration
// =============================================================================

/** Number of burn words selected per round */
export const BURN_WORDS_PER_ROUND = 5;

/** Amount of $WORD burned per burn word discovery (5M with 18 decimals) */
export const BURN_WORD_AMOUNT = '5000000000000000000000000'; // 5M * 10^18

/** Amount in whole tokens for display */
export const BURN_WORD_AMOUNT_DISPLAY = 5_000_000;

// =============================================================================
// Milestone 14: Bonus Words Configuration
// =============================================================================

/** Number of bonus words selected per round */
export const BONUS_WORDS_PER_ROUND = 10;

/** Bonus word reward amount based on market cap */
export function getBonusWordRewardAmount(marketCapUsd: number = WORD_MARKET_CAP_USD): string {
  // >= $150K mcap: 2.5M $WORD, below: 5M $WORD
  return marketCapUsd >= MCAP_TIER_1
    ? '2500000000000000000000000'  // 2.5M * 10^18
    : '5000000000000000000000000'; // 5M * 10^18
}

// =============================================================================
// Milestone 14: Top 10 $WORD Rewards
// =============================================================================

/** Percentage distribution for top 10 $WORD rewards (sums to 100) */
export const TOP10_WORD_PERCENTAGES = [19, 16, 14, 11, 10, 6, 6, 6, 6, 6];

/**
 * Calculate $WORD reward amounts for top 10 players
 * @param marketCapUsd - Current market cap
 * @returns Array of amounts in wei (up to 10 entries)
 */
export function getTop10WordAmounts(marketCapUsd: number = WORD_MARKET_CAP_USD): string[] {
  // First place base: 10M below $150K, 5M at/above $150K
  const firstPlaceTokens = marketCapUsd >= MCAP_TIER_1 ? 5_000_000n : 10_000_000n;
  const firstPlaceWei = firstPlaceTokens * 10n ** 18n;

  return TOP10_WORD_PERCENTAGES.map(pct => {
    const amount = (firstPlaceWei * BigInt(pct)) / 19n; // Scale relative to 1st place (19%)
    return amount.toString();
  });
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
 * Set via MAX_PACKS_PER_DAY env variable (default: unlimited/999)
 * Use "unlimited" or a high number to remove limits
 */
export const MAX_PACKS_PER_DAY = (() => {
  const envValue = process.env.MAX_PACKS_PER_DAY;
  if (!envValue || envValue.toLowerCase() === 'unlimited') {
    return 999; // Effectively unlimited
  }
  const parsed = parseInt(envValue, 10);
  return isNaN(parsed) ? 999 : parsed;
})();

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

// =============================================================================
// $WORD Token Configuration (legacy — kept for backward compat)
// =============================================================================

/**
 * @deprecated Use HOLDER_TIER_MATRIX with getWordBonusTier() from word-token.ts
 */
export const WORD_TOKEN_HOLDER_THRESHOLD = 1_000_000;

/**
 * @deprecated Use getWordBonusTier() from word-token.ts
 */
export const WORD_TOKEN_BONUS_GUESSES = 1;

/**
 * @deprecated Use getWordBonusTier() from word-token.ts
 */
export function getWordTokenHolderBonusGuesses(): number {
  return WORD_TOKEN_BONUS_GUESSES;
}

/**
 * @deprecated Use getWordBonusTierInfo() instead
 */
export function getWordTokenBonusInfo(): {
  bonusGuesses: number;
  thresholdTokens: number;
  isEnabled: boolean;
} {
  return {
    bonusGuesses: WORD_TOKEN_BONUS_GUESSES,
    thresholdTokens: WORD_TOKEN_HOLDER_THRESHOLD,
    isEnabled: true,
  };
}

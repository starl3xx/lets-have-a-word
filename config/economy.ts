/**
 * Economy Configuration
 * Milestone 5.4c: CLANKTON Bonus Market Cap Tiers
 *
 * Centralized configuration for economy-related constants
 * including CLANKTON holder bonuses and market cap thresholds.
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

/**
 * Pack Pricing Module
 * Milestone 7.1: Guess pack economics refinement
 *
 * Dynamic pricing for guess packs based on round progress.
 * Late-round pricing begins after Top-10 locks (750 guesses).
 *
 * Price schedule (1 pack = 3 guesses):
 * - 0–749 guesses   → 0.00030 ETH (BASE)
 * - 750–1249 guesses → 0.00045 ETH (LATE_1)
 * - 1250+ guesses   → 0.00060 ETH (LATE_2, cap)
 */

// =============================================================================
// Constants (all values in wei for precision)
// =============================================================================

/** Guess count at which late-round pricing begins (matches Top-10 lock) */
export const PRICE_RAMP_START_GUESSES = 750;

/** Number of guesses per price step after ramp starts */
export const PRICE_STEP_GUESSES = 500;

/** Base pack price: 0.0003 ETH in wei */
export const BASE_PACK_PRICE_WEI = 300000000000000n; // 0.0003 ETH

/** Price increase per step: 0.00015 ETH in wei */
export const PRICE_STEP_INCREASE_WEI = 150000000000000n; // 0.00015 ETH

/** Maximum pack price: 0.0006 ETH in wei (cap) */
export const MAX_PACK_PRICE_WEI = 600000000000000n; // 0.0006 ETH

// =============================================================================
// Pricing Phase Enum
// =============================================================================

export type PricingPhase = 'BASE' | 'LATE_1' | 'LATE_2';

// =============================================================================
// Core Pricing Function
// =============================================================================

/**
 * Calculate pack price in wei based on total guesses in round
 *
 * @param totalGuessesInRound - Current total guesses in the round (must be >= 0)
 * @returns Pack price in wei as bigint
 *
 * @example
 * getPackPriceWei(0)    // 300000000000000n (0.0003 ETH)
 * getPackPriceWei(749)  // 300000000000000n (0.0003 ETH)
 * getPackPriceWei(750)  // 450000000000000n (0.00045 ETH)
 * getPackPriceWei(1249) // 450000000000000n (0.00045 ETH)
 * getPackPriceWei(1250) // 600000000000000n (0.0006 ETH)
 * getPackPriceWei(2000) // 600000000000000n (0.0006 ETH, capped)
 */
export function getPackPriceWei(totalGuessesInRound: number): bigint {
  // Validate input
  if (totalGuessesInRound < 0) {
    throw new Error('totalGuessesInRound must be non-negative');
  }

  // Before ramp starts, return base price
  if (totalGuessesInRound < PRICE_RAMP_START_GUESSES) {
    return BASE_PACK_PRICE_WEI;
  }

  // Calculate number of price steps after ramp starts
  // At 750: steps = floor((750-750)/500) + 1 = 1
  // At 1249: steps = floor((1249-750)/500) + 1 = 1
  // At 1250: steps = floor((1250-750)/500) + 1 = 2
  const steps = Math.floor(
    (totalGuessesInRound - PRICE_RAMP_START_GUESSES) / PRICE_STEP_GUESSES
  ) + 1;

  // Calculate price with step increases
  const price = BASE_PACK_PRICE_WEI + BigInt(steps) * PRICE_STEP_INCREASE_WEI;

  // Cap at maximum price
  return price > MAX_PACK_PRICE_WEI ? MAX_PACK_PRICE_WEI : price;
}

/**
 * Get the current pricing phase based on total guesses
 *
 * @param totalGuessesInRound - Current total guesses in the round
 * @returns Pricing phase enum value
 */
export function getPricingPhase(totalGuessesInRound: number): PricingPhase {
  if (totalGuessesInRound < PRICE_RAMP_START_GUESSES) {
    return 'BASE';
  }
  if (totalGuessesInRound < PRICE_RAMP_START_GUESSES + PRICE_STEP_GUESSES) {
    return 'LATE_1';
  }
  return 'LATE_2';
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Convert wei to ETH string with proper decimal formatting
 *
 * @param wei - Amount in wei
 * @param decimals - Number of decimal places (default: 5 for display, up to 18 for precision)
 * @returns Formatted ETH string
 */
export function weiToEthString(wei: bigint, decimals: number = 5): string {
  const weiStr = wei.toString().padStart(19, '0'); // Pad to at least 18+1 digits
  const ethIntPart = weiStr.slice(0, -18) || '0';
  const ethDecPart = weiStr.slice(-18).padStart(18, '0');

  // Take requested decimal places
  const truncatedDec = ethDecPart.slice(0, decimals);

  // Remove trailing zeros for cleaner display
  const trimmedDec = truncatedDec.replace(/0+$/, '') || '0';

  return ethIntPart === '0' && trimmedDec === '0'
    ? '0'
    : `${ethIntPart}.${trimmedDec.padEnd(decimals, '0').slice(0, decimals)}`;
}

/**
 * Get complete pack pricing info for API response
 *
 * @param totalGuessesInRound - Current total guesses in the round
 * @returns Complete pricing info object
 */
export function getPackPricingDetails(totalGuessesInRound: number): {
  packPriceWei: string;
  packPriceEth: string;
  pricingPhase: PricingPhase;
  totalGuessesInRound: number;
  priceRampStartGuesses: number;
  priceStepGuesses: number;
  isLateRoundPricing: boolean;
} {
  const priceWei = getPackPriceWei(totalGuessesInRound);
  const phase = getPricingPhase(totalGuessesInRound);

  return {
    packPriceWei: priceWei.toString(),
    packPriceEth: weiToEthString(priceWei),
    pricingPhase: phase,
    totalGuessesInRound,
    priceRampStartGuesses: PRICE_RAMP_START_GUESSES,
    priceStepGuesses: PRICE_STEP_GUESSES,
    isLateRoundPricing: phase !== 'BASE',
  };
}

/**
 * Calculate total cost for multiple packs
 *
 * @param totalGuessesInRound - Current total guesses in the round
 * @param packCount - Number of packs to purchase
 * @returns Total cost in wei as bigint
 */
export function getTotalPackCostWei(
  totalGuessesInRound: number,
  packCount: number
): bigint {
  if (packCount < 1) {
    throw new Error('packCount must be at least 1');
  }
  return getPackPriceWei(totalGuessesInRound) * BigInt(packCount);
}

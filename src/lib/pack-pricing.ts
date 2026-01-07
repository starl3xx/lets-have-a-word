/**
 * Pack Pricing Module
 * Milestone 7.1: Guess pack economics refinement
 * Milestone X.X: Uncapped purchases with tiered multipliers
 *
 * Dynamic pricing for guess packs based on:
 * 1. Round progress (stage-based pricing)
 * 2. Daily pack purchases (volume-based multipliers)
 *
 * Stage-based pricing (1 pack = 3 guesses):
 * - 0–749 guesses   → 0.00030 ETH (BASE)
 * - 750–1249 guesses → 0.00045 ETH (LATE_1)
 * - 1250+ guesses   → 0.00060 ETH (LATE_2, cap)
 *
 * Volume-based multipliers (per day):
 * - Packs 1-3:  1.0× (base price)
 * - Packs 4-6:  1.5× (mid tier)
 * - Packs 7+:   2.0× (high tier)
 *
 * Paid guesses expire at 11:00 UTC daily reset.
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
// Volume Tier Constants
// =============================================================================

/** Multiplier tiers based on daily pack purchases */
export const VOLUME_TIERS = {
  BASE: { maxPacks: 3, multiplier: 1.0 },
  MID: { maxPacks: 6, multiplier: 1.5 },
  HIGH: { maxPacks: Infinity, multiplier: 2.0 },
} as const;

/** Volume tier names */
export type VolumeTier = 'BASE' | 'MID' | 'HIGH';

// =============================================================================
// Pricing Phase Enum
// =============================================================================

export type PricingPhase = 'BASE' | 'LATE_1' | 'LATE_2';

// =============================================================================
// Volume Tier Functions
// =============================================================================

/**
 * Get the volume tier based on packs already purchased today
 *
 * @param packsPurchasedToday - Number of packs already purchased today (before this purchase)
 * @returns Volume tier name
 *
 * @example
 * getVolumeTier(0)  // 'BASE' (buying packs 1-3)
 * getVolumeTier(2)  // 'BASE' (buying pack 3)
 * getVolumeTier(3)  // 'MID'  (buying packs 4-6)
 * getVolumeTier(5)  // 'MID'  (buying pack 6)
 * getVolumeTier(6)  // 'HIGH' (buying packs 7+)
 * getVolumeTier(10) // 'HIGH' (buying pack 11+)
 */
export function getVolumeTier(packsPurchasedToday: number): VolumeTier {
  if (packsPurchasedToday < VOLUME_TIERS.BASE.maxPacks) {
    return 'BASE';
  }
  if (packsPurchasedToday < VOLUME_TIERS.MID.maxPacks) {
    return 'MID';
  }
  return 'HIGH';
}

/**
 * Get the multiplier for the current volume tier
 *
 * @param packsPurchasedToday - Number of packs already purchased today
 * @returns Multiplier (1.0, 1.5, or 2.0)
 */
export function getVolumeMultiplier(packsPurchasedToday: number): number {
  const tier = getVolumeTier(packsPurchasedToday);
  return VOLUME_TIERS[tier].multiplier;
}

/**
 * Get how many more packs can be purchased at the current tier price
 *
 * @param packsPurchasedToday - Number of packs already purchased today
 * @returns Number of packs remaining at current tier price
 */
export function getPacksRemainingAtCurrentTier(packsPurchasedToday: number): number {
  if (packsPurchasedToday < VOLUME_TIERS.BASE.maxPacks) {
    return VOLUME_TIERS.BASE.maxPacks - packsPurchasedToday;
  }
  if (packsPurchasedToday < VOLUME_TIERS.MID.maxPacks) {
    return VOLUME_TIERS.MID.maxPacks - packsPurchasedToday;
  }
  // HIGH tier has unlimited packs
  return Infinity;
}

/**
 * Get the next tier's multiplier (or null if already at highest)
 *
 * @param packsPurchasedToday - Number of packs already purchased today
 * @returns Next tier multiplier or null
 */
export function getNextTierMultiplier(packsPurchasedToday: number): number | null {
  const tier = getVolumeTier(packsPurchasedToday);
  if (tier === 'BASE') return VOLUME_TIERS.MID.multiplier;
  if (tier === 'MID') return VOLUME_TIERS.HIGH.multiplier;
  return null; // Already at highest tier
}

// =============================================================================
// Core Pricing Functions
// =============================================================================

/**
 * Calculate base pack price in wei based on total guesses in round (stage-based)
 * Does NOT include volume multiplier - use getPackPriceWithMultiplier for final price
 *
 * @param totalGuessesInRound - Current total guesses in the round (must be >= 0)
 * @returns Base pack price in wei as bigint (before volume multiplier)
 *
 * @example
 * getBasePackPriceWei(0)    // 300000000000000n (0.0003 ETH)
 * getBasePackPriceWei(749)  // 300000000000000n (0.0003 ETH)
 * getBasePackPriceWei(750)  // 450000000000000n (0.00045 ETH)
 * getBasePackPriceWei(1250) // 600000000000000n (0.0006 ETH)
 */
export function getBasePackPriceWei(totalGuessesInRound: number): bigint {
  // Validate input
  if (totalGuessesInRound < 0) {
    throw new Error('totalGuessesInRound must be non-negative');
  }

  // Before ramp starts, return base price
  if (totalGuessesInRound < PRICE_RAMP_START_GUESSES) {
    return BASE_PACK_PRICE_WEI;
  }

  // Calculate number of price steps after ramp starts
  const steps = Math.floor(
    (totalGuessesInRound - PRICE_RAMP_START_GUESSES) / PRICE_STEP_GUESSES
  ) + 1;

  // Calculate price with step increases
  const price = BASE_PACK_PRICE_WEI + BigInt(steps) * PRICE_STEP_INCREASE_WEI;

  // Cap at maximum price
  return price > MAX_PACK_PRICE_WEI ? MAX_PACK_PRICE_WEI : price;
}

/**
 * Calculate pack price in wei with volume multiplier applied
 *
 * @param totalGuessesInRound - Current total guesses in the round
 * @param packsPurchasedToday - Packs already purchased today (before this purchase)
 * @returns Final pack price in wei as bigint
 *
 * @example
 * // At stage BASE (0-749 guesses), buying first pack (1× multiplier)
 * getPackPriceWithMultiplier(100, 0)  // 300000000000000n (0.0003 ETH)
 *
 * // At stage BASE, buying 4th pack (1.5× multiplier)
 * getPackPriceWithMultiplier(100, 3)  // 450000000000000n (0.00045 ETH)
 *
 * // At stage LATE_1 (750-1249 guesses), buying 7th pack (2× multiplier)
 * getPackPriceWithMultiplier(800, 6)  // 900000000000000n (0.0009 ETH)
 */
export function getPackPriceWithMultiplier(
  totalGuessesInRound: number,
  packsPurchasedToday: number
): bigint {
  const basePrice = getBasePackPriceWei(totalGuessesInRound);
  const multiplier = getVolumeMultiplier(packsPurchasedToday);

  // Apply multiplier (multiply first, then divide to maintain precision)
  // multiplier is 1.0, 1.5, or 2.0, so we can use ×10 then ÷10
  const multiplierX10 = Math.round(multiplier * 10);
  return (basePrice * BigInt(multiplierX10)) / 10n;
}

/**
 * @deprecated Use getBasePackPriceWei instead for base price, or getPackPriceWithMultiplier for final price
 * Kept for backwards compatibility - returns base price without multiplier
 */
export function getPackPriceWei(totalGuessesInRound: number): bigint {
  return getBasePackPriceWei(totalGuessesInRound);
}

/**
 * Get the current pricing phase based on total guesses (stage)
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
 * Get complete pack pricing info for API response (with volume tier info)
 *
 * @param totalGuessesInRound - Current total guesses in the round
 * @param packsPurchasedToday - Packs already purchased today
 * @returns Complete pricing info object
 */
export function getPackPricingDetails(
  totalGuessesInRound: number,
  packsPurchasedToday: number = 0
): {
  packPriceWei: string;
  packPriceEth: string;
  basePriceWei: string;
  basePriceEth: string;
  pricingPhase: PricingPhase;
  volumeTier: VolumeTier;
  volumeMultiplier: number;
  packsPurchasedToday: number;
  packsRemainingAtCurrentTier: number;
  nextTierMultiplier: number | null;
  totalGuessesInRound: number;
  priceRampStartGuesses: number;
  priceStepGuesses: number;
  isLateRoundPricing: boolean;
} {
  const basePrice = getBasePackPriceWei(totalGuessesInRound);
  const finalPrice = getPackPriceWithMultiplier(totalGuessesInRound, packsPurchasedToday);
  const phase = getPricingPhase(totalGuessesInRound);
  const volumeTier = getVolumeTier(packsPurchasedToday);

  return {
    packPriceWei: finalPrice.toString(),
    packPriceEth: weiToEthString(finalPrice),
    basePriceWei: basePrice.toString(),
    basePriceEth: weiToEthString(basePrice),
    pricingPhase: phase,
    volumeTier,
    volumeMultiplier: getVolumeMultiplier(packsPurchasedToday),
    packsPurchasedToday,
    packsRemainingAtCurrentTier: getPacksRemainingAtCurrentTier(packsPurchasedToday),
    nextTierMultiplier: getNextTierMultiplier(packsPurchasedToday),
    totalGuessesInRound,
    priceRampStartGuesses: PRICE_RAMP_START_GUESSES,
    priceStepGuesses: PRICE_STEP_GUESSES,
    isLateRoundPricing: phase !== 'BASE',
  };
}

/**
 * Calculate total cost for multiple packs, accounting for tier transitions
 *
 * When purchasing multiple packs, each pack may fall into different tiers.
 * For example, if user has 2 packs today and buys 3 more:
 * - Pack 3: 1× price (completes BASE tier)
 * - Packs 4-5: 1.5× price (MID tier)
 *
 * @param totalGuessesInRound - Current total guesses in the round
 * @param packCount - Number of packs to purchase
 * @param packsPurchasedToday - Packs already purchased today
 * @returns Total cost in wei as bigint
 */
export function getTotalPackCostWei(
  totalGuessesInRound: number,
  packCount: number,
  packsPurchasedToday: number = 0
): bigint {
  if (packCount < 1) {
    throw new Error('packCount must be at least 1');
  }

  let totalCost = 0n;
  const basePrice = getBasePackPriceWei(totalGuessesInRound);

  // Calculate cost for each pack, accounting for tier transitions
  for (let i = 0; i < packCount; i++) {
    const packsBeforeThisPack = packsPurchasedToday + i;
    const multiplier = getVolumeMultiplier(packsBeforeThisPack);
    const multiplierX10 = Math.round(multiplier * 10);
    const packCost = (basePrice * BigInt(multiplierX10)) / 10n;
    totalCost += packCost;
  }

  return totalCost;
}

/**
 * Get breakdown of costs when purchasing multiple packs across tiers
 *
 * @param totalGuessesInRound - Current total guesses in the round
 * @param packCount - Number of packs to purchase
 * @param packsPurchasedToday - Packs already purchased today
 * @returns Array of pack costs with tier info
 */
export function getPackCostBreakdown(
  totalGuessesInRound: number,
  packCount: number,
  packsPurchasedToday: number = 0
): Array<{
  packNumber: number;
  tier: VolumeTier;
  multiplier: number;
  priceWei: string;
  priceEth: string;
}> {
  const basePrice = getBasePackPriceWei(totalGuessesInRound);
  const breakdown = [];

  for (let i = 0; i < packCount; i++) {
    const packsBeforeThisPack = packsPurchasedToday + i;
    const tier = getVolumeTier(packsBeforeThisPack);
    const multiplier = getVolumeMultiplier(packsBeforeThisPack);
    const multiplierX10 = Math.round(multiplier * 10);
    const packCost = (basePrice * BigInt(multiplierX10)) / 10n;

    breakdown.push({
      packNumber: packsBeforeThisPack + 1, // 1-indexed for display
      tier,
      multiplier,
      priceWei: packCost.toString(),
      priceEth: weiToEthString(packCost),
    });
  }

  return breakdown;
}

/**
 * Get the timestamp of the next 11:00 UTC reset
 *
 * @returns ISO string of next reset time
 */
export function getNextResetTime(): string {
  const now = new Date();
  const reset = new Date(now);

  // Set to 11:00 UTC
  reset.setUTCHours(11, 0, 0, 0);

  // If we're past 11:00 UTC today, move to tomorrow
  if (now.getUTCHours() >= 11) {
    reset.setUTCDate(reset.getUTCDate() + 1);
  }

  return reset.toISOString();
}

/**
 * Get milliseconds until next 11:00 UTC reset
 *
 * @returns Milliseconds until reset
 */
export function getMillisUntilReset(): number {
  const now = new Date();
  const reset = new Date(now);

  reset.setUTCHours(11, 0, 0, 0);

  if (now.getUTCHours() >= 11) {
    reset.setUTCDate(reset.getUTCDate() + 1);
  }

  return reset.getTime() - now.getTime();
}

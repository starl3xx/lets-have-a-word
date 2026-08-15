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
 * The holder ladder is USD-denominated (decided 2026-08-15): $25 / $50 / $75
 * of $WORD, held or staked, for +1 / +2 / +3 daily guesses. This replaced the
 * token-fixed bracket matrix (100M/200M/300M stepping down at mcap tiers);
 * the chosen USD amounts sit within a dollar of the old token rungs at the
 * decision-day price, so holders kept their tiers at the switch.
 */
export const HOLDER_TIER_USD = {
  bonus1: 25,
  bonus2: 50,
  bonus3: 75,
} as const;

export interface HolderTierThresholds {
  bonus1: number;
  bonus2: number;
  bonus3: number;
}

/**
 * Total $WORD supply in whole tokens, for USD→token conversion. Burns nibble
 * at this (~0.2% so far); the ladder is a threshold, not an accounting figure,
 * so a fixed constant is fine and avoids an onchain read on the tier path.
 */
export const WORD_TOTAL_SUPPLY_TOKENS = 99_900_000_000;

/**
 * Fallback market cap when the oracle env is unset or zero. Tiers must never
 * divide by zero, and holders keep their bonuses through an oracle outage —
 * the same fail-open direction every gate in this codebase takes.
 */
export const WORD_MCAP_FALLBACK_USD = 25_000;

/**
 * Get the tier thresholds (in whole tokens) for a given market cap.
 * USD targets divided by the implied token price (mcap / supply).
 */
export function getHolderTierThresholds(marketCapUsd: number): HolderTierThresholds {
  const mcap = marketCapUsd > 0 ? marketCapUsd : WORD_MCAP_FALLBACK_USD;
  const priceUsd = mcap / WORD_TOTAL_SUPPLY_TOKENS;
  return {
    bonus1: Math.ceil(HOLDER_TIER_USD.bonus1 / priceUsd),
    bonus2: Math.ceil(HOLDER_TIER_USD.bonus2 / priceUsd),
    bonus3: Math.ceil(HOLDER_TIER_USD.bonus3 / priceUsd),
  };
}

// =============================================================================
// Reward Gate (round 34+): hold or stake $3 of $WORD to play
// =============================================================================

/**
 * The play bar in USD. Anyone whose first guess predates round 28 (the first
 * botted round) is grandfathered past it; everyone else needs this much $WORD,
 * held or staked, to play. Frozen into a token amount per round from the
 * round's seed price (see src/lib/reward-gate.ts).
 */
export const REWARD_GATE_PLAY_USD = (() => {
  // Validated: garbage, an empty string, zero or a negative value would each
  // silently zero the bar while the gate flag still reads enabled — a
  // gate-wide fail-open caused by an env typo. Bad input falls back to $3.
  const parsed = Number(process.env.REWARD_GATE_MIN_USD ?? '3');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
})();

/** Last round of the grandfather window: first guess in rounds 1–27 plays free. */
export const REWARD_GATE_GRANDFATHER_LAST_ROUND = 27;

/** Master switch. Ships off; enabled with the round-34 launch. */
export function isRewardGateEnabled(): boolean {
  return process.env.REWARD_GATE_ENABLED === 'true';
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
 * Public chart/pool page for $WORD, used by every "view the token" link.
 *
 * GeckoTerminal rather than DexScreener: DexScreener stopped indexing $WORD in
 * Aug 2026, so its pages no longer resolve for this token.
 * Override with NEXT_PUBLIC_WORD_POOL_ADDRESS if the pool ever moves.
 * Uses || not ?? so a blank env var (the .env.example default) falls through
 * to the hardcoded id rather than building a pool URL with no id.
 */
export const WORD_POOL_ADDRESS =
  process.env.NEXT_PUBLIC_WORD_POOL_ADDRESS?.trim() ||
  '0xc5db937916d2c6f96142a6886ba8b5b74e14949c9cc1080a676ab2a5eb1ea275';

export const WORD_POOL_URL = `https://www.geckoterminal.com/base/pools/${WORD_POOL_ADDRESS}`;

/**
 * USD target every $WORD round is seeded at, in cents. $20.00 by default.
 *
 * Denominated in USD rather than tokens so a round is worth the same to a
 * player regardless of where $WORD is trading; WordJackpot converts it at its
 * own stored oracle price at seed time and refuses if that price is stale.
 *
 * Deliberately not a token count: a fixed token seed would make the prize swing
 * with the market, and the treasury's runway is what should absorb price moves,
 * not the player's experience.
 *
 * Parsed defensively — a malformed env var must not silently seed $0 (which
 * WordJackpot would reject as below minSeedTokens) or some absurd amount.
 */
export const WORD_SEED_USD_CENTS = (() => {
  const raw = process.env.WORD_SEED_USD_CENTS?.trim();
  if (!raw) return 2000;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 100_000) {
    console.warn(`[economy] Ignoring invalid WORD_SEED_USD_CENTS="${raw}" — using 2000 ($20.00)`);
    return 2000;
  }
  return parsed;
})();

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
  thresholds: HolderTierThresholds;
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
// Oracle-priced $WORD rewards (round 34+)
// =============================================================================

/**
 * USD value of a bonus word find and of first place in the top 10.
 *
 * The tier-stepped token amounts above are what rounds 1-33 paid: a fixed
 * number of tokens with one crude step at $150K market cap. That makes the
 * reward's real value drift with the price — 5M tokens was worth $1.28 at the
 * time of writing and would be worth $2.56 after a 2x. Pricing in USD keeps
 * what a player earns stable and moves the price exposure onto the treasury,
 * which is the party that can absorb it.
 */
export const BONUS_WORD_USD_CENTS = 150; // $1.50
export const TOP10_FIRST_PLACE_USD_CENTS = 300; // $3.00

/**
 * Implied USD value of the whole top-10 pool.
 *
 * First place takes 19% (TOP10_WORD_PERCENTAGES[0]), so a $3.00 first place
 * means a $15.79 pool. Derived rather than hardcoded so the two can never
 * drift apart.
 */
export const TOP10_POOL_USD_CENTS = Math.round((TOP10_FIRST_PLACE_USD_CENTS * 100) / 19);

/**
 * Hard ceilings on what a single reward may cost in tokens.
 *
 * A USD-pegged reward costs more tokens as the price falls, without limit — a
 * 100x-too-low oracle reading would pay 100x the tokens. These bind only after
 * roughly a 50% price collapse from the level at the time of writing
 * (~$0.000000256), so they should never fire in normal conditions; they exist
 * so a bad price cannot drain the tranche in a single round.
 */
export const BONUS_WORD_MAX_TOKENS_WEI = 12_000_000n * 10n ** 18n;
export const TOP10_FIRST_PLACE_MAX_TOKENS_WEI = 24_000_000n * 10n ** 18n;

/**
 * Convert a USD amount to $WORD wei at a 1e18-scaled price, capped.
 *
 * Mirrors WordJackpot.seedTokensFor: tokensWei = usdCents * 1e34 / priceE18,
 * with the same truncating division.
 */
export function usdCentsToWordWei(
  usdCents: number,
  priceE18: bigint,
  maxTokensWei: bigint
): bigint {
  if (priceE18 <= 0n) {
    throw new Error('Cannot price a $WORD reward with a zero price');
  }
  const uncapped = (BigInt(usdCents) * 10n ** 34n) / priceE18;
  return uncapped > maxTokensWei ? maxTokensWei : uncapped;
}

/** $WORD wei for one bonus word find at the given price. */
export function getBonusWordRewardWei(priceE18: bigint): bigint {
  return usdCentsToWordWei(BONUS_WORD_USD_CENTS, priceE18, BONUS_WORD_MAX_TOKENS_WEI);
}

/**
 * $WORD wei for each of the top 10 at the given price.
 *
 * The cap is applied to the pool via first place, then split by rank, so the
 * rank ratios hold whether or not the cap binds. Capping each rank separately
 * would flatten the curve at exactly the moment the tranche is under stress.
 *
 * Two truncating divisions mean a capped first place can land 1 wei under the
 * ceiling. That is the safe direction, and 1 wei of $WORD is ~2.5e-25 dollars.
 */
export function getTop10WordAmountsWei(priceE18: bigint): bigint[] {
  const poolCapWei = (TOP10_FIRST_PLACE_MAX_TOKENS_WEI * 10000n) / 1900n;
  const poolWei = usdCentsToWordWei(TOP10_POOL_USD_CENTS, priceE18, poolCapWei);
  return TOP10_WORD_PERCENTAGES.map((pct) => (poolWei * BigInt(pct)) / 100n);
}

// =============================================================================
// Staking Reward Period Configuration
// =============================================================================

/** Duration of staking reward periods in seconds (30 days) */
export const REWARDS_DURATION = 30 * 24 * 60 * 60; // 2592000

// =============================================================================
// XP-Boosted Staking Tiers
// =============================================================================

/**
 * XP thresholds that determine staking reward multipliers.
 * Players earn XP through gameplay; higher tiers boost staking yield.
 */
export const XP_STAKING_TIERS = [
  { tier: 0, name: 'Passive',  xpThreshold: 0,      multiplier: 1.00 },
  { tier: 1, name: 'Bronze',   xpThreshold: 1_000,  multiplier: 1.15 },
  { tier: 2, name: 'Silver',   xpThreshold: 5_000,  multiplier: 1.35 },
  { tier: 3, name: 'Gold',     xpThreshold: 15_000, multiplier: 1.60 },
] as const;

export type XpStakingTier = (typeof XP_STAKING_TIERS)[number];

/**
 * Get the XP staking tier for a given total XP amount.
 * Iterates from highest tier down to find the best match.
 */
export function getXpStakingTier(totalXp: number): XpStakingTier {
  for (let i = XP_STAKING_TIERS.length - 1; i >= 0; i--) {
    if (totalXp >= XP_STAKING_TIERS[i].xpThreshold) {
      return XP_STAKING_TIERS[i];
    }
  }
  return XP_STAKING_TIERS[0];
}

/**
 * Get the minimum stake (in whole tokens) required to unlock XP boost.
 * Uses the bonus1 threshold from the holder tier matrix (i.e., the lowest
 * holder tier at the current market cap).
 */
export function getMinStakeForBoost(marketCapUsd: number): number {
  return getHolderTierThresholds(marketCapUsd).bonus1;
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
export const GUESS_PACK_PRICE_ETH = process.env.GUESS_PACK_PRICE_ETH || '0.0004';

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

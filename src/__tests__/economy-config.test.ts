import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  WORD_HOLDER_THRESHOLD,
  WORD_BONUS_MCAP_THRESHOLD_USD,
  WORD_BONUS_GUESSES_TIER_LOW,
  WORD_BONUS_GUESSES_TIER_HIGH,
  getWordHolderBonusGuesses,
  getWordBonusTierInfo,
  formatMarketCap,
  MCAP_TIER_1,
  MCAP_TIER_2,
  HOLDER_TIER_MATRIX,
  getHolderTierThresholds,
  getXpStakingTier,
  XP_STAKING_TIERS,
  getMinStakeForBoost,
  usdCentsToWordWei,
  getBonusWordRewardWei,
  getTop10WordAmountsWei,
  BONUS_WORD_MAX_TOKENS_WEI,
  TOP10_FIRST_PLACE_MAX_TOKENS_WEI,
  TOP10_POOL_USD_CENTS,
  TOP10_FIRST_PLACE_USD_CENTS,
} from '../../config/economy';

/**
 * Economy Config Tests
 * Milestone 5.4c: $WORD Bonus Market Cap Tiers (legacy constants)
 * Milestone 14: 3-tier holder matrix, XP-boosted staking
 */

describe('$WORD Economy Config', () => {
  describe('Legacy Constants (deprecated, kept for backward compat)', () => {
    it('should have correct legacy holder threshold (100M)', () => {
      expect(WORD_HOLDER_THRESHOLD).toBe(100_000_000);
    });

    it('should have correct legacy market cap threshold ($250k)', () => {
      expect(WORD_BONUS_MCAP_THRESHOLD_USD).toBe(250_000);
    });

    it('should have correct legacy tier bonuses (2 low, 3 high)', () => {
      expect(WORD_BONUS_GUESSES_TIER_LOW).toBe(2);
      expect(WORD_BONUS_GUESSES_TIER_HIGH).toBe(3);
    });
  });

  describe('M14 Tier Constants', () => {
    it('should have correct market cap breakpoints', () => {
      expect(MCAP_TIER_1).toBe(150_000);  // $150K
      expect(MCAP_TIER_2).toBe(300_000);  // $300K
    });

    it('should have correct holder tier matrix structure', () => {
      expect(HOLDER_TIER_MATRIX.low.bonus1).toBe(100_000_000);
      expect(HOLDER_TIER_MATRIX.low.bonus2).toBe(200_000_000);
      expect(HOLDER_TIER_MATRIX.low.bonus3).toBe(300_000_000);

      expect(HOLDER_TIER_MATRIX.mid.bonus1).toBe(50_000_000);
      expect(HOLDER_TIER_MATRIX.mid.bonus2).toBe(100_000_000);
      expect(HOLDER_TIER_MATRIX.mid.bonus3).toBe(150_000_000);

      expect(HOLDER_TIER_MATRIX.high.bonus1).toBe(25_000_000);
      expect(HOLDER_TIER_MATRIX.high.bonus2).toBe(50_000_000);
      expect(HOLDER_TIER_MATRIX.high.bonus3).toBe(75_000_000);
    });
  });

  describe('getHolderTierThresholds()', () => {
    it('should return low tier thresholds below $150K', () => {
      expect(getHolderTierThresholds(0)).toBe(HOLDER_TIER_MATRIX.low);
      expect(getHolderTierThresholds(100_000)).toBe(HOLDER_TIER_MATRIX.low);
      expect(getHolderTierThresholds(149_999)).toBe(HOLDER_TIER_MATRIX.low);
    });

    it('should return mid tier thresholds at/above $150K', () => {
      expect(getHolderTierThresholds(150_000)).toBe(HOLDER_TIER_MATRIX.mid);
      expect(getHolderTierThresholds(200_000)).toBe(HOLDER_TIER_MATRIX.mid);
      expect(getHolderTierThresholds(299_999)).toBe(HOLDER_TIER_MATRIX.mid);
    });

    it('should return high tier thresholds at/above $300K', () => {
      expect(getHolderTierThresholds(300_000)).toBe(HOLDER_TIER_MATRIX.high);
      expect(getHolderTierThresholds(500_000)).toBe(HOLDER_TIER_MATRIX.high);
      expect(getHolderTierThresholds(1_000_000)).toBe(HOLDER_TIER_MATRIX.high);
    });
  });

  describe('getWordHolderBonusGuesses()', () => {
    it('should return 2 when market cap is 0 (low tier)', () => {
      expect(getWordHolderBonusGuesses(0)).toBe(2);
    });

    it('should return 2 when market cap is in low tier (< $150K)', () => {
      expect(getWordHolderBonusGuesses(100_000)).toBe(2);
      expect(getWordHolderBonusGuesses(149_999)).toBe(2);
    });

    it('should return 2 when market cap is in mid tier ($150K–$300K)', () => {
      expect(getWordHolderBonusGuesses(150_000)).toBe(2);
      expect(getWordHolderBonusGuesses(250_000)).toBe(2);
      expect(getWordHolderBonusGuesses(299_999)).toBe(2);
    });

    it('should return 3 when market cap is in high tier (>= $300K)', () => {
      expect(getWordHolderBonusGuesses(300_000)).toBe(3);
      expect(getWordHolderBonusGuesses(500_000)).toBe(3);
      expect(getWordHolderBonusGuesses(1_000_000)).toBe(3);
    });
  });

  describe('getWordBonusTierInfo()', () => {
    it('should return low tier info below $150K', () => {
      const info = getWordBonusTierInfo(100_000);

      expect(info.bonusGuesses).toBe(3);
      expect(info.tier).toBe('low');
      expect(info.marketCapUsd).toBe(100_000);
      expect(info.thresholds).toBe(HOLDER_TIER_MATRIX.low);
    });

    it('should return mid tier info at $150K–$300K', () => {
      const info = getWordBonusTierInfo(250_000);

      expect(info.bonusGuesses).toBe(3);
      expect(info.tier).toBe('mid');
      expect(info.marketCapUsd).toBe(250_000);
      expect(info.thresholds).toBe(HOLDER_TIER_MATRIX.mid);
    });

    it('should return high tier info at/above $300K', () => {
      const info = getWordBonusTierInfo(500_000);

      expect(info.bonusGuesses).toBe(3);
      expect(info.tier).toBe('high');
      expect(info.marketCapUsd).toBe(500_000);
      expect(info.thresholds).toBe(HOLDER_TIER_MATRIX.high);
    });
  });

  describe('XP Staking Tiers', () => {
    it('should return Passive tier for 0 XP', () => {
      const tier = getXpStakingTier(0);
      expect(tier.name).toBe('Passive');
      expect(tier.multiplier).toBe(1.00);
    });

    it('should return Bronze tier at 1,000 XP', () => {
      const tier = getXpStakingTier(1_000);
      expect(tier.name).toBe('Bronze');
      expect(tier.multiplier).toBe(1.15);
    });

    it('should return Silver tier at 5,000 XP', () => {
      const tier = getXpStakingTier(5_000);
      expect(tier.name).toBe('Silver');
      expect(tier.multiplier).toBe(1.35);
    });

    it('should return Gold tier at 15,000 XP', () => {
      const tier = getXpStakingTier(15_000);
      expect(tier.name).toBe('Gold');
      expect(tier.multiplier).toBe(1.60);
    });

    it('should return highest qualifying tier', () => {
      // 10,000 XP = Silver (above 5K, below 15K)
      expect(getXpStakingTier(10_000).name).toBe('Silver');
      // 100,000 XP = still Gold (highest tier)
      expect(getXpStakingTier(100_000).name).toBe('Gold');
    });

    it('should have 4 tiers defined', () => {
      expect(XP_STAKING_TIERS).toHaveLength(4);
    });
  });

  describe('getMinStakeForBoost()', () => {
    it('should return bonus1 threshold from holder tier matrix', () => {
      expect(getMinStakeForBoost(0)).toBe(100_000_000);       // low tier
      expect(getMinStakeForBoost(150_000)).toBe(50_000_000);   // mid tier
      expect(getMinStakeForBoost(300_000)).toBe(25_000_000);   // high tier
    });
  });

  describe('formatMarketCap()', () => {
    it('should format values under $1k without suffix', () => {
      expect(formatMarketCap(0)).toBe('$0');
      expect(formatMarketCap(500)).toBe('$500');
      expect(formatMarketCap(999)).toBe('$999');
    });

    it('should format values $1k-$1M with "k" suffix', () => {
      expect(formatMarketCap(1_000)).toBe('$1k');
      expect(formatMarketCap(150_000)).toBe('$150k');
      expect(formatMarketCap(250_000)).toBe('$250k');
      expect(formatMarketCap(999_999)).toBe('$1000k');
    });

    it('should format values >= $1M with "M" suffix', () => {
      expect(formatMarketCap(1_000_000)).toBe('$1.0M');
      expect(formatMarketCap(1_500_000)).toBe('$1.5M');
      expect(formatMarketCap(10_000_000)).toBe('$10.0M');
    });
  });
});

/**
 * WORD_SEED_USD_CENTS is read from the environment at module load, so each case
 * stubs the env and re-imports rather than calling a function. The parsing is
 * defensive because a bad value here does not fail loudly: it decides how much
 * real money every round is seeded with.
 */
describe('WORD_SEED_USD_CENTS', () => {
  async function loadWith(value: string | undefined) {
    vi.resetModules();
    if (value === undefined) {
      vi.stubEnv('WORD_SEED_USD_CENTS', '');
    } else {
      vi.stubEnv('WORD_SEED_USD_CENTS', value);
    }
    const mod = await import('../../config/economy');
    return mod.WORD_SEED_USD_CENTS;
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('defaults to $20.00 when unset', async () => {
    expect(await loadWith(undefined)).toBe(2000);
  });

  it('accepts a valid override', async () => {
    expect(await loadWith('3500')).toBe(3500);
  });

  it('falls back on a non-numeric value', async () => {
    expect(await loadWith('twenty dollars')).toBe(2000);
  });

  it('falls back on zero, which would seed nothing', async () => {
    expect(await loadWith('0')).toBe(2000);
  });

  it('falls back on a negative value', async () => {
    expect(await loadWith('-500')).toBe(2000);
  });

  it('falls back on a fractional value, since cents are integers', async () => {
    expect(await loadWith('2000.5')).toBe(2000);
  });

  it('falls back on an absurdly large value rather than draining the treasury', async () => {
    expect(await loadWith('99999999')).toBe(2000);
  });

  it('ignores surrounding whitespace', async () => {
    expect(await loadWith('  2500  ')).toBe(2500);
  });
});

/**
 * Oracle-priced $WORD rewards.
 *
 * The USD targets are the agreed ones: $1.50 for a bonus word, $3.00 for first
 * place in the top 10. The caps exist because a USD-pegged reward costs more
 * tokens as the price falls, without limit — a 100x-too-low oracle reading
 * would pay 100x the tokens out of a finite tranche.
 */
describe('oracle-priced $WORD rewards', () => {
  // $0.000000256 per token
  const PRICE_E18 = 256_000_000_000n;
  const ONE_TOKEN = 10n ** 18n;

  describe('usdCentsToWordWei', () => {
    it('matches the seedTokensFor formula', () => {
      expect(usdCentsToWordWei(2000, PRICE_E18, 10n ** 40n)).toBe(78_125_000n * ONE_TOKEN);
    });

    it('caps rather than paying an unbounded amount', () => {
      const cap = 1_000_000n * ONE_TOKEN;
      expect(usdCentsToWordWei(2000, PRICE_E18, cap)).toBe(cap);
    });

    it('refuses a zero price instead of dividing by it', () => {
      expect(() => usdCentsToWordWei(150, 0n, 10n ** 40n)).toThrow(/zero price/);
    });
  });

  describe('getBonusWordRewardWei', () => {
    it('pays $1.50 worth at the reference price', () => {
      expect(getBonusWordRewardWei(PRICE_E18)).toBe(5_859_375n * ONE_TOKEN);
    });

    it('pays more tokens as the price falls, preserving the USD value', () => {
      const half = getBonusWordRewardWei(PRICE_E18 / 2n);
      expect(half).toBe(getBonusWordRewardWei(PRICE_E18) * 2n);
    });

    it('does not cap at the reference price or a modest decline', () => {
      // The cap must not bind in normal conditions, or the peg silently stops
      // being a peg. $WORD's all-time low is ~15% below the reference.
      expect(getBonusWordRewardWei(PRICE_E18)).toBeLessThan(BONUS_WORD_MAX_TOKENS_WEI);
      expect(getBonusWordRewardWei((PRICE_E18 * 85n) / 100n)).toBeLessThan(
        BONUS_WORD_MAX_TOKENS_WEI
      );
    });

    it('caps once the price collapses', () => {
      expect(getBonusWordRewardWei(PRICE_E18 / 100n)).toBe(BONUS_WORD_MAX_TOKENS_WEI);
    });
  });

  describe('getTop10WordAmountsWei', () => {
    it('pays first place $3.00 worth at the reference price', () => {
      const amounts = getTop10WordAmountsWei(PRICE_E18);
      // $15.79 pool * 19% = $3.00, within a cent of rounding.
      expect(amounts[0]).toBeGreaterThan(11_700_000n * ONE_TOKEN);
      expect(amounts[0]).toBeLessThan(11_740_000n * ONE_TOKEN);
    });

    it('returns exactly ten amounts', () => {
      expect(getTop10WordAmountsWei(PRICE_E18)).toHaveLength(10);
    });

    it('is monotonically non-increasing by rank', () => {
      const amounts = getTop10WordAmountsWei(PRICE_E18);
      for (let i = 1; i < amounts.length; i++) {
        expect(amounts[i]).toBeLessThanOrEqual(amounts[i - 1]);
      }
    });

    it('preserves the rank ratios even when the cap binds', () => {
      // The cap applies to the pool, so 1st place stays 19/16 of 2nd whether or
      // not it fired. Capping each rank separately would distort the curve.
      // Compared within 1 wei because each rank is a truncated division; 1 wei
      // of $WORD is about 2.5e-25 dollars.
      for (const amounts of [
        getTop10WordAmountsWei(PRICE_E18),
        getTop10WordAmountsWei(PRICE_E18 / 1000n),
      ]) {
        const diff = (amounts[0] * 16n) / 19n - amounts[1];
        expect(diff >= -1n && diff <= 1n).toBe(true);
      }
    });

    it('never pays first place more than the configured ceiling', () => {
      // The cap's job is to bound the payout, not to hit a round number. Two
      // truncating divisions (pool cap, then rank share) leave it 1 wei under,
      // which is the safe direction.
      const first = getTop10WordAmountsWei(PRICE_E18 / 1000n)[0];
      expect(first).toBeLessThanOrEqual(TOP10_FIRST_PLACE_MAX_TOKENS_WEI);
      expect(TOP10_FIRST_PLACE_MAX_TOKENS_WEI - first).toBeLessThanOrEqual(1n);
    });

    it('derives the pool from first place so the two cannot drift', () => {
      expect(TOP10_POOL_USD_CENTS).toBe(Math.round((TOP10_FIRST_PLACE_USD_CENTS * 100) / 19));
    });
  });
});

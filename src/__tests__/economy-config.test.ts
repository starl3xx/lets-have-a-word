import { describe, it, expect } from 'vitest';
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

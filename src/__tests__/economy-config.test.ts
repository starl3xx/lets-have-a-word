import { describe, it, expect } from 'vitest';
import {
  CLANKTON_HOLDER_THRESHOLD,
  CLANKTON_BONUS_MCAP_THRESHOLD_USD,
  CLANKTON_BONUS_GUESSES_TIER_LOW,
  CLANKTON_BONUS_GUESSES_TIER_HIGH,
  getClanktonHolderBonusGuesses,
  getClanktonBonusTierInfo,
  formatMarketCap,
} from '../../config/economy';

/**
 * Economy Config Tests
 * Milestone 5.4c: CLANKTON Bonus Market Cap Tiers
 */

describe('CLANKTON Bonus Market Cap Tiers - Milestone 5.4c', () => {
  describe('Constants', () => {
    it('should have correct holder threshold (100M)', () => {
      expect(CLANKTON_HOLDER_THRESHOLD).toBe(100_000_000);
    });

    it('should have correct market cap threshold ($250k)', () => {
      expect(CLANKTON_BONUS_MCAP_THRESHOLD_USD).toBe(250_000);
    });

    it('should have correct tier bonuses (2 low, 3 high)', () => {
      expect(CLANKTON_BONUS_GUESSES_TIER_LOW).toBe(2);
      expect(CLANKTON_BONUS_GUESSES_TIER_HIGH).toBe(3);
    });
  });

  describe('getClanktonHolderBonusGuesses()', () => {
    it('should return TIER_LOW (2) when market cap is 0', () => {
      expect(getClanktonHolderBonusGuesses(0)).toBe(2);
    });

    it('should return TIER_LOW (2) when market cap is below threshold', () => {
      expect(getClanktonHolderBonusGuesses(100_000)).toBe(2);
      expect(getClanktonHolderBonusGuesses(200_000)).toBe(2);
      expect(getClanktonHolderBonusGuesses(249_999)).toBe(2);
    });

    it('should return TIER_HIGH (3) when market cap equals threshold', () => {
      expect(getClanktonHolderBonusGuesses(250_000)).toBe(3);
    });

    it('should return TIER_HIGH (3) when market cap is above threshold', () => {
      expect(getClanktonHolderBonusGuesses(250_001)).toBe(3);
      expect(getClanktonHolderBonusGuesses(500_000)).toBe(3);
      expect(getClanktonHolderBonusGuesses(1_000_000)).toBe(3);
    });
  });

  describe('getClanktonBonusTierInfo()', () => {
    it('should return correct info for low tier (below threshold)', () => {
      const info = getClanktonBonusTierInfo(100_000);

      expect(info.bonusGuesses).toBe(2);
      expect(info.tier).toBe('low');
      expect(info.marketCapUsd).toBe(100_000);
      expect(info.thresholdUsd).toBe(250_000);
      expect(info.isAboveThreshold).toBe(false);
    });

    it('should return correct info for high tier (at threshold)', () => {
      const info = getClanktonBonusTierInfo(250_000);

      expect(info.bonusGuesses).toBe(3);
      expect(info.tier).toBe('high');
      expect(info.marketCapUsd).toBe(250_000);
      expect(info.thresholdUsd).toBe(250_000);
      expect(info.isAboveThreshold).toBe(true);
    });

    it('should return correct info for high tier (above threshold)', () => {
      const info = getClanktonBonusTierInfo(500_000);

      expect(info.bonusGuesses).toBe(3);
      expect(info.tier).toBe('high');
      expect(info.marketCapUsd).toBe(500_000);
      expect(info.thresholdUsd).toBe(250_000);
      expect(info.isAboveThreshold).toBe(true);
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

  describe('Daily Guess Allocation Integration', () => {
    it('should use dynamic bonus value in daily limits', async () => {
      // Import dynamically to test the integration
      const { DAILY_LIMITS_RULES } = await import('../lib/daily-limits');

      // The clanktonBonusGuesses should match the helper function result
      // for the current CLANKTON_MARKET_CAP_USD env value
      const expectedBonus = getClanktonHolderBonusGuesses();
      expect(DAILY_LIMITS_RULES.clanktonBonusGuesses).toBe(expectedBonus);
    });
  });
});

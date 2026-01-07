/**
 * Pack Pricing Tests
 * Milestone 7.1: Guess pack economics refinement
 *
 * Tests for dynamic pack pricing based on round progress.
 */

import { describe, it, expect } from 'vitest';
import {
  getPackPriceWei,
  getPricingPhase,
  getTotalPackCostWei,
  weiToEthString,
  BASE_PACK_PRICE_WEI,
  MAX_PACK_PRICE_WEI,
  PRICE_RAMP_START_GUESSES,
  PRICE_STEP_GUESSES,
  PRICE_STEP_INCREASE_WEI,
} from './pack-pricing';

describe('Pack Pricing', () => {
  describe('getPackPriceWei', () => {
    // Test cases from spec
    it('returns 0.0003 ETH for 0 guesses', () => {
      expect(getPackPriceWei(0)).toBe(300000000000000n);
    });

    it('returns 0.0003 ETH for 849 guesses', () => {
      expect(getPackPriceWei(849)).toBe(300000000000000n);
    });

    it('returns 0.00045 ETH for 850 guesses', () => {
      expect(getPackPriceWei(850)).toBe(450000000000000n);
    });

    it('returns 0.00045 ETH for 1249 guesses', () => {
      expect(getPackPriceWei(1249)).toBe(450000000000000n);
    });

    it('returns 0.0006 ETH for 1250 guesses', () => {
      expect(getPackPriceWei(1250)).toBe(600000000000000n);
    });

    it('returns 0.0006 ETH for 2000 guesses (cap)', () => {
      expect(getPackPriceWei(2000)).toBe(600000000000000n);
    });

    it('returns 0.0006 ETH for very large guess counts (cap)', () => {
      expect(getPackPriceWei(10000)).toBe(600000000000000n);
    });

    it('throws error for negative guess counts', () => {
      expect(() => getPackPriceWei(-1)).toThrow('totalGuessesInRound must be non-negative');
    });
  });

  describe('getPricingPhase', () => {
    it('returns EARLY for 0 guesses', () => {
      expect(getPricingPhase(0)).toBe('EARLY');
    });

    it('returns EARLY for 849 guesses', () => {
      expect(getPricingPhase(849)).toBe('EARLY');
    });

    it('returns MID for 850 guesses', () => {
      expect(getPricingPhase(850)).toBe('MID');
    });

    it('returns MID for 1249 guesses', () => {
      expect(getPricingPhase(1249)).toBe('MID');
    });

    it('returns LATE for 1250 guesses', () => {
      expect(getPricingPhase(1250)).toBe('LATE');
    });

    it('returns LATE for 2000 guesses', () => {
      expect(getPricingPhase(2000)).toBe('LATE');
    });
  });

  describe('getTotalPackCostWei', () => {
    it('calculates 1 pack cost at base price', () => {
      const cost = getTotalPackCostWei(0, 1);
      expect(cost).toBe(300000000000000n);
    });

    it('calculates 2 packs cost at base price', () => {
      const cost = getTotalPackCostWei(0, 2);
      expect(cost).toBe(600000000000000n);
    });

    it('calculates 3 packs cost at base price', () => {
      const cost = getTotalPackCostWei(0, 3);
      expect(cost).toBe(900000000000000n);
    });

    it('calculates 1 pack cost at MID price', () => {
      const cost = getTotalPackCostWei(850, 1);
      expect(cost).toBe(450000000000000n);
    });

    it('calculates 3 packs cost at MID price', () => {
      const cost = getTotalPackCostWei(850, 3);
      expect(cost).toBe(1350000000000000n);
    });

    it('calculates 1 pack cost at LATE price', () => {
      const cost = getTotalPackCostWei(1250, 1);
      expect(cost).toBe(600000000000000n);
    });

    it('calculates 3 packs cost at LATE price', () => {
      const cost = getTotalPackCostWei(1250, 3);
      expect(cost).toBe(1800000000000000n);
    });

    it('throws error for packCount < 1', () => {
      expect(() => getTotalPackCostWei(0, 0)).toThrow('packCount must be at least 1');
    });
  });

  describe('weiToEthString', () => {
    it('converts EARLY price to 0.0003', () => {
      expect(weiToEthString(300000000000000n)).toBe('0.00030');
    });

    it('converts MID price to 0.00045', () => {
      expect(weiToEthString(450000000000000n)).toBe('0.00045');
    });

    it('converts LATE price to 0.0006', () => {
      expect(weiToEthString(600000000000000n)).toBe('0.00060');
    });

    it('converts 1 ETH correctly', () => {
      expect(weiToEthString(1000000000000000000n)).toBe('1.00000');
    });

    it('converts 0 correctly', () => {
      expect(weiToEthString(0n)).toBe('0');
    });
  });

  describe('Constants', () => {
    it('BASE_PACK_PRICE_WEI is 0.0003 ETH', () => {
      expect(BASE_PACK_PRICE_WEI).toBe(300000000000000n);
    });

    it('MAX_PACK_PRICE_WEI is 0.0006 ETH', () => {
      expect(MAX_PACK_PRICE_WEI).toBe(600000000000000n);
    });

    it('PRICE_RAMP_START_GUESSES is 850', () => {
      expect(PRICE_RAMP_START_GUESSES).toBe(850);
    });

    it('PRICE_STEP_GUESSES is 400', () => {
      expect(PRICE_STEP_GUESSES).toBe(400);
    });

    it('PRICE_STEP_INCREASE_WEI is 0.00015 ETH', () => {
      expect(PRICE_STEP_INCREASE_WEI).toBe(150000000000000n);
    });
  });

  describe('Price schedule verification', () => {
    // Verify the complete price schedule from the spec
    const priceSchedule = [
      { guesses: 0, expectedWei: 300000000000000n, phase: 'EARLY' },
      { guesses: 100, expectedWei: 300000000000000n, phase: 'EARLY' },
      { guesses: 500, expectedWei: 300000000000000n, phase: 'EARLY' },
      { guesses: 849, expectedWei: 300000000000000n, phase: 'EARLY' },
      { guesses: 850, expectedWei: 450000000000000n, phase: 'MID' },
      { guesses: 1000, expectedWei: 450000000000000n, phase: 'MID' },
      { guesses: 1249, expectedWei: 450000000000000n, phase: 'MID' },
      { guesses: 1250, expectedWei: 600000000000000n, phase: 'LATE' },
      { guesses: 1500, expectedWei: 600000000000000n, phase: 'LATE' },
      { guesses: 2000, expectedWei: 600000000000000n, phase: 'LATE' },
      { guesses: 5000, expectedWei: 600000000000000n, phase: 'LATE' },
    ];

    it.each(priceSchedule)(
      'at $guesses guesses: price = $expectedWei wei, phase = $phase',
      ({ guesses, expectedWei, phase }) => {
        expect(getPackPriceWei(guesses)).toBe(expectedWei);
        expect(getPricingPhase(guesses)).toBe(phase);
      }
    );
  });
});

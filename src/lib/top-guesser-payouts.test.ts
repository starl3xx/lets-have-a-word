import { describe, it, expect } from 'vitest';
import {
  calculateTopGuesserPayouts,
  getNormalizedBpsForN,
  TopGuesserPayoutError,
} from './top-guesser-payouts';
import { ethers } from 'ethers';

// Test addresses (checksummed)
const ADDRESSES = [
  '0x1111111111111111111111111111111111111111',
  '0x2222222222222222222222222222222222222222',
  '0x3333333333333333333333333333333333333333',
  '0x4444444444444444444444444444444444444444',
  '0x5555555555555555555555555555555555555555',
  '0x6666666666666666666666666666666666666666',
  '0x7777777777777777777777777777777777777777',
  '0x8888888888888888888888888888888888888888',
  '0x9999999999999999999999999999999999999999',
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
];

describe('calculateTopGuesserPayouts', () => {
  describe('Acceptance Test 1: P=0.05 ETH, T=0.005 ETH, N=10', () => {
    const TWei = ethers.parseEther('0.005'); // 5000000000000000 wei

    it('should distribute correctly to all 10 ranks', () => {
      const payouts = calculateTopGuesserPayouts(ADDRESSES, TWei);

      expect(payouts.length).toBe(10);

      // Expected payouts in ETH
      // #1: 0.00095 (19%)
      // #2: 0.00080 (16%)
      // #3: 0.00070 (14%)
      // #4: 0.00055 (11%)
      // #5: 0.00050 (10%)
      // #6-10: 0.00030 each (6% each)

      expect(payouts[0].amountWei).toBe(ethers.parseEther('0.00095'));
      expect(payouts[1].amountWei).toBe(ethers.parseEther('0.0008'));
      expect(payouts[2].amountWei).toBe(ethers.parseEther('0.0007'));
      expect(payouts[3].amountWei).toBe(ethers.parseEther('0.00055'));
      expect(payouts[4].amountWei).toBe(ethers.parseEther('0.0005'));
      expect(payouts[5].amountWei).toBe(ethers.parseEther('0.0003'));
      expect(payouts[6].amountWei).toBe(ethers.parseEther('0.0003'));
      expect(payouts[7].amountWei).toBe(ethers.parseEther('0.0003'));
      expect(payouts[8].amountWei).toBe(ethers.parseEther('0.0003'));
      expect(payouts[9].amountWei).toBe(ethers.parseEther('0.0003'));
    });

    it('should sum to exactly TWei', () => {
      const payouts = calculateTopGuesserPayouts(ADDRESSES, TWei);
      const total = payouts.reduce((sum, p) => sum + p.amountWei, 0n);
      expect(total).toBe(TWei);
    });
  });

  describe('Acceptance Test 2: N < 10 preserves shape', () => {
    const TWei = ethers.parseEther('0.005');

    it('should distribute to top 5 only with preserved shape', () => {
      const top5 = ADDRESSES.slice(0, 5);
      const payouts = calculateTopGuesserPayouts(top5, TWei);

      expect(payouts.length).toBe(5);

      // BPS for top 5: [1900, 1600, 1400, 1100, 1000] = 7000 total
      // Normalized to 10000:
      // #1: 1900 * 10000 / 7000 = 2714 bps
      // #2: 1600 * 10000 / 7000 = 2285 bps
      // #3: 1400 * 10000 / 7000 = 2000 bps
      // #4: 1100 * 10000 / 7000 = 1571 bps
      // #5: 1000 * 10000 / 7000 = 1428 bps

      // Shape should be preserved (rank 1 > rank 2 > ... > rank 5)
      expect(payouts[0].amountWei).toBeGreaterThan(payouts[1].amountWei);
      expect(payouts[1].amountWei).toBeGreaterThan(payouts[2].amountWei);
      expect(payouts[2].amountWei).toBeGreaterThan(payouts[3].amountWei);
      expect(payouts[3].amountWei).toBeGreaterThan(payouts[4].amountWei);
    });

    it('should sum to exactly TWei with N=5', () => {
      const top5 = ADDRESSES.slice(0, 5);
      const payouts = calculateTopGuesserPayouts(top5, TWei);
      const total = payouts.reduce((sum, p) => sum + p.amountWei, 0n);
      expect(total).toBe(TWei);
    });

    it('should sum to exactly TWei with N=1', () => {
      const top1 = ADDRESSES.slice(0, 1);
      const payouts = calculateTopGuesserPayouts(top1, TWei);
      expect(payouts.length).toBe(1);
      expect(payouts[0].amountWei).toBe(TWei);
    });

    it('should sum to exactly TWei with N=3', () => {
      const top3 = ADDRESSES.slice(0, 3);
      const payouts = calculateTopGuesserPayouts(top3, TWei);
      const total = payouts.reduce((sum, p) => sum + p.amountWei, 0n);
      expect(total).toBe(TWei);
    });
  });

  describe('Sum invariant: sum(amountWei) == TWei always', () => {
    const testCases = [
      { TWei: ethers.parseEther('0.001'), N: 10 },
      { TWei: ethers.parseEther('0.1'), N: 10 },
      { TWei: ethers.parseEther('1.0'), N: 10 },
      { TWei: 1n, N: 10 }, // 1 wei
      { TWei: 7n, N: 10 }, // Prime number of wei
      { TWei: 123456789012345678n, N: 10 }, // Arbitrary large number
      { TWei: ethers.parseEther('0.005'), N: 7 },
      { TWei: ethers.parseEther('0.005'), N: 4 },
      { TWei: ethers.parseEther('0.005'), N: 2 },
      { TWei: 11n, N: 3 }, // Odd wei with 3 recipients
    ];

    testCases.forEach(({ TWei, N }) => {
      it(`TWei=${TWei}, N=${N} should sum exactly`, () => {
        const addresses = ADDRESSES.slice(0, N);
        const payouts = calculateTopGuesserPayouts(addresses, TWei);
        const total = payouts.reduce((sum, p) => sum + p.amountWei, 0n);
        expect(total).toBe(TWei);
      });
    });
  });

  describe('Validation', () => {
    it('should reject N=0', () => {
      expect(() => calculateTopGuesserPayouts([], 1000n)).toThrow(
        TopGuesserPayoutError
      );
    });

    it('should reject N>10', () => {
      const tooMany = [...ADDRESSES, '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'];
      expect(() => calculateTopGuesserPayouts(tooMany, 1000n)).toThrow(
        TopGuesserPayoutError
      );
    });

    it('should reject negative TWei', () => {
      expect(() => calculateTopGuesserPayouts(ADDRESSES, -1n)).toThrow(
        TopGuesserPayoutError
      );
    });

    it('should reject duplicate addresses', () => {
      const duplicates = [ADDRESSES[0], ADDRESSES[0]];
      expect(() => calculateTopGuesserPayouts(duplicates, 1000n)).toThrow(
        /Duplicate address/
      );
    });

    it('should reject invalid address format', () => {
      const invalid = ['not-an-address'];
      expect(() => calculateTopGuesserPayouts(invalid, 1000n)).toThrow(
        /Invalid Ethereum address/
      );
    });

    it('should handle TWei=0', () => {
      const payouts = calculateTopGuesserPayouts(ADDRESSES.slice(0, 3), 0n);
      expect(payouts.length).toBe(3);
      expect(payouts.every(p => p.amountWei === 0n)).toBe(true);
    });
  });

  describe('All payouts non-negative', () => {
    it('should never produce negative payouts', () => {
      // Test with various edge cases
      for (let N = 1; N <= 10; N++) {
        for (const TWei of [0n, 1n, 5n, 10n, 100n, 1000000000000000000n]) {
          const addresses = ADDRESSES.slice(0, N);
          const payouts = calculateTopGuesserPayouts(addresses, TWei);
          expect(payouts.every(p => p.amountWei >= 0n)).toBe(true);
        }
      }
    });
  });
});

describe('getNormalizedBpsForN', () => {
  it('should return [10000] for N=1', () => {
    const bps = getNormalizedBpsForN(1);
    expect(bps).toEqual([10000n]);
  });

  it('should return original BPS for N=10', () => {
    const bps = getNormalizedBpsForN(10);
    // Original BPS sums to 10000, so no normalization needed
    expect(bps).toEqual([1900n, 1600n, 1400n, 1100n, 1000n, 600n, 600n, 600n, 600n, 600n]);
  });

  it('should normalize for N=5', () => {
    const bps = getNormalizedBpsForN(5);
    // BPS[0:5] = [1900, 1600, 1400, 1100, 1000], sum = 7000
    // Normalized: each * 10000 / 7000
    expect(bps[0]).toBe(2714n); // 1900 * 10000 / 7000 = 2714
    expect(bps[1]).toBe(2285n); // 1600 * 10000 / 7000 = 2285
    expect(bps[2]).toBe(2000n); // 1400 * 10000 / 7000 = 2000
    expect(bps[3]).toBe(1571n); // 1100 * 10000 / 7000 = 1571
    expect(bps[4]).toBe(1428n); // 1000 * 10000 / 7000 = 1428
  });
});

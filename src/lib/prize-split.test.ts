import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';
import { computePrizeSplit, TOP_TEN_BPS } from './prize-split';

/**
 * Tests for the extracted prize split.
 *
 * The two regression cases below are not synthetic: they reproduce the exact
 * payouts of real resolved rounds, taken from the production archive. They are
 * the evidence that extracting this arithmetic out of economics.ts changed
 * nothing — round 33 for the no-referrer path, round 27 for the referrer path.
 */

const ETH = (s: string) => ethers.parseEther(s);

/** The live ETH cap: 0.02 ETH. */
const ETH_SEED_CAP = ETH('0.02');

describe('computePrizeSplit — production regressions', () => {
  it('reproduces round 33 exactly (no referrer, 0.0216 ETH pool)', () => {
    const split = computePrizeSplit({
      jackpotWei: ETH('0.0216'),
      hasReferrer: false,
      seedCapWei: ETH_SEED_CAP,
    });

    expect(split.toWinnerWei).toBe(ETH('0.01728')); // 80%
    expect(split.toTopGuessersWei).toBe(ETH('0.0027')); // 12.5%
    expect(split.seedForNextRoundWei).toBe(ETH('0.00162')); // 7.5%
    expect(split.toReferrerWei).toBe(0n);
    expect(split.toCreatorOverflowWei).toBe(0n);
    expect(split.seedWasCapped).toBe(false);
    expect(split.dustWei).toBe(0n);
  });

  it('reproduces round 33 top-10 amounts from the archive', () => {
    const bucket = ETH('0.0027');
    const actual = TOP_TEN_BPS.map((bps) => (bucket * BigInt(bps)) / 10000n);

    // Exactly what the archive records for round 33.
    expect(actual).toEqual([
      ETH('0.000513'),
      ETH('0.000432'),
      ETH('0.000378'),
      ETH('0.000297'),
      ETH('0.00027'),
      ETH('0.000162'),
      ETH('0.000162'),
      ETH('0.000162'),
      ETH('0.000162'),
      ETH('0.000162'),
    ]);
    expect(actual.reduce((a, b) => a + b, 0n)).toBe(bucket);
  });

  it('reproduces round 27 exactly (with referrer, 0.02848 ETH pool)', () => {
    const split = computePrizeSplit({
      jackpotWei: ETH('0.02848'),
      hasReferrer: true,
      seedCapWei: ETH_SEED_CAP,
    });

    expect(split.toWinnerWei).toBe(ETH('0.022784')); // 80%
    expect(split.toTopGuessersWei).toBe(ETH('0.002848')); // 10%
    expect(split.seedForNextRoundWei).toBe(ETH('0.001424')); // 5%
    expect(split.toReferrerWei).toBe(ETH('0.001424')); // 5%
    expect(split.toCreatorOverflowWei).toBe(0n);
    expect(split.dustWei).toBe(0n);
  });

  it('reproduces round 27 first-place top-10 amount', () => {
    const bucket = ETH('0.002848');
    expect((bucket * 1900n) / 10000n).toBe(ETH('0.00054112'));
  });
});

describe('computePrizeSplit — invariants', () => {
  const pools = [
    '0.0216', '0.02848', '0.18796', '0.0001', '1', '10', '0.000000000000000003',
  ].map(ETH);

  it('always allocates the entire pool once dust is counted', () => {
    // The contract compares for exact equality, so anything unallocated is a
    // reverted resolve. Dust is the caller's responsibility to add back.
    for (const jackpotWei of pools) {
      for (const hasReferrer of [true, false]) {
        const s = computePrizeSplit({ jackpotWei, hasReferrer, seedCapWei: ETH_SEED_CAP });
        const total =
          s.toWinnerWei +
          s.toTopGuessersWei +
          s.toReferrerWei +
          s.seedForNextRoundWei +
          s.toCreatorOverflowWei +
          s.dustWei;
        expect(total).toBe(jackpotWei);
      }
    }
  });

  it('never produces a negative bucket', () => {
    for (const jackpotWei of pools) {
      for (const hasReferrer of [true, false]) {
        const s = computePrizeSplit({ jackpotWei, hasReferrer, seedCapWei: ETH_SEED_CAP });
        for (const [k, v] of Object.entries(s)) {
          if (typeof v === 'bigint') expect(v, `${k} at ${jackpotWei}`).toBeGreaterThanOrEqual(0n);
        }
      }
    }
  });

  it('keeps dust under 1 wei per bucket', () => {
    // Five floors, so the remainder cannot exceed 5 wei — well inside the
    // 1000-wei tolerance validatePayoutMath already allows.
    for (const jackpotWei of pools) {
      for (const hasReferrer of [true, false]) {
        const s = computePrizeSplit({ jackpotWei, hasReferrer, seedCapWei: ETH_SEED_CAP });
        expect(s.dustWei).toBeLessThanOrEqual(5n);
      }
    }
  });

  it('gives the top 10 more when there is no referrer', () => {
    const pool = ETH('1');
    const withRef = computePrizeSplit({ jackpotWei: pool, hasReferrer: true, seedCapWei: ETH_SEED_CAP });
    const without = computePrizeSplit({ jackpotWei: pool, hasReferrer: false, seedCapWei: ETH_SEED_CAP });

    expect(withRef.toTopGuessersWei).toBe(ETH('0.1')); // 10%
    expect(without.toTopGuessersWei).toBe(ETH('0.125')); // 12.5%
  });

  it('pays the winner exactly 80% regardless of referrer', () => {
    const pool = ETH('1');
    for (const hasReferrer of [true, false]) {
      const s = computePrizeSplit({ jackpotWei: pool, hasReferrer, seedCapWei: ETH_SEED_CAP });
      expect(s.toWinnerWei).toBe(ETH('0.8'));
    }
  });

  it('handles a zero pool without dividing by anything', () => {
    const s = computePrizeSplit({ jackpotWei: 0n, hasReferrer: false, seedCapWei: ETH_SEED_CAP });
    expect(s.toWinnerWei).toBe(0n);
    expect(s.dustWei).toBe(0n);
  });

  it('rejects a negative pool', () => {
    expect(() =>
      computePrizeSplit({ jackpotWei: -1n, hasReferrer: false, seedCapWei: ETH_SEED_CAP })
    ).toThrow(/negative pool/);
  });
});

describe('computePrizeSplit — the seed cap', () => {
  it('caps the seed and routes the overflow to the creator', () => {
    // 7.5% of 1 ETH = 0.075 ETH, well over the 0.02 cap.
    const s = computePrizeSplit({
      jackpotWei: ETH('1'),
      hasReferrer: false,
      seedCapWei: ETH_SEED_CAP,
    });
    expect(s.seedWasCapped).toBe(true);
    expect(s.seedForNextRoundWei).toBe(ETH('0.02'));
    expect(s.toCreatorOverflowWei).toBe(ETH('0.055'));
    expect(s.seedForNextRoundWei + s.toCreatorOverflowWei).toBe(ETH('0.075'));
  });

  it('now caps the referrer branch too, which the original did not', () => {
    // This is the one deliberate behaviour change. 5% of 1 ETH = 0.05 ETH; the
    // code this replaces would have carried all of it, ignoring the cap.
    const s = computePrizeSplit({
      jackpotWei: ETH('1'),
      hasReferrer: true,
      seedCapWei: ETH_SEED_CAP,
    });
    expect(s.seedWasCapped).toBe(true);
    expect(s.seedForNextRoundWei).toBe(ETH('0.02'));
    expect(s.toCreatorOverflowWei).toBe(ETH('0.03'));
  });

  it('is a no-op at every pool size the game has actually played', () => {
    // The largest pool in 33 rounds was 0.18796 ETH (round 1). The cap binds
    // above 0.267 ETH without a referrer and 0.4 ETH with one, so the change
    // above cannot have altered any historical payout.
    const HISTORICAL_MAX = ETH('0.18796');
    for (const hasReferrer of [true, false]) {
      const s = computePrizeSplit({
        jackpotWei: HISTORICAL_MAX,
        hasReferrer,
        seedCapWei: ETH_SEED_CAP,
      });
      expect(s.seedWasCapped).toBe(false);
      expect(s.toCreatorOverflowWei).toBe(0n);
    }
  });

  it('supports an effectively uncapped seed for a token-denominated round', () => {
    // The $WORD cap is oracle-priced rather than constant, and a very large
    // cap must not distort the split.
    const huge = ethers.parseEther('1000000000');
    const s = computePrizeSplit({ jackpotWei: ETH('1'), hasReferrer: false, seedCapWei: huge });
    expect(s.seedWasCapped).toBe(false);
    expect(s.seedForNextRoundWei).toBe(ETH('0.075'));
  });

  it('routes the whole seed to the creator when the cap is zero', () => {
    const s = computePrizeSplit({ jackpotWei: ETH('1'), hasReferrer: false, seedCapWei: 0n });
    expect(s.seedForNextRoundWei).toBe(0n);
    expect(s.toCreatorOverflowWei).toBe(ETH('0.075'));
  });

  it('rejects a negative cap', () => {
    expect(() =>
      computePrizeSplit({ jackpotWei: ETH('1'), hasReferrer: false, seedCapWei: -1n })
    ).toThrow(/cap cannot be negative/);
  });
});

describe('TOP_TEN_BPS', () => {
  it('sums to exactly 10000 bps so the bucket is fully distributed', () => {
    expect(TOP_TEN_BPS.reduce((a, b) => a + b, 0)).toBe(10000);
  });

  it('is monotonically non-increasing by rank', () => {
    for (let i = 1; i < TOP_TEN_BPS.length; i++) {
      expect(TOP_TEN_BPS[i]).toBeLessThanOrEqual(TOP_TEN_BPS[i - 1]);
    }
  });
});

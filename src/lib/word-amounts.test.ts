import { describe, it, expect } from 'vitest';
import {
  usdPriceToE18,
  tokensForUsdCents,
  usdCentsForTokens,
  formatWordAmount,
  validateWordPayouts,
  MAX_PAYOUT_RECIPIENTS,
  type WordPayoutRecipient,
} from './word-amounts';

/**
 * Tests for the pure half of the $WORD jackpot integration.
 *
 * These cover the arithmetic that decides how many tokens leave the treasury
 * and the pre-flight that decides whether a resolve is allowed to be sent. The
 * network-facing half is exercised against a live deployment by
 * contracts/scripts/deploy-word-jackpot-sepolia.ts.
 *
 * The load-bearing property throughout is that `tokensForUsdCents` reproduces
 * WordJackpot.seedTokensFor *exactly*, including its truncating division. If
 * the two ever disagree, the backend's pre-flight bounds check passes while the
 * contract computes a different seed — the failure mode is a round seeded with
 * the wrong amount of money, which is not recoverable after the fact.
 */

/** $WORD around the time of writing: $0.000000256 */
const PRICE_E18_AT_256 = 256_000_000_000n;
const ONE_TOKEN = 10n ** 18n;

describe('usdPriceToE18', () => {
  it('converts the canonical $WORD price without float drift', () => {
    // 2.56e-7 is not exactly representable in binary floating point, so a naive
    // priceUsd * 1e18 would land near-but-not-on this value.
    expect(usdPriceToE18(2.56e-7)).toBe(PRICE_E18_AT_256);
  });

  it('preserves precision to the full 18 decimals', () => {
    expect(usdPriceToE18(1.234567890123e-7)).toBe(123_456_789_012n);
  });

  it('refuses a zero price', () => {
    // The whole reason this throws: config/economy.ts defaulted a price to the
    // string '0', which is truthy, and the zero propagated silently to the UI.
    // A zero here would divide into an unbounded seed.
    expect(() => usdPriceToE18(0)).toThrow(/non-positive/);
  });

  it('refuses a negative price', () => {
    expect(() => usdPriceToE18(-1e-7)).toThrow(/non-positive/);
  });

  it('refuses NaN', () => {
    expect(() => usdPriceToE18(Number.NaN)).toThrow(/non-positive/);
  });

  it('refuses a price far below anything plausible', () => {
    // A 1e-15 price would make a $20 seed cost 20 trillion tokens — more than
    // the entire treasury. maxSeedTokens catches it onchain; this catches it
    // before the bad price is even published.
    expect(() => usdPriceToE18(1e-15)).toThrow(/outside the plausible range/);
  });

  it('refuses a price far above anything plausible', () => {
    expect(() => usdPriceToE18(1)).toThrow(/outside the plausible range/);
  });
});

describe('tokensForUsdCents', () => {
  it('matches the contract worked example: $20 at $0.000000256 = 78,125,000 tokens', () => {
    const seed = tokensForUsdCents(2000n, PRICE_E18_AT_256);
    expect(seed).toBe(78_125_000n * ONE_TOKEN);
  });

  it('scales linearly with the USD target', () => {
    const ten = tokensForUsdCents(1000n, PRICE_E18_AT_256);
    const twenty = tokensForUsdCents(2000n, PRICE_E18_AT_256);
    expect(twenty).toBe(ten * 2n);
  });

  it('buys more tokens as the price falls', () => {
    const atLow = tokensForUsdCents(2000n, 128_000_000_000n);
    const atHigh = tokensForUsdCents(2000n, 512_000_000_000n);
    expect(atLow).toBe(atHigh * 4n);
  });

  it('truncates rather than rounding, exactly as Solidity integer division does', () => {
    // 100 * 1e34 / 3 = 3.333...e35, truncated. Reproducing the truncation is
    // the point: a backend that rounded up would predict a seed one wei larger
    // than the contract mints.
    expect(tokensForUsdCents(100n, 3n)).toBe((100n * 10n ** 34n) / 3n);
  });

  it('prices the $1.50 bonus-word reward', () => {
    const reward = tokensForUsdCents(150n, PRICE_E18_AT_256);
    expect(reward).toBe(5_859_375n * ONE_TOKEN);
  });

  it('prices the $3.00 top-10 first place', () => {
    const reward = tokensForUsdCents(300n, PRICE_E18_AT_256);
    expect(reward).toBe(11_718_750n * ONE_TOKEN);
  });

  it('refuses a zero price rather than dividing by it', () => {
    expect(() => tokensForUsdCents(2000n, 0n)).toThrow(/zero \$WORD price/);
  });
});

describe('usdCentsForTokens', () => {
  it('inverts tokensForUsdCents at the canonical price', () => {
    const seed = tokensForUsdCents(2000n, PRICE_E18_AT_256);
    expect(usdCentsForTokens(seed, PRICE_E18_AT_256)).toBe(2000n);
  });

  it('values a whole-token amount correctly', () => {
    // 78,125,000 tokens at $0.000000256 = $20.00
    expect(usdCentsForTokens(78_125_000n * ONE_TOKEN, PRICE_E18_AT_256)).toBe(2000n);
  });

  it('refuses a zero price', () => {
    expect(() => usdCentsForTokens(ONE_TOKEN, 0n)).toThrow(/zero \$WORD price/);
  });
});

describe('formatWordAmount', () => {
  it('renders whole tokens with separators', () => {
    expect(formatWordAmount(78_125_000n * ONE_TOKEN)).toBe('78,125,000');
  });

  it('drops the fractional part, which is worth ~1e-25 dollars', () => {
    expect(formatWordAmount(ONE_TOKEN + 999_999_999_999_999_999n)).toBe('1');
  });

  it('handles zero', () => {
    expect(formatWordAmount(0n)).toBe('0');
  });
});

describe('validateWordPayouts', () => {
  const POOL = 100n * ONE_TOKEN;

  function payout(
    address: string,
    amountWei: bigint,
    role: WordPayoutRecipient['role'] = 'winner'
  ): WordPayoutRecipient {
    return { address, amountWei, role };
  }

  const WINNER = '0x1111111111111111111111111111111111111111';
  const REFERRER = '0x2222222222222222222222222222222222222222';

  it('accepts a payout set that sums exactly to the pool', () => {
    const result = validateWordPayouts(
      [payout(WINNER, 80n * ONE_TOKEN), payout(REFERRER, 15n * ONE_TOKEN, 'referrer')],
      5n * ONE_TOKEN,
      POOL
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.totalPayoutWei).toBe(95n * ONE_TOKEN);
    expect(result.totalWithCarryWei).toBe(POOL);
  });

  it('rejects a set that is one wei short', () => {
    // The contract compares for exact equality, so a rounding error anywhere in
    // the split math surfaces here rather than as a reverted transaction.
    const result = validateWordPayouts([payout(WINNER, POOL - 1n)], 0n, POOL);
    expect(result.valid).toBe(false);
    expect(result.errors.join()).toMatch(/off by 1 wei/);
  });

  it('rejects a set that overspends the pool', () => {
    const result = validateWordPayouts([payout(WINNER, POOL + ONE_TOKEN)], 0n, POOL);
    expect(result.valid).toBe(false);
    expect(result.errors.join()).toMatch(/Payout math mismatch/);
  });

  it('rejects a nonzero amount sent to the zero address', () => {
    // This is the case that motivated the contract-side check: it passes the
    // sum test, gets skipped by the payout loop, and leaves the tokens
    // sweepable while the round reports them as paid.
    const result = validateWordPayouts(
      [payout(WINNER, 80n * ONE_TOKEN), payout('0x' + '0'.repeat(40), 20n * ONE_TOKEN, 'referrer')],
      0n,
      POOL
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join()).toMatch(/zero address/);
  });

  it('allows a zero amount at the zero address, which the loop harmlessly skips', () => {
    const result = validateWordPayouts(
      [payout(WINNER, POOL), payout('0x' + '0'.repeat(40), 0n, 'referrer')],
      0n,
      POOL
    );
    expect(result.valid).toBe(true);
  });

  it('rejects a malformed address', () => {
    const result = validateWordPayouts([payout('0xnot-an-address', POOL)], 0n, POOL);
    expect(result.valid).toBe(false);
    expect(result.errors.join()).toMatch(/malformed address/);
  });

  it('rejects an empty payout set', () => {
    const result = validateWordPayouts([], 0n, 0n);
    expect(result.valid).toBe(false);
    expect(result.errors.join()).toMatch(/At least one payout recipient/);
  });

  it('rejects more recipients than the contract accepts', () => {
    const many = Array.from({ length: MAX_PAYOUT_RECIPIENTS + 1 }, (_, i) =>
      payout(`0x${(i + 1).toString(16).padStart(40, '0')}`, ONE_TOKEN, 'top_guesser')
    );
    const result = validateWordPayouts(many, 0n, BigInt(many.length) * ONE_TOKEN);
    expect(result.valid).toBe(false);
    expect(result.errors.join()).toMatch(/exceeds the contract cap/);
  });

  it('accepts the real shape: winner + referrer + 10 top guessers', () => {
    // 80/10/5/5 on a 100-token pool: winner 80, referrer 5, top-10 10, carry 5.
    const topTenBps = [1900, 1600, 1400, 1100, 1000, 600, 600, 600, 600, 600];
    const topTenPool = 10n * ONE_TOKEN;

    const topGuessers = topTenBps.map((bps, i) =>
      payout(
        `0x${(i + 10).toString(16).padStart(40, '0')}`,
        (topTenPool * BigInt(bps)) / 10000n,
        'top_guesser'
      )
    );
    const distributedToTop = topGuessers.reduce((s, p) => s + p.amountWei, 0n);
    expect(distributedToTop).toBe(topTenPool);

    const result = validateWordPayouts(
      [payout(WINNER, 80n * ONE_TOKEN), payout(REFERRER, 5n * ONE_TOKEN, 'referrer'), ...topGuessers],
      5n * ONE_TOKEN,
      POOL
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

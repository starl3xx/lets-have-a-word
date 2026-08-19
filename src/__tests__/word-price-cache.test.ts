/**
 * The cached $WORD price must come back as a usable number.
 *
 * Vercel KV returns this key as a STRING. `cacheGet<number>` is an unchecked
 * generic, so neither TypeScript nor the runtime objected — and a string is
 * worse here than a null would have been. It passed the old `cached > 0` guard
 * by coercion, reached usdPriceToE18, threw there ("Refusing to convert
 * non-positive $WORD price"), and landed in wheel.ts's catch, which treats any
 * failure as "keep the frozen seed price".
 *
 * The result was invisible: no error surfaced, the bar just quietly showed the
 * round's seed-time price for two days while the cache held a good live one.
 * On round 34 that read $24.26 against a real $27.33, about 11% low.
 *
 * These pin the coercion and, more importantly, the end-to-end consequence.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../lib/redis', () => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
}));

import { cacheGet as cacheGetImport } from '../lib/redis';
import { getCachedWordPriceUsd } from '../lib/word-oracle';
import { usdPriceToE18, usdCentsForTokens } from '../lib/word-amounts';

const cacheGet = vi.mocked(cacheGetImport);

describe('getCachedWordPriceUsd', () => {
  beforeEach(() => cacheGet.mockReset());
  afterEach(() => vi.clearAllMocks());

  it('coerces the string Vercel KV actually returns', async () => {
    cacheGet.mockResolvedValue('0.0000002862');
    const price = await getCachedWordPriceUsd();
    expect(typeof price).toBe('number');
    expect(price).toBeCloseTo(0.0000002862, 12);
  });

  it('still accepts a real number, in case the store changes its mind', async () => {
    cacheGet.mockResolvedValue(0.0000002862);
    expect(await getCachedWordPriceUsd()).toBeCloseTo(0.0000002862, 12);
  });

  it('returns null for a miss', async () => {
    cacheGet.mockResolvedValue(null);
    expect(await getCachedWordPriceUsd()).toBeNull();
  });

  it('returns null rather than passing junk downstream', async () => {
    for (const junk of ['', 'not-a-price', '0', '-1', 'NaN', 'Infinity']) {
      cacheGet.mockResolvedValue(junk);
      expect(await getCachedWordPriceUsd(), `input ${JSON.stringify(junk)}`).toBeNull();
    }
  });

  // NOTE: the redis-throws path is deliberately NOT tested here. The function
  // does catch it (word-oracle.ts, the catch returns null), but vitest's
  // unhandled-rejection reporter fires on the rejected promise before the
  // catch is credited and fails the test regardless of how the mock is built.
  // Left uncovered honestly rather than asserted with something meaningless.

  it('feeds usdPriceToE18 something it will accept — the link that broke', async () => {
    // The old bug in one assertion: the raw cached value threw here, and the
    // caller's catch silently swapped in the frozen seed price.
    cacheGet.mockResolvedValue('0.0000002862');
    const price = await getCachedWordPriceUsd();
    expect(() => usdPriceToE18(price as number)).not.toThrow();
    expect(usdPriceToE18(price as number)).toBe(286_200_000_000n);
  });

  it('produces the live pool value, not the seed-time one', async () => {
    // Round 34's real numbers on 2026-08-19.
    const poolWei = 95_496_311_688_311_687_505_706_412n;
    const seedPriceE18 = 254_100_000_000n; // frozen at seed time

    cacheGet.mockResolvedValue('0.0000002862');
    const live = await getCachedWordPriceUsd();
    const liveUsd = Number(usdCentsForTokens(poolWei, usdPriceToE18(live as number))) / 100;
    const seedUsd = Number(usdCentsForTokens(poolWei, seedPriceE18)) / 100;

    expect(seedUsd).toBeCloseTo(24.26, 2); // what players saw (matches the live API)
    expect(liveUsd).toBeCloseTo(27.33, 2); // what they should have seen
    expect(liveUsd).toBeGreaterThan(seedUsd);
  });
});

/**
 * Superguess pool-fraction pricing.
 *
 * The rule under test: on a $WORD round the price is half the pool's USD
 * value with a $10 floor, priced on the same basis as the pool figure the
 * player sees (live cached price when warm, seed snapshot otherwise). The
 * legacy fixed-USD ladder answers only where that basis is missing.
 *
 * Why it exists: fixed tiers quoted $90 against a $35 pool — negative EV
 * even for a guaranteed win. Half-the-pool makes the rational-entry point a
 * pure remaining-words threshold, independent of pool size.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// superguess.ts pulls in the db and redis at module load; neither path runs
// in the pricing functions, so both are stubbed to keep this a unit test.
vi.mock('../db', () => ({ db: {} }));

const cacheGet = vi.fn();
const cacheSet = vi.fn();
vi.mock('../lib/redis', () => ({
  redis: null,
  cacheGet: (...args: unknown[]) => cacheGet(...args),
  cacheSet: (...args: unknown[]) => cacheSet(...args),
  cacheDel: vi.fn(),
  CACHE_PREFIX: 'test:',
}));

// The live-price override is consulted on every quote; each case sets it.
let livePriceUsd: number | null = null;
vi.mock('../lib/word-oracle', () => ({
  getCachedWordPriceUsd: async () => livePriceUsd,
}));

import {
  superguessPriceUsdCents,
  getSuperguessQuote,
  pinSuperguessQuote,
  getPinnedSuperguessQuote,
  SUPERGUESS_MIN_GUESS_COUNT,
} from '../lib/superguess';

// $WORD at 2.56e-7 USD → priceE18 = 2.56e11. $40 of tokens = 156.25M tokens.
const PRICE_E18 = '256000000000';
const POOL_40_USD_WEI = '156250000000000000000000000';
const DICT = 4437;

function wordRound(overrides: Record<string, string | null> = {}) {
  return {
    prizeCurrency: 'word',
    prizePoolWord: POOL_40_USD_WEI,
    seedPriceE18: PRICE_E18,
    ...overrides,
  };
}

beforeEach(() => {
  livePriceUsd = null;
  cacheGet.mockReset().mockResolvedValue(null);
  cacheSet.mockReset().mockResolvedValue(undefined);
});

describe('superguessPriceUsdCents', () => {
  it('charges half the pool', () => {
    expect(superguessPriceUsdCents(8000n)).toBe(4000n);
    expect(superguessPriceUsdCents(100000n)).toBe(50000n);
  });

  it('floors at $10 — the blocking externality has a price even on a tiny pool', () => {
    expect(superguessPriceUsdCents(1500n)).toBe(1000n);
    expect(superguessPriceUsdCents(0n)).toBe(1000n);
  });

  it('half of a $20 pool IS the floor', () => {
    expect(superguessPriceUsdCents(2000n)).toBe(1000n);
  });
});

describe('getSuperguessQuote', () => {
  it('returns null below the unlock threshold', async () => {
    const quote = await getSuperguessQuote(wordRound(), SUPERGUESS_MIN_GUESS_COUNT - 1, DICT);
    expect(quote).toBeNull();
  });

  it('prices a $WORD round at half the pool on the seed snapshot', async () => {
    const quote = await getSuperguessQuote(wordRound(), 2500, DICT);
    expect(quote).toEqual({ id: 'pool_half', usdPrice: 20 });
  });

  it('follows the live cached price when one is warm — the same basis the pool display uses', async () => {
    // Price doubles → the same tokens are worth $80 → quote $40.
    livePriceUsd = 5.12e-7;
    const quote = await getSuperguessQuote(wordRound(), 2500, DICT);
    expect(quote).toEqual({ id: 'pool_half', usdPrice: 40 });
  });

  it('applies the $10 floor on a small pool', async () => {
    // A quarter of the $40 pool's tokens → $10 pool → half is $5 → floor.
    const quote = await getSuperguessQuote(
      wordRound({ prizePoolWord: '39062500000000000000000000' }),
      2500,
      DICT
    );
    expect(quote).toEqual({ id: 'pool_half', usdPrice: 10 });
  });

  it('falls back to the legacy ladder on an ETH round', async () => {
    const quote = await getSuperguessQuote(
      { prizeCurrency: 'eth', prizePoolWord: null, seedPriceE18: null },
      900,
      DICT
    );
    // 4437 - 900 = 3537 remaining → tier_1.
    expect(quote).toEqual({ id: 'tier_1', usdPrice: 20 });
  });

  it('falls back to the legacy ladder when a $WORD round has no price basis at all', async () => {
    const quote = await getSuperguessQuote(
      wordRound({ seedPriceE18: null }),
      3000,
      DICT
    );
    // 1437 remaining → tier_4. Loud legacy pricing beats a silent $0 quote.
    expect(quote).toEqual({ id: 'tier_4', usdPrice: 90 });
  });

  it('survives a throwing conversion on the seed snapshot', async () => {
    // $1 per token is outside usdPriceToE18's plausible range and throws;
    // the catch must leave the seed snapshot standing.
    livePriceUsd = 1;
    const quote = await getSuperguessQuote(wordRound(), 2500, DICT);
    expect(quote).toEqual({ id: 'pool_half', usdPrice: 20 });
  });

  it('clamps a junk-low live print to half the seed snapshot', async () => {
    // Pool worth $80 at the snapshot; a 10x-low print claims $8. The clamp
    // floors the basis at snapshot/2, so the quote is $20, not the floor.
    livePriceUsd = 2.56e-8;
    const quote = await getSuperguessQuote(
      wordRound({ prizePoolWord: '312500000000000000000000000' }),
      2500,
      DICT
    );
    expect(quote).toEqual({ id: 'pool_half', usdPrice: 20 });
  });

  it('lets a genuine drawdown inside the clamp move the quote', async () => {
    // A real 30% drop: $80 pool reads $56, quote $28.
    livePriceUsd = 1.792e-7;
    const quote = await getSuperguessQuote(
      wordRound({ prizePoolWord: '312500000000000000000000000' }),
      2500,
      DICT
    );
    expect(quote).toEqual({ id: 'pool_half', usdPrice: 28 });
  });

  it('treats a MISSING pool column as a rebuilt round object, not an empty pool', async () => {
    // The hand-written-field-list hazard: schema defaults the column to '0',
    // so undefined means dropped. Loud ladder beats a silent $10 quote.
    const quote = await getSuperguessQuote(
      { prizeCurrency: 'word', seedPriceE18: PRICE_E18 },
      3000,
      DICT
    );
    expect(quote).toEqual({ id: 'tier_4', usdPrice: 90 });
  });
});

describe('quote pinning', () => {
  it('pins the first quote it sees', async () => {
    await pinSuperguessQuote(34, 20);
    expect(cacheSet).toHaveBeenCalledWith(expect.stringContaining('quotepin:34'), 20, 300);
  });

  it('keeps the LOWER pin when the pool grows mid-signing', async () => {
    cacheGet.mockResolvedValue(18);
    await pinSuperguessQuote(34, 22);
    expect(cacheSet).not.toHaveBeenCalled();
  });

  it('replaces a higher pin, so the honored price only ever falls within the window', async () => {
    cacheGet.mockResolvedValue(22);
    await pinSuperguessQuote(34, 18);
    expect(cacheSet).toHaveBeenCalledWith(expect.stringContaining('quotepin:34'), 18, 300);
  });

  it('coerces the string round-trip Upstash performs in this deployment', async () => {
    cacheGet.mockResolvedValue('18');
    expect(await getPinnedSuperguessQuote(34)).toBe(18);
  });

  it('returns null with no pin, and never throws on a cache outage', async () => {
    expect(await getPinnedSuperguessQuote(34)).toBeNull();
    cacheGet.mockRejectedValue(new Error('redis down'));
    expect(await getPinnedSuperguessQuote(34)).toBeNull();
    await expect(pinSuperguessQuote(34, 20)).resolves.toBeUndefined();
  });
});

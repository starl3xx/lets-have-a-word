import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Purchases credit the $WORD prize pool at the 80/20 split.
 *
 * Packs and Superguesses are paid in ETH, which goes to the treasury, so
 * nothing reaches the pool by itself. 80% of each purchase is credited in $WORD
 * at the price in force when it was bought; the rest is creator revenue.
 *
 * Two properties matter more than the arithmetic:
 *
 *   1. The credit path must NEVER reject. By the time it runs the player has
 *      paid and their guesses are granted. A stale oracle at that point is the
 *      house's problem, and bouncing the purchase would take their money and
 *      give nothing back.
 *   2. It must credit exactly once per payment. A retried webhook is
 *      indistinguishable from a real purchase at every other layer, so the
 *      idempotency has to be real rather than best-effort.
 */

const { mockWordPrice, mockEthUsd, mockTopUp } = vi.hoisted(() => ({
  mockWordPrice: vi.fn(),
  mockEthUsd: vi.fn(),
  mockTopUp: vi.fn(),
}));

vi.mock('../lib/word-jackpot-contract', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/word-jackpot-contract')>();
  return {
    ...actual,
    getWordPriceOnChain: mockWordPrice,
    topUpWordPoolOnChain: mockTopUp,
  };
});

vi.mock('../lib/prices', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/prices')>();
  return { ...actual, getEthUsdPrice: mockEthUsd };
});

import { db } from '../db';
import { rounds, wordPoolCredits, systemState } from '../db/schema';
import { eq } from 'drizzle-orm';
import {
  creditWordPool,
  getUnflushedCreditTotal,
  flushWordPoolCredits,
} from '../lib/word-pool-credits';

// $0.000000256 per $WORD, 1e18-scaled.
const PRICE_E18 = 256000000000n;
const ETH_USD = 4000;

async function makeRound(prizeCurrency: 'eth' | 'word') {
  const [round] = await db
    .insert(rounds)
    .values({
      rulesetId: 1,
      answer: 'TESTS',
      salt: `s-${prizeCurrency}-${Math.floor(Number(process.hrtime.bigint() % 100000n))}`,
      commitHash: 'c'.repeat(64),
      prizePoolEth: '0',
      seedNextRoundEth: '0',
      prizeCurrency,
      prizePoolWord: '0',
      seedPriceE18: PRICE_E18.toString(),
    })
    .returning();
  return round;
}

async function cleanup(roundId: number) {
  await db.delete(wordPoolCredits).where(eq(wordPoolCredits.roundId, roundId));
  await db.delete(rounds).where(eq(rounds.id, roundId));
}

describe('crediting purchases to the $WORD pool', () => {
  beforeEach(() => {
    mockWordPrice.mockReset().mockResolvedValue({ priceE18: PRICE_E18, isStale: false });
    mockEthUsd.mockReset().mockResolvedValue(ETH_USD);
    mockTopUp.mockReset().mockResolvedValue('0xflushtx');
  });

  it('credits 80% of the purchase, in $WORD, at the current price', async () => {
    const round = await makeRound('word');
    try {
      // 0.001 ETH at $4000 = $4.00. At $0.000000256 per token that is
      // 15,625,000 tokens; 80% of it is 12,500,000.
      const res = await creditWordPool({
        roundId: round.id,
        source: 'pack',
        sourceRef: '0xaaa:0',
        ethAmountWei: 10n ** 15n,
      });

      expect(res.credited).toBe(true);
      const tokens = Number(res.wordAmountWei! / 10n ** 18n);
      expect(tokens).toBeCloseTo(12_500_000, -1);

      // The displayed pool grows immediately; the contract learns at flush.
      const [after] = await db.select().from(rounds).where(eq(rounds.id, round.id));
      expect(BigInt(after.prizePoolWord)).toBe(res.wordAmountWei);
    } finally {
      await cleanup(round.id);
    }
  });

  it('credits a payment exactly once, however many times it is submitted', async () => {
    const round = await makeRound('word');
    try {
      const first = await creditWordPool({
        roundId: round.id,
        source: 'pack',
        sourceRef: '0xbbb:1',
        ethAmountWei: 10n ** 15n,
      });
      const replay = await creditWordPool({
        roundId: round.id,
        source: 'pack',
        sourceRef: '0xbbb:1',
        ethAmountWei: 10n ** 15n,
      });

      expect(first.credited).toBe(true);
      expect(replay.credited).toBe(false);
      expect(replay.reason).toBe('already_credited');

      const rows = await db
        .select()
        .from(wordPoolCredits)
        .where(eq(wordPoolCredits.roundId, round.id));
      expect(rows).toHaveLength(1);

      // And crucially the pool moved once, not twice.
      const [after] = await db.select().from(rounds).where(eq(rounds.id, round.id));
      expect(BigInt(after.prizePoolWord)).toBe(first.wordAmountWei);
    } finally {
      await cleanup(round.id);
    }
  });

  it('does not reject the purchase when the price is unavailable', async () => {
    // The player has already paid. This must degrade, not throw.
    const round = await makeRound('word');
    try {
      mockWordPrice.mockRejectedValue(new Error('RPC down'));
      mockEthUsd.mockResolvedValue(null);

      const res = await creditWordPool({
        roundId: round.id,
        source: 'pack',
        sourceRef: '0xccc:0',
        ethAmountWei: 10n ** 15n,
      });

      expect(res.credited).toBe(false);
      expect(res.reason).toBe('no_price');
    } finally {
      await cleanup(round.id);
    }
  });

  it('falls back to the round’s seed price when the contract is unreachable', async () => {
    const round = await makeRound('word');
    try {
      mockWordPrice.mockRejectedValue(new Error('RPC down'));

      const res = await creditWordPool({
        roundId: round.id,
        source: 'superguess',
        sourceRef: '0xddd:2',
        ethAmountWei: 10n ** 15n,
      });

      expect(res.credited).toBe(true);
      const [row] = await db
        .select()
        .from(wordPoolCredits)
        .where(eq(wordPoolCredits.roundId, round.id));
      // Recorded, so a credit struck on the fallback rate is auditable later.
      expect(row.priceSource).toBe('round_seed');
    } finally {
      await cleanup(round.id);
    }
  });

  it('does nothing on an ETH round', async () => {
    const round = await makeRound('eth');
    try {
      const res = await creditWordPool({
        roundId: round.id,
        source: 'pack',
        sourceRef: '0xeee:0',
        ethAmountWei: 10n ** 15n,
      });

      expect(res.credited).toBe(false);
      expect(res.reason).toBe('not_a_word_round');
      const rows = await db
        .select()
        .from(wordPoolCredits)
        .where(eq(wordPoolCredits.roundId, round.id));
      expect(rows).toHaveLength(0);
    } finally {
      await cleanup(round.id);
    }
  });
});

describe('flushing credits to the contract', () => {
  beforeEach(() => {
    mockWordPrice.mockReset().mockResolvedValue({ priceE18: PRICE_E18, isStale: false });
    mockEthUsd.mockReset().mockResolvedValue(ETH_USD);
    mockTopUp.mockReset().mockResolvedValue('0xflushtx');
  });

  it('tops up once for the whole batch and marks the rows', async () => {
    const round = await makeRound('word');
    try {
      await creditWordPool({ roundId: round.id, source: 'pack', sourceRef: '0x1:0', ethAmountWei: 10n ** 15n });
      await creditWordPool({ roundId: round.id, source: 'pack', sourceRef: '0x2:0', ethAmountWei: 10n ** 15n });

      const before = await getUnflushedCreditTotal(round.id);
      expect(before).toBeGreaterThan(0n);

      const result = await flushWordPoolCredits(round.id);

      expect(result.creditCount).toBe(2);
      expect(result.amountWei).toBe(before);
      // One transaction for the batch — that is the point of batching.
      expect(mockTopUp).toHaveBeenCalledTimes(1);
      expect(mockTopUp).toHaveBeenCalledWith(before);

      expect(await getUnflushedCreditTotal(round.id)).toBe(0n);
    } finally {
      await cleanup(round.id);
    }
  });

  it('is a no-op with nothing pending', async () => {
    const round = await makeRound('word');
    try {
      const result = await flushWordPoolCredits(round.id);
      expect(result.creditCount).toBe(0);
      expect(mockTopUp).not.toHaveBeenCalled();
    } finally {
      await cleanup(round.id);
    }
  });
});

describe('resolve refuses while credits are unflushed', () => {
  beforeEach(() => {
    mockWordPrice.mockReset().mockResolvedValue({ priceE18: PRICE_E18, isStale: false });
    mockEthUsd.mockReset().mockResolvedValue(ETH_USD);
    mockTopUp.mockReset().mockResolvedValue('0xflushtx');
  });

  it('names the missing amount instead of reverting during payout', async () => {
    // The failure batching invites. resolveRound validates its payout sum
    // against the contract's currentPool, so an unflushed credit means the
    // payout transaction reverts — with a winner already found and the round
    // already announced. Refusing here turns that into a clear precondition
    // failure beforehand.
    const { resolveRoundAndCreatePayouts } = await import('../lib/economics');
    const round = await makeRound('word');

    try {
      await creditWordPool({
        roundId: round.id,
        source: 'pack',
        sourceRef: '0xunflushed:0',
        ethAmountWei: 10n ** 15n,
      });

      await expect(
        resolveRoundAndCreatePayouts(round.id, 4242)
      ).rejects.toThrow(/have not reached WordJackpot/);
    } finally {
      await cleanup(round.id);
    }
  });

  it('proceeds past the precondition once flushed', async () => {
    const { resolveRoundAndCreatePayouts } = await import('../lib/economics');
    const round = await makeRound('word');

    try {
      await creditWordPool({
        roundId: round.id,
        source: 'pack',
        sourceRef: '0xflushed:0',
        ethAmountWei: 10n ** 15n,
      });
      await flushWordPoolCredits(round.id);

      // It will still fail further along — no contract is configured under
      // test — but it must get past the credit precondition, which is the only
      // thing this asserts.
      await expect(
        resolveRoundAndCreatePayouts(round.id, 4242)
      ).rejects.not.toThrow(/have not reached WordJackpot/);
    } finally {
      await cleanup(round.id);
    }
  });
});

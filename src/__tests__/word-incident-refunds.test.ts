import { describe, it, expect, afterEach } from 'vitest';
import { getRefundPreview } from '../lib/refunds';
import { flushWordPoolCredits } from '../lib/word-pool-credits';
import { db, rounds, packPurchases, superguessSessions, wordPoolCredits } from '../db';
import { eq, inArray } from 'drizzle-orm';

/**
 * $WORD-era incident tooling
 *
 * A cancelled $WORD round refunds like an ETH round — players only ever pay
 * ETH (packs and Superguesses) — so the extension is:
 *  - ETH Superguess sessions join the per-user refund aggregation;
 *  - flushWordPoolCredits refuses cancelled rounds, so the treasury never
 *    parts with the 80% pool credits for purchases that are being refunded.
 */

const createdRoundIds: number[] = [];

async function createCancelledRound(prizeCurrency: 'eth' | 'word'): Promise<number> {
  const [round] = await db
    .insert(rounds)
    .values({
      rulesetId: 1,
      answer: 'BRAIN',
      salt: 'a'.repeat(64),
      commitHash: 'c'.repeat(64),
      status: 'cancelled',
      cancelledAt: new Date(),
      prizeCurrency,
    })
    .returning({ id: rounds.id });
  createdRoundIds.push(round.id);
  return round.id;
}

afterEach(async () => {
  if (createdRoundIds.length > 0) {
    await db.delete(wordPoolCredits).where(inArray(wordPoolCredits.roundId, createdRoundIds));
    await db.delete(superguessSessions).where(inArray(superguessSessions.roundId, createdRoundIds));
    await db.delete(packPurchases).where(inArray(packPurchases.roundId, createdRoundIds));
    await db.delete(rounds).where(inArray(rounds.id, createdRoundIds));
    createdRoundIds.length = 0;
  }
});

describe('getRefundPreview with Superguess sessions', () => {
  it('merges pack and ETH Superguess amounts per user', async () => {
    const roundId = await createCancelledRound('word');
    const fidBoth = 930001;
    const fidSgOnly = 930002;

    await db.insert(packPurchases).values({
      roundId,
      fid: fidBoth,
      packCount: 1,
      totalGuessesAtPurchase: 0,
      totalPriceEth: '0.001',
      totalPriceWei: (10n ** 15n).toString(),
      pricingPhase: 'BASE',
    });
    await db.insert(superguessSessions).values([
      {
        roundId,
        fid: fidBoth,
        tier: 'tier_1',
        currency: 'eth',
        ethAmountPaid: (2n * 10n ** 15n).toString(), // 0.002 ETH
        usdEquivalent: '5',
        burnedAmount: '0',
        stakingAmount: '0',
        status: 'cancelled',
        expiresAt: new Date(),
      },
      {
        roundId,
        fid: fidSgOnly,
        tier: 'tier_1',
        currency: 'eth',
        ethAmountPaid: (3n * 10n ** 15n).toString(), // 0.003 ETH
        usdEquivalent: '7',
        burnedAmount: '0',
        stakingAmount: '0',
        status: 'exhausted',
        expiresAt: new Date(),
      },
    ]);

    const preview = await getRefundPreview(roundId);
    expect(preview).not.toBeNull();
    expect(preview!.userCount).toBe(2);

    const both = preview!.users.find(u => u.fid === fidBoth)!;
    expect(both.totalAmountWei).toBe((3n * 10n ** 15n).toString()); // 0.001 + 0.002
    expect(both.purchaseCount).toBe(1);
    expect(both.superguessCount).toBe(1);

    const sgOnly = preview!.users.find(u => u.fid === fidSgOnly)!;
    expect(sgOnly.totalAmountWei).toBe((3n * 10n ** 15n).toString());
    expect(sgOnly.purchaseCount).toBe(0);
    expect(sgOnly.superguessCount).toBe(1);

    expect(preview!.totalRefundWei).toBe((6n * 10n ** 15n).toString());
  });
});

describe('flushWordPoolCredits on a cancelled round', () => {
  it('refuses to flush and reports what stayed with the treasury', async () => {
    const roundId = await createCancelledRound('word');

    await db.insert(wordPoolCredits).values({
      roundId,
      source: 'pack',
      sourceRef: `0xtest:${roundId}`,
      ethAmountWei: (10n ** 15n).toString(),
      wordAmountWei: (5n * 10n ** 24n).toString(), // 5M $WORD
      priceE18: (10n ** 12n).toString(),
      priceSource: 'round_seed',
    });

    const result = await flushWordPoolCredits(roundId);
    expect(result.flushed).toBe(false);
    expect(result.reason).toBe('round_cancelled');
    expect(result.amountWei).toBe(5n * 10n ** 24n);

    // The credit row is untouched — still unflushed, still the audit trail.
    const [credit] = await db
      .select({ flushedAt: wordPoolCredits.flushedAt })
      .from(wordPoolCredits)
      .where(eq(wordPoolCredits.roundId, roundId));
    expect(credit.flushedAt).toBeNull();
  });
});

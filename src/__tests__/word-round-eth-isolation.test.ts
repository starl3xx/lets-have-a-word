import { describe, it, expect } from 'vitest';
import { db } from '../db';
import { rounds, systemState } from '../db/schema';
import { eq } from 'drizzle-orm';
import {
  applyPaidGuessEconomicEffects,
  syncPrizePoolFromContract,
} from '../lib/economics';

/**
 * A $WORD round must never touch the ETH economy's columns.
 *
 * `applyPaidGuessEconomicEffects` models JackpotManagerV3: ETH in, 80% to the
 * contract jackpot, 20% split between the DB-tracked seed and creator balance.
 * A $WORD round shares none of that — the pack is still bought with ETH, but it
 * goes to WordPackSales and on to the treasury, while the prize sits in
 * WordJackpot as tokens.
 *
 * It was reachable without anyone doing anything wrong. All three call sites in
 * guesses.ts branch only on `isPaidGuess`, so the first pack purchase of round
 * 34 would read the old ETH contract's balance straight into prize_pool_eth.
 * The column starts at '0', which reads as an obvious bug; it then heals into a
 * plausible non-zero ETH figure that was never that round's prize — which
 * archive.ts copies into the permanent archive and the admin economics
 * aggregates sum into their ETH totals. A wrong number that looks right is
 * worse than a zero.
 *
 * These tests assert the columns are untouched rather than that a branch was
 * taken, so they keep working if the implementation moves.
 */

async function createRound(prizeCurrency: 'eth' | 'word') {
  const [round] = await db
    .insert(rounds)
    .values({
      rulesetId: 1,
      answer: 'TESTS',
      salt: `salt-${prizeCurrency}`,
      commitHash: `hash-${prizeCurrency}`,
      prizePoolEth: '0.1',
      seedNextRoundEth: '0.01',
      prizeCurrency,
    })
    .returning();
  return round;
}

async function creatorBalance(): Promise<string | null> {
  const [state] = await db.select().from(systemState).limit(1);
  return state?.creatorBalanceEth ?? null;
}

describe('a $WORD round is quarantined from the ETH economy', () => {
  it('leaves prize_pool_eth, seed and creator balance untouched on a paid guess', async () => {
    const round = await createRound('word');
    const creatorBefore = await creatorBalance();

    try {
      await applyPaidGuessEconomicEffects(round.id, '0.001');

      const [after] = await db.select().from(rounds).where(eq(rounds.id, round.id));

      // Exact string equality, not a tolerance: the correct behaviour is that
      // no write happened at all.
      expect(after.prizePoolEth).toBe(round.prizePoolEth);
      expect(after.seedNextRoundEth).toBe(round.seedNextRoundEth);
      expect(await creatorBalance()).toBe(creatorBefore);
    } finally {
      await db.delete(rounds).where(eq(rounds.id, round.id));
    }
  });

  it('still applies the ETH economics on an ETH round', async () => {
    // The guard must be narrow. If this stops working, the fix has broken
    // rounds 1-33's behaviour rather than isolated round 34+.
    const round = await createRound('eth');

    try {
      await applyPaidGuessEconomicEffects(round.id, '0.001');

      const [after] = await db.select().from(rounds).where(eq(rounds.id, round.id));

      // 20% of 0.001 to the seed, which has room under the 0.02 cap.
      expect(parseFloat(after.seedNextRoundEth)).toBeCloseTo(0.01 + 0.0002, 6);
      // The prize pool is read from the contract, which is unavailable under
      // test, so it falls back to the local calculation: +80% of 0.001.
      expect(parseFloat(after.prizePoolEth)).toBeCloseTo(0.1 + 0.0008, 6);
    } finally {
      await db.delete(rounds).where(eq(rounds.id, round.id));
    }
  });

  it('refuses to sync a $WORD round from the ETH contract', async () => {
    const round = await createRound('word');

    try {
      const returned = await syncPrizePoolFromContract(round.id);

      // Returns the existing value so callers assigning the result — round
      // creation does — do not end up with undefined.
      expect(returned).toBe(round.prizePoolEth);

      const [after] = await db.select().from(rounds).where(eq(rounds.id, round.id));
      expect(after.prizePoolEth).toBe(round.prizePoolEth);
    } finally {
      await db.delete(rounds).where(eq(rounds.id, round.id));
    }
  });
});

/**
 * The guards above read `prizeCurrency` off the round they are handed. That
 * only works if the round actually carries it.
 *
 * `getActiveRound` does `select()` — every column is fetched — and then
 * rebuilds a `Round` from a hand-written field list that omitted the $WORD
 * columns. `Round` declares `prizeCurrency` optional, so nothing type-checked
 * the omission, and the type's own comment reads a missing value as "an ETH
 * round". Every one of its ~50 callers got `undefined`, and any check of the
 * form `round.prizeCurrency === 'word'` silently never fired.
 */
describe('getActiveRound carries the currency discriminator', () => {
  it('returns prizeCurrency for a $WORD round', async () => {
    const { getActiveRound } = await import('../lib/rounds');
    const round = await createRound('word');

    try {
      const active = await getActiveRound();
      expect(active?.id).toBe(round.id);
      // The whole point: not undefined.
      expect(active?.prizeCurrency).toBe('word');
    } finally {
      await db.delete(rounds).where(eq(rounds.id, round.id));
    }
  });

  it('returns prizeCurrency for an ETH round', async () => {
    const { getActiveRound } = await import('../lib/rounds');
    const round = await createRound('eth');

    try {
      const active = await getActiveRound();
      expect(active?.prizeCurrency).toBe('eth');
    } finally {
      await db.delete(rounds).where(eq(rounds.id, round.id));
    }
  });
});

import { describe, it, expect } from 'vitest';
import { db } from '../db';
import { rounds, roundArchive, roundArchiveErrors, roundPayouts, guesses } from '../db/schema';
import { and, eq } from 'drizzle-orm';
import { archiveRound, getArchivedRoundWithUsernames } from '../lib/archive';
import { tokensForUsdCents } from '../lib/word-amounts';

/**
 * The archive must record what HAPPENED, not what it can recompute.
 *
 * Both claims here failed for a $WORD round, and the archive row is the one
 * place a wrong number is permanent — nothing recomputes it:
 *
 *   1. SEED. archiveRound derived a round's seed from the PREVIOUS round's
 *      carry. That was one number with two names in the ETH era, where the
 *      carry WAS the next round's whole opening pool. A $WORD round opens at a
 *      USD target instead (WordJackpot.startRound seeds
 *      seedUsdCents * 1e34 / priceE18 tokens) and the carry is only the first
 *      place the contract draws that seed from. Round 35 opened with
 *      116,686,114 $WORD ($39.99) while round 34 carried 5,244,446 $WORD
 *      forward — the carry rendered under the label "Seed" understates the
 *      opening pool by ~22x. Round 34 dodged it only because its predecessor
 *      was an ETH round.
 *
 *   2. TOP 10. archiveRound summed the top-guesser payout rows into one pool,
 *      re-derived its own Top 10 from the guesses table, and re-split the pool
 *      across THAT list. Since the reward gate, the paid list is not
 *      reproducible from guesses: getTop10Guessers drops an ineligible FID at
 *      resolve and promotes the next eligible one, and the gate is enabled in
 *      production. So the archive named one player at a rank whose tokens went
 *      to a different wallet.
 *
 * Fixtures are inserted directly rather than driven through createRound /
 * resolveRound: these tests are about what the archive READS, and the rows
 * they need (a gate-shaped payout list that disagrees with the guess ranking)
 * are not producible through the live path without a chain and a gate.
 */

/** $0.00000034272, 1e18-scaled — round 35's seed-time snapshot, near enough. */
const PRICE_E18 = '342720000000';
/** Round 35's seed target. */
const SEED_USD_CENTS = 3999;
/** What round 34 carried forward: real money, and NOT round 35's opening pool. */
const PREDECESSOR_CARRY_WORD = '5244446120000000000000000';
/** Final pool at resolve. economics.ts overwrites prize_pool_word with this. */
const FINAL_POOL_WORD = '117000000000000000000000000';

/** Wallet-era FIDs on purpose: isWalletFid() short-circuits every Neynar
 *  lookup in the read path, so these tests never touch the network. */
const WINNER_FID = 1_000_000_100;
const FID_A = 1_000_000_101; // 4 guesses — ranked 1 and paid
const FID_B = 1_000_000_102; // 3 guesses — ranked 2 and NOT paid (gated out)
const FID_C = 1_000_000_103; // 2 guesses — ranked 3, promoted into rank 2

/**
 * Exact paid amounts, carrying a tail no BPS re-split can reproduce.
 *
 * calculateTopGuesserPayouts hands the division remainder to rank 1
 * (top-guesser-payouts.ts), which is why the old recomputation came out a few
 * wei short at the top of every round. The archive must echo the stored string.
 */
const PAID_RANK1_WORD = '6350000000000000000000007';
const PAID_RANK2_WORD = '5349999999999999999999993';

async function insertRound(fields: Partial<typeof rounds.$inferInsert> = {}) {
  const [round] = await db
    .insert(rounds)
    .values({
      rulesetId: 1,
      answer: 'BRAIN', // legacy plaintext path: archiveRound stores it as-is
      salt: 'b'.repeat(64),
      commitHash: 'd'.repeat(64),
      prizePoolEth: '0',
      seedNextRoundEth: '0',
      status: 'resolved',
      startedAt: new Date(Date.now() - 3600_000),
      resolvedAt: new Date(),
      ...fields,
    })
    .returning();
  return round;
}

async function cleanup(...roundIds: number[]) {
  for (const roundId of roundIds) {
    await db.delete(roundArchive).where(eq(roundArchive.roundNumber, roundId));
    await db.delete(roundArchiveErrors).where(eq(roundArchiveErrors.roundNumber, roundId));
    await db.delete(roundPayouts).where(eq(roundPayouts.roundId, roundId));
    await db.delete(guesses).where(eq(guesses.roundId, roundId));
    await db.delete(rounds).where(eq(rounds.id, roundId));
  }
}

/** The unresolved archive incidents of one type for a round — what the admin
 *  Archive tab lists (getArchiveErrors defaults to unresolvedOnly). */
async function standingIncidents(roundId: number, errorType: string) {
  return db
    .select()
    .from(roundArchiveErrors)
    .where(
      and(
        eq(roundArchiveErrors.roundNumber, roundId),
        eq(roundArchiveErrors.errorType, errorType),
        eq(roundArchiveErrors.resolved, false)
      )
    );
}

describe('a $WORD round archives the pool it OPENED with', () => {
  it('prices the seed from its own target and snapshot, not the predecessor’s carry', async () => {
    const predecessor = await insertRound({
      prizeCurrency: 'word',
      prizePoolWord: '80000000000000000000000000',
      seedNextRoundWord: PREDECESSOR_CARRY_WORD,
      seedUsdCents: 2000,
      seedPriceE18: PRICE_E18,
      winnerFid: WINNER_FID,
    });
    const round = await insertRound({
      prizeCurrency: 'word',
      prizePoolWord: FINAL_POOL_WORD,
      seedUsdCents: SEED_USD_CENTS,
      seedPriceE18: PRICE_E18,
      winnerFid: WINNER_FID,
    });

    try {
      // The premise of the regression: the round under test follows the $WORD
      // round whose carry the old code would have used.
      expect(round.id, 'fixtures must be consecutive rounds').toBe(predecessor.id + 1);

      const result = await archiveRound({ roundId: round.id });
      expect(result.success, result.error).toBe(true);

      const [row] = await db
        .select()
        .from(roundArchive)
        .where(eq(roundArchive.roundNumber, round.id));

      const expectedOpeningPool = tokensForUsdCents(
        BigInt(SEED_USD_CENTS),
        BigInt(PRICE_E18)
      ).toString();

      expect(row.seedWord).toBe(expectedOpeningPool);
      expect(row.seedWord).not.toBe(PREDECESSOR_CARRY_WORD);
      // ~116.7M tokens against a 117M final pool, instead of 5.2M under a label
      // reading "Seed" — the number a player compares the final pool against.
      expect(BigInt(row.seedWord!)).toBeGreaterThan(100_000_000n * 10n ** 18n);
      // The ETH pair stays NULL so getArchiveStats' era sums skip it.
      expect(row.seedEth).toBeNull();
      expect(row.seedUsdCents).toBe(SEED_USD_CENTS);
    } finally {
      await cleanup(round.id, predecessor.id);
    }
  });

  it('records no seed rather than a guess when the price snapshot is missing', async () => {
    // A round seeded outside the normal path has no recoverable opening token
    // count. '0' would assert it opened empty, which is a real measurement and
    // a false one; NULL says the question cannot be answered.
    const round = await insertRound({
      prizeCurrency: 'word',
      prizePoolWord: FINAL_POOL_WORD,
      seedUsdCents: SEED_USD_CENTS,
      seedPriceE18: null,
      winnerFid: WINNER_FID,
    });

    try {
      const result = await archiveRound({ roundId: round.id });
      expect(result.success, result.error).toBe(true);

      const [row] = await db
        .select()
        .from(roundArchive)
        .where(eq(roundArchive.roundNumber, round.id));

      expect(row.seedWord).toBeNull();

      // And it says so out loud. Nothing ever recomputes an archive row, so
      // this round's opening pool is now unknowable and the public page renders
      // the NULL as "0 $WORD". Every other data-integrity failure in
      // archiveRound raises an archive error; this one used to warn into Vercel
      // and return success:true, leaving the Archive tab green over a
      // permanently wrong number.
      const incidents = await standingIncidents(round.id, 'seed_price_missing');
      expect(incidents).toHaveLength(1);
      expect(incidents[0].errorData).toMatchObject({ reason: 'columns_missing' });
      // The end-of-archive sweep resolves errors the archive superseded. It
      // must not resolve the one this very archive raised about the row it just
      // wrote — that would insert an incident and hide it in the same call.
      expect(incidents[0].resolved).toBe(false);
    } finally {
      await cleanup(round.id);
    }
  });

  it('leaves an ETH round on the previous round’s carry', async () => {
    // The fix must be narrow: rounds 1-33 keep the definition that was correct
    // for them, where the carry and the opening pool are the same number.
    const predecessor = await insertRound({ seedNextRoundEth: '0.02', winnerFid: WINNER_FID });
    const round = await insertRound({ prizePoolEth: '0.0416', winnerFid: WINNER_FID });

    try {
      expect(round.id).toBe(predecessor.id + 1);

      const result = await archiveRound({ roundId: round.id });
      expect(result.success, result.error).toBe(true);

      const [row] = await db
        .select()
        .from(roundArchive)
        .where(eq(roundArchive.roundNumber, round.id));

      // numeric(20,18) comes back zero-padded, so compare as a number.
      expect(parseFloat(row.seedEth!)).toBeCloseTo(0.02, 12);
      expect(row.seedWord).toBeNull();
    } finally {
      await cleanup(round.id, predecessor.id);
    }
  });
});

describe('the archived Top 10 is the list that was paid', () => {
  /**
   * A round where the gate's paid list and the guess ranking disagree.
   *
   * By guess count the ranking is A, B, C. The stored payouts are A then C:
   * the gate refused B at resolve and promoted C into rank 2, which is exactly
   * what getTop10Guessers does when checkPlayEligibility rejects a candidate.
   */
  async function seedGatedRound() {
    const round = await insertRound({
      prizeCurrency: 'word',
      prizePoolWord: FINAL_POOL_WORD,
      seedUsdCents: SEED_USD_CENTS,
      seedPriceE18: PRICE_E18,
      winnerFid: WINNER_FID,
    });

    const guessRows: (typeof guesses.$inferInsert)[] = [
      { roundId: round.id, fid: WINNER_FID, word: 'BRAIN', isCorrect: true, guessIndexInRound: 1 },
    ];
    let index = 2;
    for (const [fid, count] of [
      [FID_A, 4],
      [FID_B, 3],
      [FID_C, 2],
    ] as const) {
      for (let i = 0; i < count; i++) {
        guessRows.push({ roundId: round.id, fid, word: 'CRANE', guessIndexInRound: index++ });
      }
    }
    await db.insert(guesses).values(guessRows);

    // Inserted in one statement, in rank order — the same shape
    // resolveRoundAndCreatePayouts writes, and the only record of rank there
    // is (round_payouts has no rank column).
    await db.insert(roundPayouts).values([
      {
        roundId: round.id,
        fid: WINNER_FID,
        role: 'winner',
        currency: 'word',
        amountEth: null,
        amountWord: '93600000000000000000000000',
      },
      {
        roundId: round.id,
        fid: FID_A,
        role: 'top_guesser',
        currency: 'word',
        amountEth: null,
        amountWord: PAID_RANK1_WORD,
      },
      {
        roundId: round.id,
        fid: FID_C,
        role: 'top_guesser',
        currency: 'word',
        amountEth: null,
        amountWord: PAID_RANK2_WORD,
      },
      {
        roundId: round.id,
        fid: null,
        role: 'seed',
        currency: 'word',
        amountEth: null,
        amountWord: PREDECESSOR_CARRY_WORD,
      },
    ]);

    return round;
  }

  it('writes the paid recipients and their exact amounts, not a re-split ranking', async () => {
    const round = await seedGatedRound();
    try {
      const result = await archiveRound({ roundId: round.id });
      expect(result.success, result.error).toBe(true);

      const top = result.archived!.payoutsJson.topGuessers;

      // B out-guessed C and would have held rank 2 in any recomputation, but
      // the gate refused them and C received the tokens.
      expect(top.map((g) => g.fid)).toEqual([FID_A, FID_C]);
      expect(top.map((g) => g.rank)).toEqual([1, 2]);

      // Exact, to the wei. The trailing digits are the division remainder that
      // rank 1 takes at resolve; a BPS re-split cannot produce them.
      expect(top[0].amountWord).toBe(PAID_RANK1_WORD);
      expect(top[1].amountWord).toBe(PAID_RANK2_WORD);

      // amount_eth is NULL on a $WORD payout, and parseFloat(null) is NaN —
      // which compares false against everything and serialises as "NaN".
      expect(top.every((g) => g.amountEth === '0')).toBe(true);
      expect(JSON.stringify(top)).not.toContain('NaN');
    } finally {
      await cleanup(round.id);
    }
  });

  it('renders the paid list, so nobody is shown at a rank whose money went elsewhere', async () => {
    const round = await seedGatedRound();
    try {
      await archiveRound({ roundId: round.id });

      const view = await getArchivedRoundWithUsernames(round.id);
      expect(view).not.toBeNull();

      const shown = view!.topGuessersWithUsernames;
      expect(shown.map((g) => g.fid)).toEqual([FID_A, FID_C]);
      expect(shown.map((g) => g.rank)).toEqual([1, 2]);
      expect(shown.map((g) => g.amountWord)).toEqual([PAID_RANK1_WORD, PAID_RANK2_WORD]);

      // Guess counts still come from the guesses table, so the row describes
      // the player honestly even though the list is drawn from the payouts.
      expect(shown.map((g) => g.guessCount)).toEqual([4, 2]);

      // The excluded player is not presented as a paid rank.
      expect(shown.some((g) => g.fid === FID_B)).toBe(false);
      // Nor is the winner, who the round renders separately.
      expect(shown.some((g) => g.fid === WINNER_FID)).toBe(false);
    } finally {
      await cleanup(round.id);
    }
  });

  it('falls back to the guess ranking when a round has no top-guesser payouts', async () => {
    // Archives written before payouts existed, and rounds that paid nobody,
    // must keep rendering as they always have.
    const round = await insertRound({ prizePoolEth: '0.01', winnerFid: WINNER_FID });
    try {
      await db.insert(guesses).values([
        { roundId: round.id, fid: WINNER_FID, word: 'BRAIN', isCorrect: true, guessIndexInRound: 1 },
        { roundId: round.id, fid: FID_A, word: 'CRANE', guessIndexInRound: 2 },
        { roundId: round.id, fid: FID_A, word: 'SLATE', guessIndexInRound: 3 },
        { roundId: round.id, fid: FID_B, word: 'CRANE', guessIndexInRound: 4 },
      ]);

      const result = await archiveRound({ roundId: round.id });
      expect(result.success, result.error).toBe(true);
      expect(result.archived!.payoutsJson.topGuessers).toEqual([]);

      const view = await getArchivedRoundWithUsernames(round.id);
      expect(view!.topGuessersWithUsernames.map((g) => g.fid)).toEqual([FID_A, FID_B]);
      expect(view!.topGuessersWithUsernames.map((g) => g.guessCount)).toEqual([2, 1]);
      // Nothing was paid, and the row says so rather than inventing a share.
      expect(view!.topGuessersWithUsernames.map((g) => g.amountEth)).toEqual(['0', '0']);
    } finally {
      await cleanup(round.id);
    }
  });
});

describe('the public Top 10 stays a list of ten', () => {
  /** Ten paid FIDs, wallet-era so the read path never calls Neynar. */
  const PAID_FIDS = Array.from({ length: 10 }, (_, i) => 1_000_000_200 + i);

  /**
   * A round whose payout rows were written TWICE.
   *
   * resolveRoundAndCreatePayouts inserts the whole payout array and only marks
   * the round resolved a dozen awaits later. Kill the invocation in that window
   * (a function timeout) and the row has winner_fid set with resolved_at null,
   * which /api/admin/operational/recover-stuck-round diagnoses as stuck and
   * re-runs — and the only idempotency guard is `if (round.resolvedAt) return`,
   * still null. A second complete set of payout rows lands in round_payouts.
   */
  async function seedDoublePaidRound() {
    const round = await insertRound({
      prizeCurrency: 'word',
      prizePoolWord: FINAL_POOL_WORD,
      seedUsdCents: SEED_USD_CENTS,
      seedPriceE18: PRICE_E18,
      winnerFid: WINNER_FID,
    });

    const guessRows: (typeof guesses.$inferInsert)[] = [
      { roundId: round.id, fid: WINNER_FID, word: 'BRAIN', isCorrect: true, guessIndexInRound: 1 },
    ];
    let index = 2;
    PAID_FIDS.forEach((fid, rank) => {
      for (let i = 0; i <= 10 - rank; i++) {
        guessRows.push({ roundId: round.id, fid, word: 'CRANE', guessIndexInRound: index++ });
      }
    });
    await db.insert(guesses).values(guessRows);

    const payoutSet = () => [
      {
        roundId: round.id,
        fid: WINNER_FID,
        role: 'winner' as const,
        currency: 'word' as const,
        amountEth: null,
        amountWord: '93600000000000000000000000',
      },
      ...PAID_FIDS.map((fid) => ({
        roundId: round.id,
        fid,
        role: 'top_guesser' as const,
        currency: 'word' as const,
        amountEth: null,
        amountWord: PAID_RANK2_WORD,
      })),
    ];
    // Two complete sets, in two statements, exactly as a re-run writes them.
    await db.insert(roundPayouts).values(payoutSet());
    await db.insert(roundPayouts).values(payoutSet());

    return round;
  }

  it('records every payout row but renders each FID once, at most ten', async () => {
    const round = await seedDoublePaidRound();
    try {
      const result = await archiveRound({ roundId: round.id });
      expect(result.success, result.error).toBe(true);

      // payoutsJson keeps all twenty: it is the record of money that moved, and
      // a duplicate payout is exactly what an operator needs to see there.
      expect(result.archived!.payoutsJson.topGuessers).toHaveLength(20);

      // The public page renders it under the heading “Top 10 early guessers”
      // and slices nothing of its own, so the cap has to hold here.
      const view = await getArchivedRoundWithUsernames(round.id);
      const shown = view!.topGuessersWithUsernames;
      expect(shown).toHaveLength(10);
      expect(shown.map((g) => g.fid)).toEqual(PAID_FIDS);
      expect(new Set(shown.map((g) => g.fid)).size).toBe(10);
      expect(shown.map((g) => g.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    } finally {
      await cleanup(round.id);
    }
  });

  it('raises a standing incident instead of quietly tidying the duplicate away', async () => {
    const round = await seedDoublePaidRound();
    try {
      await archiveRound({ roundId: round.id });

      // Capping the render without reporting the cause would hide a double
      // payout in an immutable record. One resolve writes at most ten
      // top_guesser rows, one per FID, so twenty is not a display problem.
      const incidents = await standingIncidents(round.id, 'top_guesser_payouts_anomalous');
      expect(incidents).toHaveLength(1);
      expect(incidents[0].errorData).toMatchObject({ topGuesserRows: 20 });
      expect(incidents[0].resolved).toBe(false);
    } finally {
      await cleanup(round.id);
    }
  });

  it('leaves a short paid list short, because fewer than ten is normal', async () => {
    // A round with fewer than ten other guessers pays fewer than ten and the
    // ladder normalises for it. The cap must not imply an anomaly there.
    const round = await insertRound({ prizePoolEth: '0.01', winnerFid: WINNER_FID });
    try {
      await db.insert(guesses).values([
        { roundId: round.id, fid: WINNER_FID, word: 'BRAIN', isCorrect: true, guessIndexInRound: 1 },
        { roundId: round.id, fid: FID_A, word: 'CRANE', guessIndexInRound: 2 },
        { roundId: round.id, fid: FID_A, word: 'SLATE', guessIndexInRound: 3 },
      ]);
      await db.insert(roundPayouts).values([
        {
          roundId: round.id,
          fid: FID_A,
          role: 'top_guesser',
          currency: 'eth',
          amountEth: '0.001',
          amountWord: null,
        },
      ]);

      await archiveRound({ roundId: round.id });

      const view = await getArchivedRoundWithUsernames(round.id);
      expect(view!.topGuessersWithUsernames.map((g) => g.fid)).toEqual([FID_A]);
      expect(await standingIncidents(round.id, 'top_guesser_payouts_anomalous')).toHaveLength(0);
    } finally {
      await cleanup(round.id);
    }
  });
});

describe('the rendered guess count is measured over the window that paid', () => {
  const FID_FILLER = 1_000_000_301;
  const FID_TAIL = 1_000_000_302;

  it('counts a paid player whose guesses share the last eligible index', async () => {
    // getNextGuessIndexInRound allocated the index without a lock until the
    // per-round advisory lock shipped, so two guesses can carry the same index —
    // the round-34 guess-log wedge. The allocator is atomic now, but it
    // renumbers no existing row, so rounds played before it (round 34 certainly,
    // round 35 possibly) still hold duplicates and this window still has to
    // survive them. More than 850 rows then hold an index <= 850, and the
    // archive's positional window (the first 850 rows) drops the tail. The
    // payout window is the VALUE test, index <= 850, so a player paid for
    // guesses in that tail rendered at a real rank with a guess count of 0.
    const round = await insertRound({ prizePoolEth: '0.01', winnerFid: WINNER_FID });
    const threshold = 850; // round ids in tests are well past the 1-3 legacy 750
    const base = Date.UTC(2026, 8, 12, 17, 5, 31);

    try {
      const rows: (typeof guesses.$inferInsert)[] = [];
      for (let i = 1; i <= threshold; i++) {
        rows.push({
          roundId: round.id,
          fid: FID_FILLER,
          word: 'CRANE',
          guessIndexInRound: i,
          createdAt: new Date(base + i * 1000),
        });
      }
      // Two later guesses that both landed on the last eligible index.
      for (let i = 0; i < 2; i++) {
        rows.push({
          roundId: round.id,
          fid: FID_TAIL,
          word: 'SLATE',
          guessIndexInRound: threshold,
          createdAt: new Date(base + (threshold + 10 + i) * 1000),
        });
      }
      await db.insert(guesses).values(rows);

      await db.insert(roundPayouts).values([
        {
          roundId: round.id,
          fid: FID_TAIL,
          role: 'top_guesser',
          currency: 'eth',
          amountEth: '0.001',
          amountWord: null,
        },
      ]);

      const result = await archiveRound({ roundId: round.id });
      expect(result.success, result.error).toBe(true);

      const view = await getArchivedRoundWithUsernames(round.id);
      const shown = view!.topGuessersWithUsernames;
      expect(shown.map((g) => g.fid)).toEqual([FID_TAIL]);
      // 2, not 0: they were paid for guessing, so asserting zero guesses about
      // them on a permanent public page is a statement the data contradicts.
      expect(shown[0].guessCount).toBe(2);
    } finally {
      await cleanup(round.id);
    }
  });
});

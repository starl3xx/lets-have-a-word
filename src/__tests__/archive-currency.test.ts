import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db';
import { rounds, roundArchive, roundPayouts, guesses } from '../db/schema';
import { eq } from 'drizzle-orm';
import { archiveRound, getArchivedRounds } from '../lib/archive';
import { archiveCurrency, formatArchiveJackpot, formatPrizeCompact } from '../lib/prize-display';

/**
 * A $WORD round must survive the archive round-trip without turning into ETH.
 *
 * The archive row is the one place a wrong number is permanent — nothing
 * recomputes it. Three separate hand-written column lists were dropping the
 * currency discriminator, each invisible because none of them is a `select()`:
 *
 *   1. archiveRound's raw SQL never selected `prize_currency`, so the
 *      `archiveIsWord` flag it computes was ALWAYS false. Every currency branch
 *      downstream of it read as ETH. The code looked migrated and never ran.
 *   2. The insert wrote only seed_eth / final_jackpot_eth and left `currency`
 *      to its 'eth' column default.
 *   3. getArchivedRounds' select omitted the columns again, so even a correctly
 *      written row reached /api/archive/list with no currency on it.
 *
 * Any one of the three left intact makes a $WORD round render as ETH. So the
 * test drives the whole path rather than each piece: archive a $WORD round,
 * read it back the way the list endpoint does, and format it the way the UI
 * does.
 */

const WORD_POOL_WEI = '78125000000000000000000000'; // 78,125,000 $WORD
const PRICE_E18 = '256000000000'; // $0.000000256, 1e18-scaled

async function seedResolvedRound(currency: 'eth' | 'word') {
  const [round] = await db
    .insert(rounds)
    .values({
      rulesetId: 1,
      answer: 'BRAIN',
      salt: 'a'.repeat(64),
      commitHash: 'c'.repeat(64),
      prizePoolEth: currency === 'eth' ? '0.0216' : '0',
      seedNextRoundEth: '0.02',
      prizeCurrency: currency,
      // rounds.prize_pool_word is NOT NULL DEFAULT '0'; only the *archive*
      // columns are nullable, which is where the eth/word distinction is kept.
      prizePoolWord: currency === 'word' ? WORD_POOL_WEI : '0',
      seedPriceE18: currency === 'word' ? PRICE_E18 : null,
      seedUsdCents: currency === 'word' ? 2000 : null,
      status: 'active',
      winnerFid: 4242,
      startedAt: new Date(Date.now() - 3600_000),
      resolvedAt: new Date(),
    })
    .returning();

  await db.insert(guesses).values({
    roundId: round.id,
    fid: 4242,
    word: 'BRAIN',
    isCorrect: true,
    guessIndexInRound: 1,
  });

  await db.insert(roundPayouts).values({
    roundId: round.id,
    fid: 4242,
    role: 'winner',
    currency,
    amountEth: currency === 'eth' ? '0.01728' : null,
    amountWord: currency === 'word' ? '62500000000000000000000000' : null,
  });

  return round;
}

async function cleanup(roundId: number) {
  await db.delete(roundArchive).where(eq(roundArchive.roundNumber, roundId));
  await db.delete(roundPayouts).where(eq(roundPayouts.roundId, roundId));
  await db.delete(guesses).where(eq(guesses.roundId, roundId));
  await db.delete(rounds).where(eq(rounds.id, roundId));
}

describe('a $WORD round archives as a $WORD round', () => {
  it('writes currency and the word columns, leaving the ETH pair null', async () => {
    const round = await seedResolvedRound('word');
    try {
      const result = await archiveRound({ roundId: round.id });
      expect(result.success, result.error).toBe(true);

      const [row] = await db
        .select()
        .from(roundArchive)
        .where(eq(roundArchive.roundNumber, round.id));

      expect(row.currency).toBe('word');
      expect(row.finalJackpotWord).toBe(WORD_POOL_WEI);

      // Null, not '0'. '0' asserts "this round paid zero ETH", which is a real
      // measurement and is what getArchiveStats sums into the public "ETH
      // distributed" figure. Null says the question does not apply.
      expect(row.finalJackpotEth).toBeNull();
      expect(row.seedEth).toBeNull();

      // The USD snapshot is what keeps the round comparable years later.
      expect(row.seedUsdCents).toBe(2000);
      expect(row.finalJackpotUsdCents).toBeGreaterThan(0);
    } finally {
      await cleanup(round.id);
    }
  });

  it('still renders as $WORD after the list query and the formatter', async () => {
    // The end-to-end claim. getArchivedRounds' select and prize-display's
    // formatter are the two places a correctly-written row could still come out
    // as ETH.
    const round = await seedResolvedRound('word');
    try {
      await archiveRound({ roundId: round.id });

      const { rounds: listed } = await getArchivedRounds({ limit: 50 });
      const entry = listed.find((r) => r.roundNumber === round.id);
      expect(entry, 'round missing from archive list').toBeDefined();

      expect(archiveCurrency(entry!)).toBe('word');

      const rendered = formatArchiveJackpot(entry!);
      expect(rendered).toContain('$WORD');
      expect(rendered).not.toContain('ETH');
      expect(rendered).not.toContain('NaN');
    } finally {
      await cleanup(round.id);
    }
  });

  it('leaves an ETH round exactly as it was', async () => {
    // The guard must be narrow: rounds 1-33 keep their existing shape.
    const round = await seedResolvedRound('eth');
    try {
      await archiveRound({ roundId: round.id });

      const [row] = await db
        .select()
        .from(roundArchive)
        .where(eq(roundArchive.roundNumber, round.id));

      expect(row.currency).toBe('eth');
      // numeric(20,18) comes back zero-padded, so compare as a number.
      expect(parseFloat(row.finalJackpotEth!)).toBeCloseTo(0.0216, 6);
      expect(row.finalJackpotWord).toBeNull();

      const { rounds: listed } = await getArchivedRounds({ limit: 50 });
      const entry = listed.find((r) => r.roundNumber === round.id)!;
      expect(formatArchiveJackpot(entry)).toContain('ETH');
    } finally {
      await cleanup(round.id);
    }
  });
});

describe('formatPrizeCompact (info bar, decided 2026-08-15)', () => {
  const word = (tokens: number) => (BigInt(tokens) * 10n ** 18n).toString();

  it('compacts $WORD amounts to M/B/K notation', () => {
    expect(formatPrizeCompact({ currency: 'word', word: word(120_000_000) })).toBe('120M $WORD');
    expect(formatPrizeCompact({ currency: 'word', word: word(78_125_000) })).toBe('78.1M $WORD');
    expect(formatPrizeCompact({ currency: 'word', word: word(1_500_000_000) })).toBe('1.50B $WORD');
    expect(formatPrizeCompact({ currency: 'word', word: word(6_460_000_000) })).toBe('6.46B $WORD');
    expect(formatPrizeCompact({ currency: 'word', word: word(2_500) })).toBe('2.5K $WORD');
    expect(formatPrizeCompact({ currency: 'word', word: word(750) })).toBe('750 $WORD');
  });

  it('rolls up at unit boundaries instead of showing 1000M or 1000K', () => {
    expect(formatPrizeCompact({ currency: 'word', word: word(999_960_000) })).toBe('1.00B $WORD');
    expect(formatPrizeCompact({ currency: 'word', word: word(999_960) })).toBe('1M $WORD');
    expect(formatPrizeCompact({ currency: 'word', word: word(999_940_000) })).toBe('999.9M $WORD');
  });

  it('passes ETH through unchanged and survives malformed input', () => {
    expect(formatPrizeCompact({ currency: 'eth', eth: '0.0416' })).toBe('0.0416 ETH');
    expect(formatPrizeCompact({ currency: 'word', word: 'garbage' })).toBe('0 $WORD');
  });
});

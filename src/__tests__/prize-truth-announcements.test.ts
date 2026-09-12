import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  getRoundPrizeFromRow,
  getLivePoolPrize,
  getRoundPrize,
  parseWordWei,
  type RoundPrizeInput,
} from '../lib/round-prize';
import {
  JACKPOT_MILESTONES_USD_CENTS,
  checkAndAnnounceJackpotMilestones,
} from '../lib/announcer';
import { usdCentsForTokens } from '../lib/word-amounts';
import { db } from '../db';
import { announcerEvents, rounds, type RoundRow } from '../db/schema';

/**
 * Every player-facing surface must name the prize the player is actually
 * playing for.
 *
 * From round 34 on, the WordJackpot contract is NOT that number. Pack and
 * Superguess purchases grow rounds.prize_pool_word in the database and reach
 * the contract in ONE batched top-up immediately before resolve, so the
 * contract pool sits frozen at the seed for the whole round and is then paid
 * out to zero. Three surfaces read it anyway:
 *
 *   - the round-resolved cast, push and tweet, which run AFTER the payout and
 *     so announced round 34's winner as having won "the 0 $WORD jackpot";
 *   - the jackpot milestone ladder, pinned at the seed and therefore unable to
 *     fire at all;
 *   - the 11:00 UTC daily push, which under-reported for the whole round.
 *
 * These tests are written against the numbers those rounds really had, so a
 * regression reads as the incident rather than as an arbitrary assertion.
 */

// Round 35: seeded $39.99 = 116,686,114 $WORD at 2026-09-12T17:05:31Z.
const E18 = 10n ** 18n;
const R35_SEED_WEI = 116_686_114n * E18;
const R35_SEED_PRICE_E18 = '342714301034'; // $0.000000342714301034 per $WORD

// Round 34's final pool, as economics.ts wrote it to prize_pool_word one
// statement before calling announceRoundResolved.
const R34_FINAL_WEI = '104888922471467925207398656';

function wordRound(overrides: Partial<RoundPrizeInput> = {}): RoundPrizeInput {
  return {
    prizeCurrency: 'word',
    // A $WORD round's ETH column stays '0' forever — it is the column the old
    // code fell back to, and the reason a failed read announced a zero prize.
    prizePoolEth: '0',
    prizePoolWord: R35_SEED_WEI.toString(),
    seedPriceE18: R35_SEED_PRICE_E18,
    ...overrides,
  };
}

const solvency = vi.hoisted(() => vi.fn());

// Only getWordJackpotSolvency is replaced. The module has many other exports
// that rounds.ts and economics.ts import through the shared setup files, so a
// wholesale mock would break every file this one runs beside.
vi.mock('../lib/word-jackpot-contract', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/word-jackpot-contract')>();
  return { ...actual, getWordJackpotSolvency: solvency };
});

beforeEach(() => {
  solvency.mockReset();
});

describe('the resolved round announces the pool it actually paid out', () => {
  it('renders round 34 final pool from the row, not the emptied contract', () => {
    // The contract pool is 0 at this moment: resolveRound has already paid it
    // out. Reading the row is the only way to get the real figure.
    const prize = getRoundPrizeFromRow(
      wordRound({ prizePoolWord: R34_FINAL_WEI, seedPriceE18: R35_SEED_PRICE_E18 })
    );

    expect(prize.display).toBe('104,888,922 $WORD');
    expect(prize.display).not.toContain('0 $WORD jackpot');
    expect(prize.currency).toBe('word');
  });

  it('never reads a contract at all — it is a pure function', () => {
    getRoundPrizeFromRow(wordRound());
    expect(solvency).not.toHaveBeenCalled();
  });

  it('values the pool at the round own seed-price snapshot', () => {
    const prize = getRoundPrizeFromRow(wordRound());
    expect(prize.usd).toBe('39.98'); // $39.99 seed, integer-cent truncation
  });

  it('returns a null USD rather than a misleading $0.00 with no seed price', () => {
    const prize = getRoundPrizeFromRow(wordRound({ seedPriceE18: null }));
    expect(prize.usd).toBeNull();
    expect(prize.display).toBe('116,686,114 $WORD');
  });

  it('renders 0 $WORD rather than throwing on an unparseable column', () => {
    const prize = getRoundPrizeFromRow(wordRound({ prizePoolWord: 'not-a-number' }));
    expect(prize.display).toBe('0 $WORD');
  });
});

describe('the ETH era renders exactly as it always did', () => {
  it('trims trailing zeros, the way every cast and push has since round 1', () => {
    // "0.02 ETH", never "0.0200 ETH" — this is why the ETH branch does not go
    // through prize-display's formatPrize, which pads to four decimals.
    expect(getRoundPrizeFromRow({ prizeCurrency: 'eth', prizePoolEth: '0.0200' }).display).toBe(
      '0.02 ETH'
    );
    expect(getRoundPrizeFromRow({ prizeCurrency: 'eth', prizePoolEth: '0.0216' }).display).toBe(
      '0.0216 ETH'
    );
  });

  it('reads prize_pool_eth off the row, which is what the resolved cast did pre-$WORD', () => {
    const prize = getRoundPrizeFromRow({ prizeCurrency: 'eth', prizePoolEth: '0.1234' });
    expect(prize).toEqual({ display: '0.1234 ETH', usd: null, currency: 'eth' });
  });

  it('treats a missing discriminator as ETH — which is why callers must carry it', () => {
    // Round.prizeCurrency is optional, so a hand-written field list that drops
    // it type-checks and silently lands a $WORD round in the ETH branch. Four
    // bugs came from this in one day; the assertion pins the default so nobody
    // "fixes" it into a guess.
    const prize = getRoundPrizeFromRow({ prizePoolEth: '0', prizePoolWord: R34_FINAL_WEI });
    expect(prize.currency).toBe('eth');
    expect(prize.display).toBe('0 ETH');
  });
});

describe('the daily push reports the live pool, not the frozen contract', () => {
  it('takes a $WORD round straight off the row without touching WordJackpot', async () => {
    const grown = (R35_SEED_WEI * 26n) / 10n; // pack sales carried it to 2.6x
    const prize = await getLivePoolPrize(wordRound({ prizePoolWord: grown.toString() }));

    expect(solvency).not.toHaveBeenCalled();
    expect(prize.display).toBe('303,383,896 $WORD');
  });

  it('still reads the contract for an ETH round, where it is the live number', async () => {
    // No contract is configured under test, so getCurrentJackpotOnChain throws
    // and the documented fallback to prize_pool_eth takes over. What matters is
    // that the ETH path is unchanged: it does not consult the $WORD row.
    const prize = await getLivePoolPrize({ prizeCurrency: 'eth', prizePoolEth: '0.0216' });
    expect(prize.currency).toBe('eth');
    expect(prize.display).toBe('0.0216 ETH');
  });
});

describe('the round-started cast keeps its independent contract read', () => {
  it('reads WordJackpot rather than the row, so a seeding mismatch is caught', async () => {
    // The row claims a pool the contract does not hold. At round start that is
    // a seeding bug, and the cast must promise what the contract can pay.
    solvency.mockResolvedValue({ poolWei: R35_SEED_WEI });

    const prize = await getRoundPrize(wordRound({ prizePoolWord: (R35_SEED_WEI * 9n).toString() }));

    expect(solvency).toHaveBeenCalledTimes(1);
    expect(prize.display).toBe('116,686,114 $WORD');
  });

  it('falls back to the $WORD column, never to the ETH one, when the RPC throws', async () => {
    solvency.mockRejectedValue(new Error('RPC down'));

    const prize = await getRoundPrize(wordRound());

    // The pre-#169 path fell back to prizePoolEth ('0' here), announcing a zero
    // prize rather than a stale one.
    expect(prize.display).toBe('116,686,114 $WORD');
  });
});

describe('the $WORD milestone ladder can be reached from the row', () => {
  it('does not fire on the seed alone', () => {
    const seedCents = usdCentsForTokens(R35_SEED_WEI, BigInt(R35_SEED_PRICE_E18));
    expect(seedCents).toBeLessThan(BigInt(JACKPOT_MILESTONES_USD_CENTS[0]));
  });

  it('fires once purchases have grown the row past the first rung', () => {
    // The contract read this replaced was pinned at the seed for the whole
    // round, so this comparison could never come out true and no milestone
    // cast has ever fired on a $WORD round.
    const grown = (R35_SEED_WEI * 26n) / 10n;
    const grownCents = usdCentsForTokens(grown, BigInt(R35_SEED_PRICE_E18));
    expect(grownCents).toBeGreaterThanOrEqual(BigInt(JACKPOT_MILESTONES_USD_CENTS[0]));
  });

  it('keeps the ladder above the $40 seed so nothing fires before a guess', () => {
    // The seed doubled on 2026-09-08 and the ladder doubled with it. A first
    // rung at or below the seed would cast the instant a round opened.
    const seedCents = Number(usdCentsForTokens(R35_SEED_WEI, BigInt(R35_SEED_PRICE_E18)));
    expect(JACKPOT_MILESTONES_USD_CENTS[0]).toBeGreaterThan(seedCents * 2);
  });
});

describe('a backlog of milestone rungs collapses to one cast', () => {
  /**
   * A $WORD round row, inserted directly.
   *
   * createRound() would reach WordJackpot to seed it; the row is all the
   * milestone check reads, and production only exposes a $WORD round once the
   * seed price is written (rounds.ts), so this is the shape that really exists.
   */
  async function insertWordRound(prizePoolWord: bigint): Promise<RoundRow> {
    const [row] = await db
      .insert(rounds)
      .values({
        rulesetId: 1,
        answer: 'RUNGS',
        salt: `rung-${process.hrtime.bigint()}`.padEnd(64, '0').slice(0, 64),
        commitHash: 'c'.repeat(64),
        prizePoolEth: '0',
        seedNextRoundEth: '0',
        status: 'active',
        prizeCurrency: 'word',
        prizePoolWord: prizePoolWord.toString(),
        seedPriceE18: R35_SEED_PRICE_E18,
      })
      .returning();
    return row;
  }

  async function milestoneRows(roundId: number) {
    const rows = await db
      .select()
      .from(announcerEvents)
      .where(
        and(
          eq(announcerEvents.roundId, roundId),
          eq(announcerEvents.eventType, 'jackpot_milestone')
        )
      );
    return rows
      .map((row) => ({
        key: row.milestoneKey,
        suppressed: (row.payload as { suppressed?: boolean }).suppressed === true,
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  const createdRoundIds: number[] = [];

  afterEach(async () => {
    for (const id of createdRoundIds) {
      await db.delete(announcerEvents).where(eq(announcerEvents.roundId, id));
      await db
        .update(rounds)
        .set({ status: 'resolved', resolvedAt: new Date() })
        .where(eq(rounds.id, id));
    }
    createdRoundIds.length = 0;
  });

  it('is ascending, which is what puts the suppressed rows in before the cast', () => {
    // The rungs are written in ladder order, so an invocation that dies partway
    // has already claimed the rungs below the one it was about to cast. Which
    // rung gets cast does not depend on this — that is a Math.max — but the
    // write order does, and a duplicate rung would record a row nothing reads.
    const sorted = [...JACKPOT_MILESTONES_USD_CENTS].sort((a, b) => a - b);
    expect(JACKPOT_MILESTONES_USD_CENTS).toEqual(sorted);
    expect(new Set(JACKPOT_MILESTONES_USD_CENTS).size).toBe(JACKPOT_MILESTONES_USD_CENTS.length);
  });

  it('casts only the highest rung and records the ones already passed', async () => {
    // $279.93: past $100 and $200 at once. This is the state the fix ships
    // into, because the ladder has never been able to fire on a $WORD round —
    // whichever player guesses first would otherwise have paid for a cast and a
    // tweet per rung, inline in their own guess request.
    const round = await insertWordRound(R35_SEED_WEI * 7n);
    createdRoundIds.push(round.id);

    await checkAndAnnounceJackpotMilestones(round);

    expect(await milestoneRows(round.id)).toEqual([
      { key: 'jackpot_usd_10000', suppressed: true },
      { key: 'jackpot_usd_20000', suppressed: false },
    ]);
  });

  it('never re-opens a rung it has already passed on a later check', async () => {
    const round = await insertWordRound(R35_SEED_WEI * 7n);
    createdRoundIds.push(round.id);
    await checkAndAnnounceJackpotMilestones(round);

    // One Superguess is priced at half the live pool, so a single purchase can
    // carry the round up a rung. $599.85: past $500, not yet $1000.
    const grown = { ...round, prizePoolWord: (R35_SEED_WEI * 15n).toString() };
    await checkAndAnnounceJackpotMilestones(grown);

    expect(await milestoneRows(round.id)).toEqual([
      { key: 'jackpot_usd_10000', suppressed: true },
      // Cast on the first check, and left exactly as it was by the second —
      // the dedupe on (eventType, roundId, milestoneKey) returns before writing.
      { key: 'jackpot_usd_20000', suppressed: false },
      { key: 'jackpot_usd_50000', suppressed: false },
    ]);
  });

  it('writes nothing at all while the pool is below the first rung', async () => {
    const round = await insertWordRound(R35_SEED_WEI);
    createdRoundIds.push(round.id);

    await checkAndAnnounceJackpotMilestones(round);

    expect(await milestoneRows(round.id)).toEqual([]);
  });
});

describe('both numeric columns are read through the same parser', () => {
  it('parses a wei string, and treats null as zero', () => {
    expect(parseWordWei('116686114000000000000000000', 'prizePoolWord')).toBe(R35_SEED_WEI);
    expect(parseWordWei(null, 'prizePoolWord')).toBe(0n);
    expect(parseWordWei(undefined, 'prizePoolWord')).toBe(0n);
  });

  it('returns 0 rather than throwing on a value BigInt cannot take', () => {
    // A hand-run backfill writing '3.4271e11' into a numeric column is the only
    // way this happens, and an exponent string is exactly what BigInt rejects.
    expect(parseWordWei('3.4271e11', 'seedPriceE18')).toBe(0n);
    expect(parseWordWei('not-a-number', 'prizePoolWord')).toBe(0n);
  });

  it('skips the milestone check instead of throwing out of submitGuess', async () => {
    // The milestone check is awaited inside submitGuess. A bare BigInt() on
    // seed_price_e18 would throw past it and cost the player a swallowed stack
    // trace where the adjacent column produces a named warning.
    const round = {
      id: 35,
      prizeCurrency: 'word',
      prizePoolEth: '0',
      prizePoolWord: R35_SEED_WEI.toString(),
      seedPriceE18: '3.4271e11',
    } as unknown as RoundRow;

    await expect(checkAndAnnounceJackpotMilestones(round)).resolves.toBeUndefined();
  });
});

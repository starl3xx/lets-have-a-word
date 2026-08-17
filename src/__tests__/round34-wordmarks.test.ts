import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  WORDMARK_DEFINITIONS,
  ROUND34_WORDMARK_TYPES,
  EARLY_ADOPTER_LAST_ROUND,
  awardTrailblazerForRound,
  hasWordmark,
} from '../lib/wordmarks';
import { db, userBadges, rounds, guesses } from '../db';
import { and, eq, inArray } from 'drizzle-orm';

/**
 * Round 34 launch wordmarks
 *
 * EARLY_ADOPTER — complimentary, frozen cohort: first guess in rounds 1–18
 * (before round 19, the first botted round). Awarded only by the backfill
 * endpoint; there is no live award path, so only the definition is tested.
 *
 * TRAILBLAZER — recurring: the maker of a round's #1 global guess, resolved
 * from MIN(guesses.id) at round resolution (guess-time index checks race
 * under concurrency). A single item — going first in five rounds still means
 * holding one Trailblazer.
 */

describe('Round 34 wordmark definitions', () => {
  it('defines Early Adopter as a pink 💅 mark', () => {
    const def = WORDMARK_DEFINITIONS.EARLY_ADOPTER;
    expect(def.name).toBe('Early Adopter');
    expect(def.emoji).toBe('💅');
    expect(def.color).toBe('pink');
  });

  it('defines Trailblazer as a teal 🚩 mark', () => {
    const def = WORDMARK_DEFINITIONS.TRAILBLAZER;
    expect(def.name).toBe('Trailblazer');
    expect(def.emoji).toBe('🚩');
    expect(def.color).toBe('teal');
  });

  it('freezes the Early Adopter cutoff before the first botted round (19)', () => {
    expect(EARLY_ADOPTER_LAST_ROUND).toBe(18);
  });

  it('lists exactly the two launch marks as hidden until the $WORD era', () => {
    expect(ROUND34_WORDMARK_TYPES.sort()).toEqual(['EARLY_ADOPTER', 'TRAILBLAZER']);
  });
});

describe('awardTrailblazerForRound', () => {
  let fidA: number;
  let fidB: number;
  const createdRoundIds: number[] = [];

  async function createRoundFixture(): Promise<number> {
    const [round] = await db
      .insert(rounds)
      .values({
        rulesetId: 1,
        answer: 'BRAIN',
        salt: 'a'.repeat(64),
        commitHash: 'c'.repeat(64),
        status: 'resolved',
      })
      .returning();
    createdRoundIds.push(round.id);
    return round.id;
  }

  beforeEach(async () => {
    fidA = Math.floor(Math.random() * 1000000) + 100000;
    fidB = Math.floor(Math.random() * 1000000) + 2000000;
    await db.delete(userBadges).where(inArray(userBadges.fid, [fidA, fidB]));
  });

  afterEach(async () => {
    if (createdRoundIds.length > 0) {
      await db.delete(guesses).where(inArray(guesses.roundId, createdRoundIds));
      await db.delete(rounds).where(inArray(rounds.id, createdRoundIds));
      createdRoundIds.length = 0;
    }
    await db.delete(userBadges).where(inArray(userBadges.fid, [fidA, fidB]));
  });

  it('returns false for a round with no guesses', async () => {
    const roundId = await createRoundFixture();
    expect(await awardTrailblazerForRound(roundId)).toBe(false);
  });

  it('awards the maker of the round’s first guess by id order', async () => {
    const roundId = await createRoundFixture();
    await db.insert(guesses).values([
      { roundId, fid: fidA, word: 'CRANE' },
      { roundId, fid: fidB, word: 'SLATE' },
    ]);

    expect(await awardTrailblazerForRound(roundId)).toBe(true);
    expect(await hasWordmark(fidA, 'TRAILBLAZER')).toBe(true);
    expect(await hasWordmark(fidB, 'TRAILBLAZER')).toBe(false);

    const [row] = await db
      .select()
      .from(userBadges)
      .where(and(eq(userBadges.fid, fidA), eq(userBadges.badgeType, 'TRAILBLAZER')));
    expect(row.metadata).toMatchObject({ roundId });
  });

  it('skips ineligible-winner audit rows', async () => {
    const roundId = await createRoundFixture();
    await db.insert(guesses).values([
      { roundId, fid: fidB, word: 'BRAIN', isCorrect: true, isIneligibleWinner: true },
      { roundId, fid: fidA, word: 'MOUNT' },
    ]);

    expect(await awardTrailblazerForRound(roundId)).toBe(true);
    expect(await hasWordmark(fidA, 'TRAILBLAZER')).toBe(true);
    expect(await hasWordmark(fidB, 'TRAILBLAZER')).toBe(false);
  });

  it('is idempotent and stays a single item across rounds', async () => {
    const firstRound = await createRoundFixture();
    await db.insert(guesses).values({ roundId: firstRound, fid: fidA, word: 'CRANE' });
    expect(await awardTrailblazerForRound(firstRound)).toBe(true);

    // Re-resolving the same round (Recover Stuck Round) is a no-op
    expect(await awardTrailblazerForRound(firstRound)).toBe(false);

    // Going first again in a later round is a no-op too
    const secondRound = await createRoundFixture();
    await db.insert(guesses).values({ roundId: secondRound, fid: fidA, word: 'SLATE' });
    expect(await awardTrailblazerForRound(secondRound)).toBe(false);

    const rows = await db
      .select()
      .from(userBadges)
      .where(and(eq(userBadges.fid, fidA), eq(userBadges.badgeType, 'TRAILBLAZER')));
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toMatchObject({ roundId: firstRound });
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import {
  WORDMARK_DEFINITIONS,
  ROUND34_WORDMARK_TYPES,
  EARLY_ADOPTER_LAST_ROUND,
  checkAndAwardTrailblazer,
  hasWordmark,
} from '../lib/wordmarks';
import { db, userBadges } from '../db';
import { and, eq } from 'drizzle-orm';

/**
 * Round 34 launch wordmarks
 *
 * EARLY_ADOPTER — complimentary, frozen cohort: first guess in rounds 1–18
 * (before round 19, the first botted round). Awarded only by the backfill
 * endpoint; there is no live award path, so only the definition is tested.
 *
 * TRAILBLAZER — recurring: the maker of a round's #1 global guess. A single
 * item — going first in five rounds still means holding one Trailblazer.
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

describe('checkAndAwardTrailblazer', () => {
  let testFid: number;

  beforeEach(async () => {
    testFid = Math.floor(Math.random() * 1000000) + 100000;
    await db.delete(userBadges).where(eq(userBadges.fid, testFid));
  });

  it('does not award for any guess index other than 1', async () => {
    expect(await checkAndAwardTrailblazer(testFid, 40, 2)).toBe(false);
    expect(await checkAndAwardTrailblazer(testFid, 40, 850)).toBe(false);
    expect(await checkAndAwardTrailblazer(testFid, 40, null)).toBe(false);
    expect(await checkAndAwardTrailblazer(testFid, 40, undefined)).toBe(false);
    expect(await hasWordmark(testFid, 'TRAILBLAZER')).toBe(false);
  });

  it('awards for the #1 guess and records the round in metadata', async () => {
    const awarded = await checkAndAwardTrailblazer(testFid, 40, 1);
    expect(awarded).toBe(true);

    const [row] = await db
      .select()
      .from(userBadges)
      .where(and(eq(userBadges.fid, testFid), eq(userBadges.badgeType, 'TRAILBLAZER')));
    expect(row).toBeDefined();
    expect(row.metadata).toMatchObject({ roundId: 40 });
  });

  it('stays a single item when the same player goes first again', async () => {
    expect(await checkAndAwardTrailblazer(testFid, 40, 1)).toBe(true);
    expect(await checkAndAwardTrailblazer(testFid, 41, 1)).toBe(false);

    const rows = await db
      .select()
      .from(userBadges)
      .where(and(eq(userBadges.fid, testFid), eq(userBadges.badgeType, 'TRAILBLAZER')));
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toMatchObject({ roundId: 40 });
  });
});

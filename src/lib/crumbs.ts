/**
 * Crumbs Library
 * Persistence layer for puzzle crumbs — shorter words (4–8 letters)
 * discovered by players during a round.
 *
 * Crumbs are permanent per puzzle per user: once found, they stay forever.
 */

import { db } from '../db';
import { puzzleCrumbs } from '../db/schema';
import { eq, and, asc } from 'drizzle-orm';
import type { SaveCrumbResult, CrumbsResponse } from '../types';

/** Minimum crumb word length (inclusive) */
const MIN_CRUMB_LENGTH = 4;
/** Maximum crumb word length (inclusive) */
const MAX_CRUMB_LENGTH = 8;

/**
 * Save a crumb for a user on a given round.
 * Uses INSERT ... ON CONFLICT DO NOTHING for idempotent dedup.
 */
export async function saveCrumb(
  roundId: number,
  fid: number,
  word: string,
): Promise<SaveCrumbResult> {
  const normalized = word.toUpperCase().trim();

  // Validate word length
  if (normalized.length < MIN_CRUMB_LENGTH || normalized.length > MAX_CRUMB_LENGTH) {
    return {
      status: 'invalid_word',
      reason: `Word must be ${MIN_CRUMB_LENGTH}–${MAX_CRUMB_LENGTH} letters`,
    };
  }

  // Validate alpha-only
  if (!/^[A-Z]+$/.test(normalized)) {
    return { status: 'invalid_word', reason: 'Word must contain only letters' };
  }

  const result = await db
    .insert(puzzleCrumbs)
    .values({ roundId, fid, word: normalized })
    .onConflictDoNothing()
    .returning({ id: puzzleCrumbs.id });

  // If returning is empty, the row already existed (conflict)
  if (result.length === 0) {
    return { status: 'duplicate', word: normalized, roundId };
  }

  return { status: 'saved', word: normalized, roundId };
}

/**
 * Fetch all crumbs for a user on a given round, sorted by discovery time.
 */
export async function getCrumbs(
  roundId: number,
  fid: number,
): Promise<CrumbsResponse> {
  const rows = await db
    .select({ word: puzzleCrumbs.word })
    .from(puzzleCrumbs)
    .where(and(
      eq(puzzleCrumbs.roundId, roundId),
      eq(puzzleCrumbs.fid, fid),
    ))
    .orderBy(asc(puzzleCrumbs.foundAt));

  return {
    roundId,
    fid,
    crumbs: rows.map((r) => r.word),
    count: rows.length,
  };
}

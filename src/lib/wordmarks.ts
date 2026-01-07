/**
 * Wordmarks Library
 * Handles wordmark definitions, awarding, and fetching
 *
 * Wordmarks are permanent achievements earned by playing Let's Have A Word
 */

import { db, userBadges, guesses, bakersDozenProgress } from '../db';
import { eq, and, sql } from 'drizzle-orm';
import type { WordmarkType, BakersDozenProgressRow } from '../db/schema';

/**
 * Wordmark definition with display properties
 */
export interface WordmarkDefinition {
  id: WordmarkType;
  name: string;
  description: string;
  emoji: string;
  color: string; // Tailwind color class
}

/**
 * All wordmark definitions
 */
export const WORDMARK_DEFINITIONS: Record<WordmarkType, WordmarkDefinition> = {
  OG_HUNTER: {
    id: 'OG_HUNTER',
    name: 'OG Hunter',
    description: 'Participated in the OG Hunter campaign',
    emoji: '🕵️‍♂️',
    color: 'purple',
  },
  BONUS_WORD_FINDER: {
    id: 'BONUS_WORD_FINDER',
    name: 'Side Quest',
    description: 'Found a bonus word during a round',
    emoji: '🎣',
    color: 'cyan',
  },
  JACKPOT_WINNER: {
    id: 'JACKPOT_WINNER',
    name: 'Jackpot Winner',
    description: 'Won a round jackpot',
    emoji: '🏆',
    color: 'amber',
  },
  DOUBLE_W: {
    id: 'DOUBLE_W',
    name: 'Double Dub',
    description: 'Hit two bonus words OR bonus word + secret word in one round',
    emoji: '✌️',
    color: 'indigo',
  },
  PATRON: {
    id: 'PATRON',
    name: 'Patron',
    description: 'Referred a jackpot winner',
    emoji: '🤝',
    color: 'rose',
  },
  QUICKDRAW: {
    id: 'QUICKDRAW',
    name: 'Quickdraw',
    description: 'Placed in Top 10 Early Guessers',
    emoji: '⚡',
    color: 'emerald',
  },
  ENCYCLOPEDIC: {
    id: 'ENCYCLOPEDIC',
    name: 'Encyclopedic',
    description: 'Guessed words starting with every letter A–Z',
    emoji: '📚',
    color: 'sky',
  },
  BAKERS_DOZEN: {
    id: 'BAKERS_DOZEN',
    name: 'Baker\'s Dozen',
    description: 'Guessed words starting with 13 different letters across 13 different days',
    emoji: '🍩',
    color: 'orange',
  },
};

/**
 * Get all wordmark definitions as an array
 */
export function getAllWordmarkDefinitions(): WordmarkDefinition[] {
  return Object.values(WORDMARK_DEFINITIONS);
}

/**
 * User's wordmark status
 */
export interface UserWordmark {
  id: WordmarkType;
  name: string;
  description: string;
  emoji: string;
  color: string;
  earned: boolean;
  earnedAt?: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Fetch all wordmarks for a user with earned status
 */
export async function getUserWordmarks(fid: number): Promise<UserWordmark[]> {
  // Fetch user's earned wordmarks
  const earnedWordmarks = await db
    .select()
    .from(userBadges)
    .where(eq(userBadges.fid, fid));

  const earnedMap = new Map(
    earnedWordmarks.map(w => [w.badgeType, { earnedAt: w.awardedAt, metadata: w.metadata }])
  );

  // Return all wordmarks with earned status
  return getAllWordmarkDefinitions().map(def => ({
    ...def,
    earned: earnedMap.has(def.id),
    earnedAt: earnedMap.get(def.id)?.earnedAt,
    metadata: earnedMap.get(def.id)?.metadata ?? undefined,
  }));
}

/**
 * Check if user has a specific wordmark
 */
export async function hasWordmark(fid: number, wordmarkType: WordmarkType): Promise<boolean> {
  const result = await db
    .select({ id: userBadges.id })
    .from(userBadges)
    .where(and(eq(userBadges.fid, fid), eq(userBadges.badgeType, wordmarkType)))
    .limit(1);

  return result.length > 0;
}

/**
 * Award a wordmark to a user (idempotent - won't duplicate)
 */
export async function awardWordmark(
  fid: number,
  wordmarkType: WordmarkType,
  metadata?: Record<string, unknown>
): Promise<boolean> {
  try {
    await db
      .insert(userBadges)
      .values({
        fid,
        badgeType: wordmarkType,
        metadata: metadata ?? null,
      })
      .onConflictDoNothing();

    console.log(`🏅 Awarded ${wordmarkType} wordmark to FID ${fid}`);
    return true;
  } catch (error) {
    console.error(`Failed to award ${wordmarkType} wordmark to FID ${fid}:`, error);
    return false;
  }
}

/**
 * Check and award QUICKDRAW wordmark
 * Awarded when user places in Top 10 Early Guessers for a round
 */
export async function checkAndAwardQuickdraw(
  fid: number,
  roundId: number,
  rank: number
): Promise<boolean> {
  if (rank > 10) return false;

  const alreadyHas = await hasWordmark(fid, 'QUICKDRAW');
  if (alreadyHas) return false;

  return awardWordmark(fid, 'QUICKDRAW', { roundId, rank });
}

/**
 * Check and award PATRON wordmark
 * Awarded when user's referral wins a jackpot (user receives referrer payout)
 */
export async function checkAndAwardPatron(
  referrerFid: number,
  winnerFid: number,
  roundId: number
): Promise<boolean> {
  const alreadyHas = await hasWordmark(referrerFid, 'PATRON');
  if (alreadyHas) return false;

  return awardWordmark(referrerFid, 'PATRON', { roundId, winnerFid });
}

/**
 * Check and award DOUBLE_W wordmark
 * Awarded when user hits two bonus words OR bonus word + secret word in same round
 */
export async function checkAndAwardDoubleW(
  fid: number,
  roundId: number,
  bonusWordsFound: number,
  foundSecretWord: boolean
): Promise<boolean> {
  // Double W: 2+ bonus words OR (1+ bonus word AND secret word)
  const qualifies = bonusWordsFound >= 2 || (bonusWordsFound >= 1 && foundSecretWord);

  if (!qualifies) return false;

  const alreadyHas = await hasWordmark(fid, 'DOUBLE_W');
  if (alreadyHas) return false;

  const awarded = await awardWordmark(fid, 'DOUBLE_W', {
    roundId,
    bonusWordsFound,
    foundSecretWord,
  });

  // Announce the wordmark earned (fire and forget)
  if (awarded) {
    import('./announcer').then(({ announceWordmarkEarned }) => {
      announceWordmarkEarned(fid, 'DOUBLE_W', roundId).catch(err => {
        console.error('[wordmarks] Failed to announce Double Dub wordmark:', err);
      });
    });
  }

  return awarded;
}

/**
 * Get count of earned wordmarks for a user
 */
export async function getEarnedWordmarkCount(fid: number): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userBadges)
    .where(eq(userBadges.fid, fid));

  return result[0]?.count ?? 0;
}

/**
 * Check and award ENCYCLOPEDIC wordmark
 * Awarded when user has guessed words starting with every letter A-Z
 */
export async function checkAndAwardEncyclopedic(fid: number): Promise<boolean> {
  const alreadyHas = await hasWordmark(fid, 'ENCYCLOPEDIC');
  if (alreadyHas) return false;

  // Get distinct first letters from all guesses by this user
  const result = await db.execute<{ letter_count: number }>(sql`
    SELECT COUNT(DISTINCT UPPER(LEFT(word, 1))) as letter_count
    FROM guesses
    WHERE fid = ${fid}
    AND word ~ '^[A-Za-z]'
  `);

  const letterCount = result[0]?.letter_count ?? 0;

  // Need all 26 letters
  if (letterCount < 26) return false;

  const awarded = await awardWordmark(fid, 'ENCYCLOPEDIC', { letterCount: 26 });

  // Announce the wordmark earned (fire and forget)
  if (awarded) {
    import('./announcer').then(({ announceWordmarkEarned }) => {
      announceWordmarkEarned(fid, 'ENCYCLOPEDIC').catch(err => {
        console.error('[wordmarks] Failed to announce Encyclopedic wordmark:', err);
      });
    });
  }

  return awarded;
}

// =============================================================================
// Baker's Dozen Wordmark
// =============================================================================

/**
 * Calculate the day key for Baker's Dozen tracking
 * Uses the same 11:00 UTC day boundary as the rest of the app
 *
 * @param timestamp - Unix timestamp in milliseconds (default: now)
 * @returns Day key as integer (floor((timestamp - 11*3600*1000) / 86400000))
 */
export function getBakersDozenDayKey(timestamp?: number): number {
  const ts = timestamp ?? Date.now();
  // Shift by 11 hours to align with 11:00 UTC day boundary
  const shifted = ts - (11 * 60 * 60 * 1000);
  return Math.floor(shifted / (24 * 60 * 60 * 1000));
}

/**
 * Convert a letter (A-Z) to its bit position (0-25)
 */
function letterToBit(letter: string): number | null {
  const upper = letter.toUpperCase();
  const code = upper.charCodeAt(0);
  if (code >= 65 && code <= 90) { // A=65, Z=90
    return code - 65;
  }
  return null;
}

/**
 * Count the number of distinct letters in a bitmask
 */
function countLettersInMask(mask: number): number {
  let count = 0;
  let m = mask;
  while (m > 0) {
    count += m & 1;
    m >>>= 1;
  }
  return count;
}

/**
 * Get or create Baker's Dozen progress for a user
 */
async function getOrCreateBakersDozenProgress(fid: number): Promise<BakersDozenProgressRow> {
  const [existing] = await db
    .select()
    .from(bakersDozenProgress)
    .where(eq(bakersDozenProgress.fid, fid))
    .limit(1);

  if (existing) {
    return existing;
  }

  // Create new progress row
  const [created] = await db
    .insert(bakersDozenProgress)
    .values({ fid })
    .onConflictDoNothing()
    .returning();

  // Handle race condition - if another request created it, fetch it
  if (!created) {
    const [fetched] = await db
      .select()
      .from(bakersDozenProgress)
      .where(eq(bakersDozenProgress.fid, fid))
      .limit(1);
    return fetched;
  }

  return created;
}

/**
 * Get Baker's Dozen progress for a user (for display in Stats)
 */
export async function getBakersDozenProgress(fid: number): Promise<{
  distinctDays: number;
  distinctLetters: number;
  letterMask: number;
  isComplete: boolean;
}> {
  const progress = await getOrCreateBakersDozenProgress(fid);
  const distinctLetters = countLettersInMask(progress.letterMask);

  return {
    distinctDays: progress.distinctDays,
    distinctLetters,
    letterMask: progress.letterMask,
    isComplete: progress.distinctDays >= 13 && distinctLetters >= 13,
  };
}

/**
 * Process a guess for Baker's Dozen progress
 * Should be called on the FIRST valid guess of each day
 *
 * @param fid - User's Farcaster ID
 * @param word - The guessed word
 * @param timestamp - Timestamp of the guess (default: now)
 * @returns Object with progress update info
 */
export async function processBakersDozenGuess(
  fid: number,
  word: string,
  timestamp?: number
): Promise<{
  isFirstGuessOfDay: boolean;
  letterEarned: string | null;
  newLetterAdded: boolean;
  dayConsumed: boolean;
  awarded: boolean;
  progress: { distinctDays: number; distinctLetters: number };
}> {
  const dayKey = getBakersDozenDayKey(timestamp);
  const progress = await getOrCreateBakersDozenProgress(fid);

  // Check if this day was already processed
  if (progress.lastDayKey !== null && progress.lastDayKey >= dayKey) {
    // Not the first guess of the day - no progress update
    return {
      isFirstGuessOfDay: false,
      letterEarned: null,
      newLetterAdded: false,
      dayConsumed: false,
      awarded: false,
      progress: {
        distinctDays: progress.distinctDays,
        distinctLetters: countLettersInMask(progress.letterMask),
      },
    };
  }

  // This IS the first guess of the day
  const firstLetter = word.charAt(0).toUpperCase();
  const bitPos = letterToBit(firstLetter);

  // Ignore non A-Z letters
  if (bitPos === null) {
    // Still mark the day as processed to prevent later guesses from counting
    await db
      .update(bakersDozenProgress)
      .set({
        lastDayKey: dayKey,
        updatedAt: new Date(),
      })
      .where(eq(bakersDozenProgress.fid, fid));

    return {
      isFirstGuessOfDay: true,
      letterEarned: null,
      newLetterAdded: false,
      dayConsumed: false, // Non A-Z doesn't count as a day
      awarded: false,
      progress: {
        distinctDays: progress.distinctDays,
        distinctLetters: countLettersInMask(progress.letterMask),
      },
    };
  }

  // Check if this letter is already earned
  const letterAlreadyEarned = (progress.letterMask & (1 << bitPos)) !== 0;
  let newLetterMask = progress.letterMask;
  let newDistinctDays = progress.distinctDays + 1; // Always increment day count

  if (!letterAlreadyEarned) {
    // Add the new letter to the mask
    newLetterMask = progress.letterMask | (1 << bitPos);
  }

  // Update progress
  await db
    .update(bakersDozenProgress)
    .set({
      letterMask: newLetterMask,
      distinctDays: newDistinctDays,
      lastDayKey: dayKey,
      updatedAt: new Date(),
    })
    .where(eq(bakersDozenProgress.fid, fid));

  const newDistinctLetters = countLettersInMask(newLetterMask);

  // Check if user now qualifies for the wordmark
  let awarded = false;
  if (newDistinctDays >= 13 && newDistinctLetters >= 13) {
    const alreadyHas = await hasWordmark(fid, 'BAKERS_DOZEN');
    if (!alreadyHas) {
      awarded = await awardWordmark(fid, 'BAKERS_DOZEN', {
        distinctDays: newDistinctDays,
        distinctLetters: newDistinctLetters,
        finalLetter: firstLetter,
      });
      if (awarded) {
        console.log(`🍩 Awarded BAKERS_DOZEN to FID ${fid}: ${newDistinctDays} days, ${newDistinctLetters} letters`);
      }
    }
  }

  return {
    isFirstGuessOfDay: true,
    letterEarned: firstLetter,
    newLetterAdded: !letterAlreadyEarned,
    dayConsumed: true,
    awarded,
    progress: {
      distinctDays: newDistinctDays,
      distinctLetters: newDistinctLetters,
    },
  };
}

/**
 * Check and award Baker's Dozen wordmark
 * This is a simpler check that can be called independently
 * (e.g., for backfilling or manual checks)
 */
export async function checkAndAwardBakersDozen(fid: number): Promise<boolean> {
  const alreadyHas = await hasWordmark(fid, 'BAKERS_DOZEN');
  if (alreadyHas) return false;

  const progress = await getBakersDozenProgress(fid);

  if (progress.distinctDays >= 13 && progress.distinctLetters >= 13) {
    const awarded = await awardWordmark(fid, 'BAKERS_DOZEN', {
      distinctDays: progress.distinctDays,
      distinctLetters: progress.distinctLetters,
    });

    // Announce the wordmark earned (fire and forget)
    if (awarded) {
      import('./announcer').then(({ announceWordmarkEarned }) => {
        announceWordmarkEarned(fid, 'BAKERS_DOZEN').catch(err => {
          console.error('[wordmarks] Failed to announce Baker\'s Dozen wordmark:', err);
        });
      });
    }

    return awarded;
  }

  return false;
}

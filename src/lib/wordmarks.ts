/**
 * Wordmarks Library
 * Handles wordmark definitions, awarding, and fetching
 *
 * Wordmarks are permanent achievements earned by playing Let's Have A Word
 */

import { db, userBadges } from '../db';
import { eq, and, sql } from 'drizzle-orm';
import type { WordmarkType } from '../db/schema';

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
    name: 'Bonus Word Finder',
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
    name: 'Double W',
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

  return awardWordmark(fid, 'DOUBLE_W', {
    roundId,
    bonusWordsFound,
    foundSecretWord,
  });
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

/**
 * Wheel & Visual State
 * Milestone 2.3
 *
 * Implements:
 * - Seed word initialization per round
 * - Wheel word retrieval (seeds + wrong guesses)
 * - Round status (prize pool + global guess count)
 * - Top ticker data
 */

import { db } from '../db';
import { roundSeedWords, guesses, rounds } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { SEED_WORDS } from '../data/seed-words';
import { getActiveRound, ensureActiveRound } from './rounds';
import type { RoundSeedWordInsert } from '../db/schema';

/**
 * Round Status - displayed in top ticker
 */
export interface RoundStatus {
  roundId: number;
  prizePoolEth: string; // Decimal as string
  prizePoolUsd?: string; // Optional USD conversion
  globalGuessCount: number; // Total guesses for this round
}

/**
 * ETH to USD conversion rate (placeholder for Milestone 2.3)
 * In production, this would come from an oracle or price feed
 */
const ETH_USD_RATE = 3000;

/**
 * Populate seed words for a round
 *
 * Selects a random subset of SEED_WORDS and inserts them into round_seed_words.
 * These act as cosmetic "fake guesses" to pre-populate the wheel.
 *
 * @param roundId - The round to populate
 * @param count - Number of seed words to select (default: 30)
 */
export async function populateRoundSeedWords(
  roundId: number,
  count: number = 30
): Promise<void> {
  // Check if already populated
  const existing = await db
    .select()
    .from(roundSeedWords)
    .where(eq(roundSeedWords.roundId, roundId))
    .limit(1);

  if (existing.length > 0) {
    console.log(`⚠️  Round ${roundId} already has seed words, skipping population`);
    return;
  }

  // Select random seed words
  // Shuffle SEED_WORDS and take first N
  const shuffled = [...SEED_WORDS].sort(() => Math.random() - 0.5);
  const selectedWords = shuffled.slice(0, Math.min(count, SEED_WORDS.length));

  // Insert into database
  const seedWordInserts: RoundSeedWordInsert[] = selectedWords.map((word) => ({
    roundId,
    word: word.toUpperCase(),
  }));

  if (seedWordInserts.length > 0) {
    await db.insert(roundSeedWords).values(seedWordInserts);
    console.log(`✅ Populated ${seedWordInserts.length} seed words for round ${roundId}`);
  }
}

/**
 * Get wheel words for a round
 *
 * Returns the union of:
 * - Seed words for this round (from round_seed_words)
 * - Wrong guesses for this round (from guesses where is_correct = false)
 *
 * Result is sorted alphabetically.
 *
 * @param roundId - The round to get words for
 * @returns Sorted array of words to display in the wheel
 */
export async function getWheelWordsForRound(roundId: number): Promise<string[]> {
  // Get seed words
  const seedWordsData = await db
    .select({ word: roundSeedWords.word })
    .from(roundSeedWords)
    .where(eq(roundSeedWords.roundId, roundId));

  const seedWordSet = new Set(seedWordsData.map((row) => row.word));

  // Get wrong guesses (distinct)
  const wrongGuessesData = await db
    .select({ word: guesses.word })
    .from(guesses)
    .where(and(eq(guesses.roundId, roundId), eq(guesses.isCorrect, false)));

  const wrongGuessSet = new Set(wrongGuessesData.map((row) => row.word));

  // Union of both sets
  const allWords = new Set([...seedWordSet, ...wrongGuessSet]);

  // Convert to sorted array
  const sortedWords = Array.from(allWords).sort();

  return sortedWords;
}

/**
 * Get global guess count for a round
 *
 * Counts all guesses (correct + incorrect) for this round.
 * Does NOT include seed words (they're not real guesses).
 *
 * @param roundId - The round to count guesses for
 * @returns Total number of guesses
 */
export async function getGlobalGuessCount(roundId: number): Promise<number> {
  const result = await db
    .select({ count: guesses.id })
    .from(guesses)
    .where(eq(guesses.roundId, roundId));

  return result.length;
}

/**
 * Get round status (for top ticker)
 *
 * Returns:
 * - Current prize pool (in ETH)
 * - Approximate USD value
 * - Global guess count
 *
 * @param roundId - The round to get status for
 * @returns Round status object
 */
export async function getRoundStatus(roundId: number): Promise<RoundStatus> {
  // Get round data
  const [round] = await db
    .select()
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .limit(1);

  if (!round) {
    throw new Error(`Round ${roundId} not found`);
  }

  // Get global guess count
  const globalGuessCount = await getGlobalGuessCount(roundId);

  // Convert prize pool to USD
  const prizePoolEthNum = parseFloat(round.prizePoolEth);
  const prizePoolUsd = (prizePoolEthNum * ETH_USD_RATE).toFixed(2);

  return {
    roundId: round.id,
    prizePoolEth: round.prizePoolEth,
    prizePoolUsd,
    globalGuessCount,
  };
}

/**
 * Get active round status (for top ticker)
 *
 * Returns status for the currently active round.
 * Automatically creates a round if none exists.
 *
 * @returns Active round status
 */
export async function getActiveRoundStatus(): Promise<RoundStatus> {
  const activeRound = await ensureActiveRound();
  return getRoundStatus(activeRound.id);
}

/**
 * Get wheel data for active round
 *
 * Convenience function that returns wheel words for the active round.
 * Automatically creates a round if none exists.
 *
 * @returns Object with roundId and sorted wheel words
 */
export async function getActiveWheelData(): Promise<{
  roundId: number;
  words: string[];
}> {
  const activeRound = await ensureActiveRound();
  const words = await getWheelWordsForRound(activeRound.id);

  return {
    roundId: activeRound.id,
    words,
  };
}

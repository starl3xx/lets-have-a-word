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
 * Milestone 3.2: Polished with live data and USD conversion
 */
export interface RoundStatus {
  roundId: number;
  prizePoolEth: string; // Decimal as string
  prizePoolUsd?: string; // Optional USD conversion
  globalGuessCount: number; // Total guesses for this round
  lastUpdatedAt: string; // ISO timestamp when status was computed
}

/**
 * Get ETH to USD conversion rate
 * Milestone 3.2: Configurable via environment variable
 *
 * For now uses a placeholder rate. In production, this would:
 * - Query CoinGecko or onchain oracle
 * - Cache the result for a reasonable duration
 *
 * @returns Current ETH/USD rate
 */
export function getEthUsdRate(): number {
  const envRate = process.env.ETH_USD_RATE;
  if (envRate) {
    const parsed = parseFloat(envRate);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  // Default placeholder rate
  return 3000;
}

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
  try {
    console.log(`[populateRoundSeedWords] Starting for round ${roundId}, count: ${count}`);

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

    console.log(`[populateRoundSeedWords] No existing seed words, creating new ones...`);
    console.log(`[populateRoundSeedWords] Available SEED_WORDS: ${SEED_WORDS.length}`);

    // Select random seed words
    // Shuffle SEED_WORDS and take first N
    const shuffled = [...SEED_WORDS].sort(() => Math.random() - 0.5);
    const selectedWords = shuffled.slice(0, Math.min(count, SEED_WORDS.length));

    console.log(`[populateRoundSeedWords] Selected ${selectedWords.length} words`);
    console.log(`[populateRoundSeedWords] First 5 words: ${selectedWords.slice(0, 5).join(', ')}`);

    // Insert into database
    const seedWordInserts: RoundSeedWordInsert[] = selectedWords.map((word) => ({
      roundId,
      word: word.toUpperCase(),
    }));

    if (seedWordInserts.length > 0) {
      console.log(`[populateRoundSeedWords] Inserting ${seedWordInserts.length} seed words into database...`);
      await db.insert(roundSeedWords).values(seedWordInserts);
      console.log(`✅ Populated ${seedWordInserts.length} seed words for round ${roundId}`);
    }
  } catch (error) {
    console.error(`❌ Error populating seed words for round ${roundId}:`, error);
    throw error;
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
  console.log(`[getWheelWordsForRound] Fetching wheel words for round ${roundId}`);

  // Get seed words
  const seedWordsData = await db
    .select({ word: roundSeedWords.word })
    .from(roundSeedWords)
    .where(eq(roundSeedWords.roundId, roundId));

  console.log(`[getWheelWordsForRound] Found ${seedWordsData.length} seed words`);

  const seedWordSet = new Set(seedWordsData.map((row) => row.word));

  // Get wrong guesses (distinct)
  const wrongGuessesData = await db
    .select({ word: guesses.word })
    .from(guesses)
    .where(and(eq(guesses.roundId, roundId), eq(guesses.isCorrect, false)));

  console.log(`[getWheelWordsForRound] Found ${wrongGuessesData.length} wrong guesses`);

  const wrongGuessSet = new Set(wrongGuessesData.map((row) => row.word));

  // Union of both sets
  const allWords = new Set([...seedWordSet, ...wrongGuessSet]);

  // Convert to sorted array
  const sortedWords = Array.from(allWords).sort();

  console.log(`[getWheelWordsForRound] Returning ${sortedWords.length} total words`);
  if (sortedWords.length > 0) {
    console.log(`[getWheelWordsForRound] First 5 words: ${sortedWords.slice(0, 5).join(', ')}`);
  }

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
 * Milestone 3.2: Returns live, correct data for the top ticker
 *
 * Returns:
 * - Current prize pool (in ETH)
 * - Approximate USD value (using configurable rate)
 * - Global guess count (total guesses, not seed words)
 * - Timestamp when computed
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

  // Convert prize pool to USD using configurable rate
  const prizePoolEthNum = parseFloat(round.prizePoolEth);
  const ethUsdRate = getEthUsdRate();
  const prizePoolUsd = (prizePoolEthNum * ethUsdRate).toFixed(2);

  return {
    roundId: round.id,
    prizePoolEth: round.prizePoolEth,
    prizePoolUsd,
    globalGuessCount,
    lastUpdatedAt: new Date().toISOString(),
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
  console.log(`[getActiveWheelData] Getting active wheel data...`);
  const activeRound = await ensureActiveRound();
  console.log(`[getActiveWheelData] Active round ID: ${activeRound.id}`);

  const words = await getWheelWordsForRound(activeRound.id);

  console.log(`[getActiveWheelData] Returning ${words.length} words for round ${activeRound.id}`);

  return {
    roundId: activeRound.id,
    words,
  };
}

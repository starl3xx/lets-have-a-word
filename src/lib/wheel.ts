/**
 * Wheel & Visual State
 * Milestone 2.3, updated for Milestone 4.10
 *
 * Implements:
 * - Global wheel with all GUESS_WORDS
 * - Per-word status derivation (unguessed/wrong/winner)
 * - Round status (prize pool + global guess count)
 * - Top ticker data
 */

import { db } from '../db';
import { guesses, rounds } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { getGuessWords } from './word-lists';
import { getActiveRound, ensureActiveRound } from './rounds';
import type { WheelWord, WheelWordStatus, WheelResponse } from '../types';

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
 * Get wheel words with status for a round
 * Milestone 4.10: Returns all GUESS_WORDS with derived status
 *
 * Status derivation:
 * - "winner" if word was correctly guessed (exists in guesses with isCorrect = true)
 * - "wrong" if word exists in wrong guesses for this round
 * - "unguessed" for all other words (INCLUDING the answer if not yet guessed!)
 *
 * CRITICAL: Never reveal the answer by marking it as 'winner' before it's guessed!
 *
 * @param roundId - The round to get words for
 * @returns Array of WheelWord objects with status
 */
export async function getWheelWordsForRound(roundId: number): Promise<WheelWord[]> {
  console.log(`[getWheelWordsForRound] Fetching wheel words for round ${roundId}`);

  // Get all guessable words (these form the complete wheel)
  const allGuessWords = getGuessWords();
  console.log(`[getWheelWordsForRound] Total GUESS_WORDS: ${allGuessWords.length}`);

  // Get all guesses for this round (both correct and incorrect)
  const allGuessesData = await db
    .select({ word: guesses.word, isCorrect: guesses.isCorrect })
    .from(guesses)
    .where(eq(guesses.roundId, roundId));

  // Build sets for O(1) lookup
  const wrongGuessSet = new Set<string>();
  let winnerWord: string | null = null;

  for (const guess of allGuessesData) {
    if (guess.isCorrect) {
      winnerWord = guess.word.toUpperCase();
    } else {
      wrongGuessSet.add(guess.word.toUpperCase());
    }
  }

  console.log(`[getWheelWordsForRound] Found ${wrongGuessSet.size} wrong guesses`);
  console.log(`[getWheelWordsForRound] Winner word: ${winnerWord || 'none yet'}`);

  // Derive status for each word
  // CRITICAL: Only mark as 'winner' if it was ACTUALLY GUESSED correctly
  const wheelWords: WheelWord[] = allGuessWords.map((word) => {
    const upperWord = word.toUpperCase();
    let status: WheelWordStatus = 'unguessed';

    if (winnerWord && upperWord === winnerWord) {
      // Word was correctly guessed → show as winner
      status = 'winner';
    } else if (wrongGuessSet.has(upperWord)) {
      // Word was guessed but wrong → show as wrong
      status = 'wrong';
    }
    // Otherwise stays 'unguessed' (even if it's the answer!)

    return {
      word: upperWord,
      status,
    };
  });

  // Sort alphabetically by word
  wheelWords.sort((a, b) => a.word.localeCompare(b.word));

  console.log(`[getWheelWordsForRound] Returning ${wheelWords.length} words with statuses`);
  const statusCounts = wheelWords.reduce((acc, w) => {
    acc[w.status] = (acc[w.status] || 0) + 1;
    return acc;
  }, {} as Record<WheelWordStatus, number>);
  console.log(`[getWheelWordsForRound] Status breakdown:`, statusCounts);

  return wheelWords;
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
 * Milestone 4.10: Returns WheelResponse with word statuses
 *
 * Convenience function that returns wheel words for the active round.
 * Automatically creates a round if none exists.
 *
 * @returns WheelResponse with roundId, totalWords, and words with statuses
 */
export async function getActiveWheelData(): Promise<WheelResponse> {
  console.log(`[getActiveWheelData] Getting active wheel data...`);
  const activeRound = await ensureActiveRound();
  console.log(`[getActiveWheelData] Active round ID: ${activeRound.id}`);

  const words = await getWheelWordsForRound(activeRound.id);

  console.log(`[getActiveWheelData] Returning ${words.length} words for round ${activeRound.id}`);

  return {
    roundId: activeRound.id,
    totalWords: words.length,
    words,
  };
}

/**
 * Populate round with seed words
 *
 * @deprecated Milestone 4.11: This function is deprecated and does nothing
 * SEED_WORDS are no longer used. The wheel displays all GUESS_WORDS from the start.
 * Kept for backwards compatibility with existing imports only.
 *
 * @param roundId - Round ID (ignored)
 * @param count - Number of seed words (ignored)
 */
export async function populateRoundSeedWords(
  roundId: number,
  count: number = 30
): Promise<void> {
  console.log(`[populateRoundSeedWords] DEPRECATED: No-op, SEED_WORDS no longer used (Milestone 4.11)`);
  // No-op: SEED_WORDS are deprecated
  return;
}

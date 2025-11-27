import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../src/db';
import { guesses, rounds } from '../../../src/db/schema';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { isDevModeEnabled, getDevFixedSolution, getDevModeSeededWrongWords } from '../../../src/lib/devGameState';
import { getGuessWords } from '../../../src/lib/word-lists';

/**
 * Wrong Guesses Response
 * Lightweight payload for polling updates
 */
export interface WrongGuessesResponse {
  roundId: number;
  count: number; // Total wrong guesses - client can skip processing if unchanged
  wrongGuesses: string[]; // Just the words, uppercase
}

/**
 * GET /api/wheel/wrong-guesses
 *
 * Lightweight endpoint for polling wrong guess updates.
 * Returns only the list of incorrectly guessed words for the current round.
 *
 * Milestone 6.7.1: Added for 60-second polling to show other users' wrong guesses
 *
 * Response: ~2-15 KB vs ~300 KB for full wheel
 * {
 *   "roundId": 42,
 *   "count": 127,
 *   "wrongGuesses": ["BRAIN", "TRAIN", "CRANE", ...]
 * }
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WrongGuessesResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Both dev mode and production use real database queries
    // Dev mode needs real wrong guesses to stay in sync with actual submissions

    // Get active round (newest unresolved round)
    const [activeRound] = await db
      .select({ id: rounds.id })
      .from(rounds)
      .where(isNull(rounds.resolvedAt))
      .orderBy(desc(rounds.startedAt))
      .limit(1);

    const devMode = isDevModeEnabled();
    if (devMode) {
      console.log('🎮 Dev mode: Fetching real wrong guesses from DB + seeded wrong words');
    }

    if (!activeRound) {
      // In dev mode with no active round, still return seeded wrong words
      if (devMode) {
        const solution = getDevFixedSolution().toUpperCase();
        const allGuessWords = getGuessWords();
        const seededWrongWords = getDevModeSeededWrongWords(allGuessWords, solution);
        const seededArray = Array.from(seededWrongWords);
        console.log(`🎮 Dev mode: No active round, returning ${seededArray.length} seeded wrong words`);
        return res.status(200).json({
          roundId: 0,
          count: seededArray.length,
          wrongGuesses: seededArray,
        });
      }
      return res.status(200).json({
        roundId: 0,
        count: 0,
        wrongGuesses: [],
      });
    }

    // Get all wrong guesses for this round (simple, indexed query)
    const wrongGuessRows = await db
      .select({ word: guesses.word })
      .from(guesses)
      .where(
        and(
          eq(guesses.roundId, activeRound.id),
          eq(guesses.isCorrect, false)
        )
      );

    const realWrongGuesses = wrongGuessRows.map(row => row.word.toUpperCase());

    // In dev mode, merge seeded wrong words with real DB wrong guesses
    if (devMode) {
      const solution = getDevFixedSolution().toUpperCase();
      const allGuessWords = getGuessWords();
      const seededWrongWords = getDevModeSeededWrongWords(allGuessWords, solution);

      // Merge: use Set to avoid duplicates
      const mergedSet = new Set<string>(realWrongGuesses);
      seededWrongWords.forEach(word => mergedSet.add(word));
      const mergedArray = Array.from(mergedSet);

      console.log(`🎮 Dev mode: Merged ${realWrongGuesses.length} real + ${seededWrongWords.size} seeded = ${mergedArray.length} total wrong guesses`);

      return res.status(200).json({
        roundId: activeRound.id,
        count: mergedArray.length,
        wrongGuesses: mergedArray,
      });
    }

    return res.status(200).json({
      roundId: activeRound.id,
      count: realWrongGuesses.length,
      wrongGuesses: realWrongGuesses,
    });
  } catch (error: any) {
    console.error('Error in /api/wheel/wrong-guesses:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

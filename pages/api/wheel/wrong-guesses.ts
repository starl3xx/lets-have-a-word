import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../src/db';
import { guesses, rounds } from '../../../src/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { isDevModeEnabled, getDevFixedSolution } from '../../../src/lib/devGameState';
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
    // Dev mode: return synthetic wrong guesses
    if (isDevModeEnabled()) {
      const solution = getDevFixedSolution().toUpperCase();
      const allGuessWords = getGuessWords();

      // In dev mode, simulate ~20% wrong guesses (same as wheel.ts seeding)
      const seededCount = Math.floor(allGuessWords.length * 0.2);
      const wrongGuesses: string[] = [];

      // Use deterministic selection based on solution hash
      const hash = solution.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
      for (let i = 0; i < seededCount && i < allGuessWords.length; i++) {
        const word = allGuessWords[(hash + i * 7) % allGuessWords.length].toUpperCase();
        if (word !== solution && !wrongGuesses.includes(word)) {
          wrongGuesses.push(word);
        }
      }

      return res.status(200).json({
        roundId: 5,
        count: wrongGuesses.length,
        wrongGuesses,
      });
    }

    // Production: fetch from database
    // Get active round
    const [activeRound] = await db
      .select({ id: rounds.id })
      .from(rounds)
      .where(eq(rounds.status, 'active'))
      .orderBy(desc(rounds.id))
      .limit(1);

    if (!activeRound) {
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

    const wrongGuesses = wrongGuessRows.map(row => row.word.toUpperCase());

    return res.status(200).json({
      roundId: activeRound.id,
      count: wrongGuesses.length,
      wrongGuesses,
    });
  } catch (error: any) {
    console.error('Error in /api/wheel/wrong-guesses:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

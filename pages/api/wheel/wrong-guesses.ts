import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../src/db';
import { guesses, rounds } from '../../../src/db/schema';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { isDevModeEnabled } from '../../../src/lib/devGameState';

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

    if (isDevModeEnabled()) {
      console.log('🎮 Dev mode: Fetching real wrong guesses from DB');
    }

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

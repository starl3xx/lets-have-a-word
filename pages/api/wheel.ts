import type { NextApiRequest, NextApiResponse } from 'next';
import { getActiveWheelData } from '../../src/lib/wheel';
import { ensureDevMidRound } from '../../src/lib/devMidRound';
import { isDevModeEnabled, getDevFixedSolution } from '../../src/lib/devGameState';
import { getGuessWords } from '../../src/lib/word-lists';
import type { WheelResponse, WheelWord, WheelWordStatus } from '../../src/types';

/**
 * GET /api/wheel
 *
 * Returns the wheel words for the current active round
 * Milestone 2.3: Wheel + Visual State + Top Ticker
 * Milestone 4.8: Now supports dev mode with synthetic wheel data
 * Milestone 4.10: Returns all GUESS_WORDS with per-word status
 *
 * Response:
 * {
 *   "roundId": 1,
 *   "totalWords": 9000,
 *   "words": [
 *     { "word": "ABORT", "status": "wrong" },
 *     { "word": "ABOUT", "status": "unguessed" },
 *     { "word": "ACTOR", "status": "winner" },
 *     ...
 *   ]
 * }
 *
 * Status values:
 * - "unguessed": Word has not been guessed yet
 * - "wrong": Word was guessed incorrectly
 * - "winner": Word is the correct answer
 *
 * Dev mode query params:
 * - wrongGuesses: Comma-separated list of wrong guesses to include (e.g., "BRAIN,TRAIN")
 *
 * Automatically creates a round if none exists.
 * In dev mode with LHAW_DEV_MODE=true, returns synthetic data without database access.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WheelResponse | { error: string }>
) {
  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Milestone 4.8: Check for dev mode first
    if (isDevModeEnabled()) {
      console.log('🎮 Dev mode: Returning synthetic wheel words with statuses');

      const solution = getDevFixedSolution().toUpperCase();
      console.log(`🎮 Dev mode solution: ${solution}`);

      // Get all guess words to build the full wheel
      const allGuessWords = getGuessWords();

      // Parse wrong guesses from query param
      const wrongGuessesParam = req.query.wrongGuesses as string | undefined;
      const wrongGuessSet = new Set<string>();

      if (wrongGuessesParam) {
        const wrongGuesses = wrongGuessesParam
          .split(',')
          .map(w => w.trim().toUpperCase())
          .filter(w => w.length === 5 && w !== solution);

        wrongGuesses.forEach(guess => wrongGuessSet.add(guess));
        console.log(`🎮 Dev mode: Added ${wrongGuessSet.size} wrong guesses`);
      }

      // Build wheel words with statuses
      const wheelWords: WheelWord[] = allGuessWords.map((word) => {
        const upperWord = word.toUpperCase();
        let status: WheelWordStatus = 'unguessed';

        if (upperWord === solution) {
          status = 'winner';
        } else if (wrongGuessSet.has(upperWord)) {
          status = 'wrong';
        }

        return {
          word: upperWord,
          status,
        };
      });

      // Sort alphabetically
      wheelWords.sort((a, b) => a.word.localeCompare(b.word));

      return res.status(200).json({
        roundId: 999999,
        totalWords: wheelWords.length,
        words: wheelWords,
      });
    }

    // Production mode: fetch from database
    // Milestone 4.5: Ensure dev mid-round test mode is initialized (dev only, no-op in prod)
    await ensureDevMidRound();

    const wheelData = await getActiveWheelData();
    return res.status(200).json(wheelData);
  } catch (error: any) {
    console.error('Error in /api/wheel:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

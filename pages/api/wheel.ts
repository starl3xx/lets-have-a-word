import type { NextApiRequest, NextApiResponse } from 'next';
import { getActiveWheelData } from '../../src/lib/wheel';
import { ensureDevMidRound } from '../../src/lib/devMidRound';
import { isDevModeEnabled, getDevFixedSolution, getDevModeSeededWrongWords } from '../../src/lib/devGameState';
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
 * - "unguessed": Word has not been guessed yet (INCLUDING the answer!)
 * - "wrong": Word was guessed incorrectly
 * - "winner": Word was guessed correctly (ONLY after a correct guess!)
 *
 * CRITICAL: The answer is NEVER marked as "winner" until someone actually guesses it correctly.
 * This prevents the wheel from revealing the answer visually.
 *
 * Dev mode query params:
 * - wrongGuesses: Comma-separated list of wrong guesses to include (e.g., "BRAIN,TRAIN")
 * - showWinner: Set to "true" to test post-win state (marks answer as winner)
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
      console.log('🎮 Dev mode: Returning wheel words with real DB statuses');

      const solution = getDevFixedSolution().toUpperCase();
      console.log(`🎮 Dev mode solution: ${solution}`);

      // Get all guess words to build the full wheel
      const allGuessWords = getGuessWords();

      // IMPORTANT: In dev mode, we still need to fetch REAL wrong guesses from the database
      // This ensures the wheel reflects actual guesses made during the session
      const wheelData = await getActiveWheelData();

      // If we got real data, use it (this has actual wrong guesses from DB)
      if (wheelData.words && wheelData.words.length > 0) {
        console.log(`🎮 Dev mode: Using real wheel data with ${wheelData.words.filter(w => w.status === 'wrong').length} wrong guesses`);
        return res.status(200).json(wheelData);
      }

      // Fallback: Build synthetic wheel if no DB data available
      console.log('🎮 Dev mode: Falling back to synthetic wheel data');

      // Parse wrong guesses from query param
      const wrongGuessesParam = req.query.wrongGuesses as string | undefined;
      const wrongGuessSet = new Set<string>();

      if (wrongGuessesParam) {
        const wrongGuesses = wrongGuessesParam
          .split(',')
          .map(w => w.trim().toUpperCase())
          .filter(w => w.length === 5 && w !== solution);

        wrongGuesses.forEach(guess => wrongGuessSet.add(guess));
        console.log(`🎮 Dev mode: Added ${wrongGuessSet.size} wrong guesses from query param`);
      }

      // Milestone 4.14: Add seeded wrong words for dev mode (20% pre-population)
      const seededWrongWords = getDevModeSeededWrongWords(allGuessWords, solution);
      seededWrongWords.forEach(word => wrongGuessSet.add(word));

      // Check if we should show the winner (for testing post-win state)
      // CRITICAL: By default, do NOT reveal the answer!
      const showWinner = req.query.showWinner === 'true';
      if (showWinner) {
        console.log(`🎮 Dev mode: showWinner=true, will mark ${solution} as winner`);
      }

      // Build wheel words with statuses
      // CRITICAL: Only mark answer as 'winner' if showWinner=true (simulating post-win state)
      // Otherwise, answer stays 'unguessed' to avoid revealing it!
      const wheelWords: WheelWord[] = allGuessWords.map((word) => {
        const upperWord = word.toUpperCase();
        let status: WheelWordStatus = 'unguessed';

        if (upperWord === solution && showWinner) {
          // Only reveal winner if explicitly testing post-win state
          status = 'winner';
        } else if (wrongGuessSet.has(upperWord)) {
          status = 'wrong';
        }
        // Otherwise stays 'unguessed' (even if it's the answer!)

        return {
          word: upperWord,
          status,
        };
      });

      // Sort alphabetically
      wheelWords.sort((a, b) => a.word.localeCompare(b.word));

      return res.status(200).json({
        roundId: 5,
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

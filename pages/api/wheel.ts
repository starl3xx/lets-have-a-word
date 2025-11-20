import type { NextApiRequest, NextApiResponse } from 'next';
import { getActiveWheelData } from '../../src/lib/wheel';
import { ensureDevMidRound } from '../../src/lib/devMidRound';
import { isDevModeEnabled, getDevFixedSolution } from '../../src/lib/devGameState';

/**
 * GET /api/wheel
 *
 * Returns the wheel words for the current active round
 * Milestone 2.3: Wheel + Visual State + Top Ticker
 * Milestone 4.8: Now supports dev mode with synthetic wheel data
 *
 * Response:
 * {
 *   "roundId": 1,
 *   "words": ["ABORT", "ABOUT", "ACTOR", ...]
 * }
 *
 * Words are sorted alphabetically and include:
 * - Seed words (cosmetic pre-population)
 * - Wrong guesses from real players (production)
 * - Synthetic seed words (dev mode)
 *
 * Dev mode query params:
 * - wrongGuesses: Comma-separated list of wrong guesses to include (e.g., "BRAIN,TRAIN")
 *
 * Automatically creates a round if none exists.
 * In dev mode with LHAW_DEV_MODE=true, returns synthetic data without database access.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ roundId: number; words: string[] } | { error: string }>
) {
  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Milestone 4.8: Check for dev mode first
    if (isDevModeEnabled()) {
      console.log('🎮 Dev mode: Returning synthetic wheel words');

      const solution = getDevFixedSolution().toLowerCase();

      // Base seed words for the wheel (excluding the solution)
      let wheelWords = [
        'words',
        'games',
        'brain',
        'think',
        'smart',
        'plays',
        'solve',
        'logic',
        'build',
        'learn',
        'teach',
        'write',
        'speak',
        'guess',
        'answer',
        'puzzle',
        'riddle',
        'quest',
      ].filter(word => word !== solution);

      // Add wrong guesses from query param (for dev mode testing)
      const wrongGuessesParam = req.query.wrongGuesses as string | undefined;
      if (wrongGuessesParam) {
        const wrongGuesses = wrongGuessesParam
          .split(',')
          .map(w => w.trim().toLowerCase())
          .filter(w => w.length === 5 && w !== solution);

        // Add wrong guesses to wheel (avoid duplicates)
        wrongGuesses.forEach(guess => {
          if (!wheelWords.includes(guess)) {
            wheelWords.push(guess);
          }
        });

        console.log(`🎮 Dev mode: Added ${wrongGuesses.length} wrong guesses to wheel`);
      }

      return res.status(200).json({
        roundId: 999999,
        words: wheelWords.sort(), // Sort alphabetically
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

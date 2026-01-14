import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
import { getActiveWheelData } from '../../src/lib/wheel';
import { ensureDevMidRound } from '../../src/lib/devMidRound';
import { isDevModeEnabled, getDevFixedSolution, getDevModeSeededWrongWords } from '../../src/lib/devGameState';
import { getGuessWords } from '../../src/lib/word-lists';
import type { WheelResponse, WheelWord, WheelWordStatus } from '../../src/types';
import {
  cacheAside,
  CacheKeys,
  CacheTTL,
  checkRateLimit,
  RateLimiters,
} from '../../src/lib/redis';
import { getActiveRound } from '../../src/lib/rounds';

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
    // Milestone 9.0: Rate limiting (by IP)
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0] ||
      req.socket.remoteAddress ||
      'unknown';
    const rateCheck = await checkRateLimit(RateLimiters.general, `wheel:${clientIp}`);
    if (!rateCheck.success) {
      res.setHeader('X-RateLimit-Limit', rateCheck.limit?.toString() || '60');
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', rateCheck.reset?.toString() || '');
      return res.status(429).json({ error: 'Too many requests' });
    }

    // Milestone 4.8: Check for dev mode first
    if (isDevModeEnabled()) {
      console.log('🎮 Dev mode: Returning wheel words with real DB statuses + seeded wrong words');

      const solution = getDevFixedSolution().toUpperCase();
      console.log(`🎮 Dev mode solution: ${solution}`);

      // Get all guess words to build the full wheel
      const allGuessWords = getGuessWords();

      // IMPORTANT: In dev mode, fetch REAL wrong guesses from the database
      // This ensures the wheel reflects actual guesses made during the session
      const wheelData = await getActiveWheelData();

      // Generate seeded wrong words (20% of wheel for visual testing)
      const seededWrongWords = getDevModeSeededWrongWords(allGuessWords, solution);

      // If we got real data, MERGE seeded wrong words into it
      if (wheelData.words && wheelData.words.length > 0) {
        const realWrongCount = wheelData.words.filter(w => w.status === 'wrong').length;

        // Merge seeded wrong words: mark seeded words as 'wrong' if currently 'unguessed'
        const mergedWords = wheelData.words.map(w => {
          if (w.status === 'unguessed' && seededWrongWords.has(w.word)) {
            return { ...w, status: 'wrong' as WheelWordStatus };
          }
          return w;
        });

        const totalWrongCount = mergedWords.filter(w => w.status === 'wrong').length;
        console.log(`🎮 Dev mode: Merged ${realWrongCount} real + ${seededWrongWords.size} seeded = ${totalWrongCount} total wrong guesses`);

        return res.status(200).json({
          ...wheelData,
          words: mergedWords,
        });
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

    // Production mode: fetch from database with caching
    // Milestone 4.5: Ensure dev mid-round test mode is initialized (dev only, no-op in prod)
    await ensureDevMidRound();

    // Milestone 9.0: Get active round ID for cache key
    const activeRound = await getActiveRound();
    if (!activeRound) {
      // No active round - return all words as "unguessed"
      // This allows the wheel to display even between rounds
      const allGuessWords = getGuessWords();
      const wheelWords: WheelWord[] = allGuessWords.map((word) => ({
        word: word.toUpperCase(),
        status: 'unguessed' as WheelWordStatus,
      }));
      wheelWords.sort((a, b) => a.word.localeCompare(b.word));

      return res.status(200).json({
        roundId: 0, // Indicate no active round
        totalWords: wheelWords.length,
        words: wheelWords,
      });
    }

    // Use cache-aside pattern for wheel data
    // Cache is keyed by roundId, invalidated on every guess
    const wheelData = await cacheAside<WheelResponse>(
      CacheKeys.wheel(activeRound.id),
      CacheTTL.wheel,
      async () => {
        console.log(`[wheel] Cache miss, fetching from DB for round ${activeRound.id}`);
        return getActiveWheelData();
      }
    );

    // Set cache headers for client-side caching
    res.setHeader('Cache-Control', 'public, s-maxage=3, stale-while-revalidate=5');

    return res.status(200).json(wheelData);
  } catch (error: any) {
    console.error('Error in /api/wheel:', error);
    Sentry.captureException(error, {
      tags: { endpoint: 'wheel' },
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

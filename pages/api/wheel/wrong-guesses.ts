import type { NextApiRequest, NextApiResponse } from 'next';
import { isDevModeEnabled, getDevFixedSolution, getDevModeSeededWrongWords } from '../../../src/lib/devGameState';
import { getGuessWords } from '../../../src/lib/word-lists';
import { getWrongWordsForRound } from '../../../src/lib/guesses';
import { getActiveRoundId } from '../../../src/lib/rounds';
import { checkRateLimit, RateLimiters } from '../../../src/lib/redis';

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
    // Same rate limiter as /api/wheel — this endpoint is polled by every
    // open client and previously had no limit at all.
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0] ||
      req.socket.remoteAddress ||
      'unknown';
    const rateCheck = await checkRateLimit(RateLimiters.general, `wrong-guesses:${clientIp}`);
    if (!rateCheck.success) {
      res.setHeader('X-RateLimit-Limit', rateCheck.limit?.toString() || '60');
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', rateCheck.reset?.toString() || '');
      return res.status(429).json({ error: 'Too many requests' });
    }

    // Both dev mode and production use real database queries
    // Dev mode needs real wrong guesses to stay in sync with actual submissions

    // getActiveRoundId — the CANONICAL active-round definition, Redis-cached.
    // This endpoint used to run its own select filtered on resolvedAt alone,
    // which drifted from the canonical filter (no winner lock, no status, no
    // dev-test exclusion): during a winner-locked or cancelled round it kept
    // serving wrong guesses for a round /api/wheel no longer considered
    // active, so the two public endpoints disagreed. Divergence between
    // exactly these two responses has produced an answer disclosure before
    // (see the comment below); one definition, one source.
    const activeRoundId = await getActiveRoundId();

    const devMode = isDevModeEnabled();
    if (devMode) {
      console.log('🎮 Dev mode: Fetching real wrong guesses from DB + seeded wrong words');
    }

    if (activeRoundId === null) {
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
      res.setHeader('Cache-Control', 'public, s-maxage=3, stale-while-revalidate=5');
      return res.status(200).json({
        roundId: 0,
        count: 0,
        wrongGuesses: [],
      });
    }

    // Delegates to getWrongWordsForRound rather than running its own query.
    //
    // The query this replaces filtered on `is_correct = false` alone, which
    // silently excluded ineligible-winner rows — a correct guess by an account
    // that failed the sybil check, stored with is_correct = true and
    // is_ineligible_winner = true.
    //
    // That is an answer disclosure. getWheelWordsForRound marks those words
    // `wrong` on /api/wheel while this endpoint omitted them, so diffing two
    // public responses identified the answer: the word present in one and
    // absent from the other. The invariant it broke is spelled out in
    // guesses.ts — an ineligible winner must be observably indistinguishable
    // from an ordinary wrong guess, or the comparison leaks the word.
    //
    // Three call sites honoured that and this one did not, which is the
    // argument for calling the shared function instead of repeating its WHERE
    // clause a fourth time.
    const realWrongGuesses = (await getWrongWordsForRound(activeRoundId)).map((word) =>
      word.toUpperCase()
    );

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
        roundId: activeRoundId,
        count: mergedArray.length,
        wrongGuesses: mergedArray,
      });
    }

    // Global, answer-free public data (ineligible winners are already folded
    // into the wrong list by getWrongWordsForRound), polled by every open
    // client — the same edge-cache posture as /api/wheel. A shared CDN copy
    // can leak nothing per-user.
    res.setHeader('Cache-Control', 'public, s-maxage=3, stale-while-revalidate=5');

    return res.status(200).json({
      roundId: activeRoundId,
      count: realWrongGuesses.length,
      wrongGuesses: realWrongGuesses,
    });
  } catch (error: any) {
    console.error('Error in /api/wheel/wrong-guesses:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Top-10 Lock System
 * Milestone 7.x: Top-10 eligibility lock after fixed guess threshold
 *
 * Only the first N guesses in a round count toward Top-10 ranking.
 * After the threshold is reached, Top-10 is locked but users can still
 * guess and win the jackpot.
 *
 * History:
 * - Rounds 1-3: 750 guesses (legacy threshold)
 * - Round 4+: 850 guesses (updated Jan 2025)
 */

/**
 * Legacy threshold for rounds 1-3
 */
export const LEGACY_TOP10_LOCK = 750;

/**
 * New threshold for round 4 and onward
 */
export const NEW_TOP10_LOCK = 850;

/**
 * First round to use the new threshold
 */
export const TOP10_THRESHOLD_TRANSITION_ROUND = 4;

/**
 * Number of guesses after which Top-10 rankings are locked.
 * Guesses 1-850 are Top-10 eligible; guess 851+ are not.
 * NOTE: This is the current/default threshold for new rounds (4+).
 * For historical rounds 1-3, use getTop10LockForRound().
 */
export const TOP10_LOCK_AFTER_GUESSES = NEW_TOP10_LOCK;

/**
 * Get the Top-10 lock threshold for a specific round
 * @param roundId - The round ID/number
 * @returns The number of guesses that count toward Top-10 for that round
 */
export function getTop10LockForRound(roundId: number): number {
  if (roundId < TOP10_THRESHOLD_TRANSITION_ROUND) {
    return LEGACY_TOP10_LOCK; // 750 for rounds 1-3
  }
  return NEW_TOP10_LOCK; // 850 for round 4+
}

/**
 * Check if a guess is eligible for Top-10 ranking
 * @param guessIndexInRound - The 1-based index of the guess within the round
 * @param roundId - Optional round ID for historical accuracy (defaults to current threshold)
 * @returns true if the guess counts toward Top-10 ranking
 */
export function isTop10Eligible(guessIndexInRound: number, roundId?: number): boolean {
  const threshold = roundId !== undefined ? getTop10LockForRound(roundId) : TOP10_LOCK_AFTER_GUESSES;
  return guessIndexInRound <= threshold;
}

/**
 * Calculate Top-10 lock status for a round
 * @param totalGuessesInRound - Total number of guesses in the round
 * @param roundId - Optional round ID for historical accuracy (defaults to current threshold)
 * @returns Object with lock status and remaining guesses
 */
export function getTop10LockStatus(totalGuessesInRound: number, roundId?: number): {
  top10Locked: boolean;
  top10GuessesRemaining: number;
  top10LockAfterGuesses: number;
} {
  const threshold = roundId !== undefined ? getTop10LockForRound(roundId) : TOP10_LOCK_AFTER_GUESSES;
  const top10Locked = totalGuessesInRound >= threshold;
  const top10GuessesRemaining = Math.max(0, threshold - totalGuessesInRound);

  return {
    top10Locked,
    top10GuessesRemaining,
    top10LockAfterGuesses: threshold,
  };
}

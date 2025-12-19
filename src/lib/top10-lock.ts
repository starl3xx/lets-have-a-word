/**
 * Top-10 Lock System
 * Milestone 7.x: Top-10 eligibility lock after fixed guess threshold
 *
 * Only the first N guesses in a round count toward Top-10 ranking.
 * After the threshold is reached, Top-10 is locked but users can still
 * guess and win the jackpot.
 */

/**
 * Number of guesses after which Top-10 rankings are locked.
 * Guesses 1-750 are Top-10 eligible; guess 751+ are not.
 */
export const TOP10_LOCK_AFTER_GUESSES = 750;

/**
 * Check if a guess is eligible for Top-10 ranking
 * @param guessIndexInRound - The 1-based index of the guess within the round
 * @returns true if the guess counts toward Top-10 ranking
 */
export function isTop10Eligible(guessIndexInRound: number): boolean {
  return guessIndexInRound <= TOP10_LOCK_AFTER_GUESSES;
}

/**
 * Calculate Top-10 lock status for a round
 * @param totalGuessesInRound - Total number of guesses in the round
 * @returns Object with lock status and remaining guesses
 */
export function getTop10LockStatus(totalGuessesInRound: number): {
  top10Locked: boolean;
  top10GuessesRemaining: number;
  top10LockAfterGuesses: number;
} {
  const top10Locked = totalGuessesInRound >= TOP10_LOCK_AFTER_GUESSES;
  const top10GuessesRemaining = Math.max(0, TOP10_LOCK_AFTER_GUESSES - totalGuessesInRound);

  return {
    top10Locked,
    top10GuessesRemaining,
    top10LockAfterGuesses: TOP10_LOCK_AFTER_GUESSES,
  };
}

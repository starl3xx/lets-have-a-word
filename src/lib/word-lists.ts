/**
 * Word Lists Module
 *
 * Milestone 7.1: Single Master Wordlist Architecture
 *
 * This module provides access to the unified word list used for:
 * - Secret word selection
 * - Guess validation
 * - Wheel display
 *
 * Performance: Uses Set for O(1) lookup instead of O(n) includes()
 */

import { randomInt } from 'crypto';
import { WORDS, WORDS_THROUGH_ROUND_35, ROUND_36_ADDITIONS } from '../data/guess_words_clean';
import { isValidGuess } from './word-validation';
import type { WordLists } from '../types';

// isValidGuess lives in word-validation.ts (crypto-free, client-safe) and is
// re-exported here so server-side callers keep their import path. Client code
// must import it from word-validation directly: importing THIS module pulls
// the 'crypto' import above, and with it ~100 KB gz of browser polyfill.
export { isValidGuess };

/**
 * Get all valid words (unified list)
 * Milestone 7.1: Returns the single master word list
 *
 * This list is used for:
 * - Secret word selection (answer candidates)
 * - Guess validation
 * - Wheel display
 */
export function getGuessWords(): string[] {
  return [...WORDS];
}

/**
 * Get answer words (same as guess words in unified architecture)
 * Milestone 7.1: Secret words come from the same master list
 *
 * @deprecated Use getGuessWords() - both are now identical
 */
export function getAnswerWords(): string[] {
  return [...WORDS];
}

/**
 * Get all word lists
 * Milestone 7.1: Both lists are now the same unified list
 */
export function getWordLists(): WordLists {
  return {
    answerWords: getAnswerWords(),
    guessWords: getGuessWords(),
  };
}

/**
 * Check if a word is a valid answer candidate
 * Milestone 7.1: Same as isValidGuess (unified list)
 * Uses Set for O(1) lookup instead of O(n) includes()
 */
export function isValidAnswer(word: string): boolean {
  return isValidGuess(word);
}

/**
 * Validate word list constraints
 * Milestone 7.1: Simplified validation for unified list
 *
 * Requirements:
 * 1. No duplicates in WORDS
 * 2. All words are exactly 5 letters
 * 3. All words are UPPERCASE
 *
 * @throws Error if constraints are violated
 */
export function validateWordLists(): void {
  const errors: string[] = [];

  // Check for duplicates
  const wordsSet = new Set(WORDS);
  if (wordsSet.size !== WORDS.length) {
    errors.push(`WORDS contains ${WORDS.length - wordsSet.size} duplicate(s)`);
  }

  // Check word format
  const invalidWords = WORDS.filter(word => !/^[A-Z]{5}$/.test(word));
  if (invalidWords.length > 0) {
    errors.push(
      `${invalidWords.length} words have invalid format: ` +
      invalidWords.slice(0, 5).join(', ') +
      (invalidWords.length > 5 ? '...' : '')
    );
  }

  // The expansion must be additive. A word that vanished from WORDS while
  // still sitting in the legacy list would un-play itself mid-history, and a
  // duplicate between the two would inflate every count that reads length.
  const missing = WORDS_THROUGH_ROUND_35.filter(w => !wordsSet.has(w));
  if (missing.length > 0) {
    errors.push(
      `${missing.length} word(s) in WORDS_THROUGH_ROUND_35 are absent from WORDS: ` +
      missing.slice(0, 5).join(', ')
    );
  }

  const legacySet = new Set(WORDS_THROUGH_ROUND_35);
  const readded = ROUND_36_ADDITIONS.filter(w => legacySet.has(w));
  if (readded.length > 0) {
    errors.push(
      `${readded.length} ROUND_36_ADDITIONS were already playable before round 36: ` +
      readded.slice(0, 5).join(', ')
    );
  }

  // Throw if any errors found
  if (errors.length > 0) {
    throw new Error(
      'Word list validation failed:\n' + errors.map(e => `  - ${e}`).join('\n')
    );
  }

  // Log success
  console.log('✅ Word list validation passed (Milestone 7.1):');
  console.log(`   - WORDS: ${WORDS.length} words (round 36+)`);
  console.log(`   - WORDS_THROUGH_ROUND_35: ${WORDS_THROUGH_ROUND_35.length} words`);
  console.log(`   - ROUND_36_ADDITIONS: ${ROUND_36_ADDITIONS.length} words`);
  console.log(`   - Single unified list for all game operations`);
  console.log(`   - No duplicates, all valid format`);
}

/**
 * Get a random answer word
 * Milestone 7.1: Uses unified WORDS list
 *
 * Uses crypto.randomInt() for cryptographically secure random selection,
 * ensuring the word choice cannot be predicted even with knowledge of
 * the algorithm and timing.
 */
export function getRandomAnswerWord(): string {
  const index = randomInt(WORDS.length);
  return WORDS[index];
}

/**
 * Select multiple unique random words for bonus words
 * Bonus Words Feature: Selects 10 unique words excluding the secret word
 *
 * Uses crypto.randomInt() for cryptographically secure random selection.
 * Guarantees no duplicates and excludes specified words.
 *
 * @param count Number of bonus words to select (default 10)
 * @param excludeWords Words to exclude (e.g., the secret word)
 * @returns Array of unique bonus words
 */
export function selectBonusWords(
  count: number = 10,
  excludeWords: string[] = []
): string[] {
  const excludeSet = new Set(excludeWords.map(w => w.toUpperCase()));
  const available = WORDS.filter(w => !excludeSet.has(w));

  if (available.length < count) {
    throw new Error(
      `Not enough words available: need ${count}, but only ${available.length} after exclusions`
    );
  }

  const selected: string[] = [];
  const usedIndices = new Set<number>();

  while (selected.length < count) {
    const index = randomInt(available.length);
    if (!usedIndices.has(index)) {
      usedIndices.add(index);
      selected.push(available[index]);
    }
  }

  return selected;
}

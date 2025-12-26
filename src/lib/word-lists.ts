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
import { WORDS } from '../data/guess_words_clean';
import type { WordLists } from '../types';

/**
 * Pre-compute Set for O(1) lookup instead of O(n) includes()
 * CRITICAL: Using includes() on ~4000 words blocks input rendering!
 *
 * This Set is created once at module load time for optimal performance.
 */
const WORDS_SET = new Set(WORDS);

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
 * Check if a word is a valid guess
 * Canonical list is UPPERCASE, so we normalize input to UPPERCASE
 * Uses Set for O(1) lookup instead of O(n) includes()
 */
export function isValidGuess(word: string): boolean {
  const normalized = word.toUpperCase().trim();
  return WORDS_SET.has(normalized);
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

  // Throw if any errors found
  if (errors.length > 0) {
    throw new Error(
      'Word list validation failed:\n' + errors.map(e => `  - ${e}`).join('\n')
    );
  }

  // Log success
  console.log('✅ Word list validation passed (Milestone 7.1):');
  console.log(`   - WORDS: ${WORDS.length} words`);
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

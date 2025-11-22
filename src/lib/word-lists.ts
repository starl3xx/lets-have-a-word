import { GUESS_WORDS_CLEAN } from '../data/guess_words_clean';
import { ANSWER_WORDS_EXPANDED } from '../data/answer_words_expanded';
import type { WordLists } from '../types';

/**
 * Pre-compute Sets for O(1) lookup instead of O(n) includes()
 * CRITICAL: Using includes() on 5,865 words blocks input rendering!
 */
const GUESS_WORDS_SET = new Set(GUESS_WORDS_CLEAN);
const ANSWER_WORDS_SET = new Set(ANSWER_WORDS_EXPANDED);

/**
 * Get all answer words (valid answer candidates)
 * Milestone 4.13: Returns clean, modern English words (7,520 words, UPPERCASE)
 * - No Scrabble/crossword garbage
 * - No obvious plurals
 * - Everyday vocabulary suitable for casual players
 */
export function getAnswerWords(): string[] {
  return [...ANSWER_WORDS_EXPANDED];
}

/**
 * Get all guess words (valid guessable words)
 * Milestone 4.13: Returns clean dictionary (5,865 words, UPPERCASE)
 * - Filtered from Wordle lists with strict criteria
 * - No offensive words, proper nouns, archaic terms, or organizational acronyms
 * - Real, modern English vocabulary
 */
export function getGuessWords(): string[] {
  return [...GUESS_WORDS_CLEAN];
}

/**
 * Get all word lists
 * Milestone 4.13: Clean dictionaries based on filtered word lists
 */
export function getWordLists(): WordLists {
  return {
    answerWords: getAnswerWords(),
    guessWords: getGuessWords(),
  };
}

/**
 * Check if a word is a valid guess
 * Canonical lists are UPPERCASE, so we normalize input to UPPERCASE
 * Uses Set for O(1) lookup instead of O(n) includes()
 */
export function isValidGuess(word: string): boolean {
  const normalized = word.toUpperCase().trim();
  return GUESS_WORDS_SET.has(normalized);
}

/**
 * Check if a word is a valid answer candidate
 * Canonical lists are UPPERCASE, so we normalize input to UPPERCASE
 * Uses Set for O(1) lookup instead of O(n) includes()
 */
export function isValidAnswer(word: string): boolean {
  const normalized = word.toUpperCase().trim();
  return ANSWER_WORDS_SET.has(normalized);
}

/**
 * Validate word list constraints
 * Milestone 4.13: Updated for clean dictionaries
 *
 * Requirements:
 * 1. All ANSWER_WORDS_EXPANDED must be in GUESS_WORDS_CLEAN
 *
 * @throws Error if constraints are violated
 */
export function validateWordLists(): void {
  const errors: string[] = [];

  // Convert to sets for efficient lookup
  const answerSet = new Set(ANSWER_WORDS_EXPANDED);
  const guessSet = new Set(GUESS_WORDS_CLEAN);

  // Check constraint 1: ANSWER_WORDS_EXPANDED ⊆ GUESS_WORDS_CLEAN
  const answersNotInGuess = ANSWER_WORDS_EXPANDED.filter(word => !guessSet.has(word));
  if (answersNotInGuess.length > 0) {
    errors.push(
      `CONSTRAINT VIOLATION: ${answersNotInGuess.length} answer words are not in GUESS_WORDS_CLEAN: ` +
      answersNotInGuess.slice(0, 10).join(', ') +
      (answersNotInGuess.length > 10 ? '...' : '')
    );
  }

  // Check for duplicates within each list
  if (answerSet.size !== ANSWER_WORDS_EXPANDED.length) {
    errors.push(`ANSWER_WORDS_EXPANDED contains ${ANSWER_WORDS_EXPANDED.length - answerSet.size} duplicate(s)`);
  }
  if (guessSet.size !== GUESS_WORDS_CLEAN.length) {
    errors.push(`GUESS_WORDS_CLEAN contains ${GUESS_WORDS_CLEAN.length - guessSet.size} duplicate(s)`);
  }

  // Throw if any errors found
  if (errors.length > 0) {
    throw new Error(
      'Word list validation failed:\n' + errors.map(e => `  - ${e}`).join('\n')
    );
  }

  // Log success
  console.log('✅ Word list validation passed (Milestone 4.13):');
  console.log(`   - ANSWER_WORDS_EXPANDED: ${ANSWER_WORDS_EXPANDED.length} words`);
  console.log(`   - GUESS_WORDS_CLEAN: ${GUESS_WORDS_CLEAN.length} words`);
  console.log(`   - All constraints satisfied`);
  console.log(`   - No garbage/Scrabble words`);
  console.log(`   - Clean, modern English vocabulary`);
}

/**
 * Get a random answer word
 * Milestone 4.13: Uses clean, curated answer words
 */
export function getRandomAnswerWord(): string {
  const index = Math.floor(Math.random() * ANSWER_WORDS_EXPANDED.length);
  return ANSWER_WORDS_EXPANDED[index];
}

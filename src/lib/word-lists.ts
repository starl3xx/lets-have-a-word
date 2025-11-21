import { ANSWER_WORDS, GUESS_WORDS } from '../data/test-word-lists';
import type { WordLists } from '../types';

/**
 * Get all answer words (valid answer candidates)
 */
export function getAnswerWords(): string[] {
  return [...ANSWER_WORDS];
}

/**
 * Get all guess words (valid guessable words)
 */
export function getGuessWords(): string[] {
  return [...GUESS_WORDS];
}

/**
 * Get all word lists
 * Milestone 4.10: Removed SEED_WORDS from model
 */
export function getWordLists(): WordLists {
  return {
    answerWords: getAnswerWords(),
    guessWords: getGuessWords(),
  };
}

/**
 * Check if a word is a valid guess
 */
export function isValidGuess(word: string): boolean {
  const normalized = word.toLowerCase().trim();
  return GUESS_WORDS.includes(normalized);
}

/**
 * Check if a word is a valid answer candidate
 */
export function isValidAnswer(word: string): boolean {
  const normalized = word.toLowerCase().trim();
  return ANSWER_WORDS.includes(normalized);
}

/**
 * Validate word list constraints
 * Milestone 4.10: Updated to remove SEED_WORDS validation
 *
 * Requirements:
 * 1. All ANSWER_WORDS must be in GUESS_WORDS
 *
 * @throws Error if constraints are violated
 */
export function validateWordLists(): void {
  const errors: string[] = [];

  // Convert to sets for efficient lookup
  const answerSet = new Set(ANSWER_WORDS);
  const guessSet = new Set(GUESS_WORDS);

  // Check constraint 1: ANSWER_WORDS ⊆ GUESS_WORDS
  const answersNotInGuess = ANSWER_WORDS.filter(word => !guessSet.has(word));
  if (answersNotInGuess.length > 0) {
    errors.push(
      `CONSTRAINT VIOLATION: ${answersNotInGuess.length} answer words are not in GUESS_WORDS: ` +
      answersNotInGuess.slice(0, 10).join(', ') +
      (answersNotInGuess.length > 10 ? '...' : '')
    );
  }

  // Check for duplicates within each list
  if (answerSet.size !== ANSWER_WORDS.length) {
    errors.push(`ANSWER_WORDS contains ${ANSWER_WORDS.length - answerSet.size} duplicate(s)`);
  }
  if (guessSet.size !== GUESS_WORDS.length) {
    errors.push(`GUESS_WORDS contains ${GUESS_WORDS.length - guessSet.size} duplicate(s)`);
  }

  // Throw if any errors found
  if (errors.length > 0) {
    throw new Error(
      'Word list validation failed:\n' + errors.map(e => `  - ${e}`).join('\n')
    );
  }

  // Log success
  console.log('✅ Word list validation passed:');
  console.log(`   - ANSWER_WORDS: ${ANSWER_WORDS.length} words`);
  console.log(`   - GUESS_WORDS: ${GUESS_WORDS.length} words`);
  console.log(`   - All constraints satisfied`);
}

/**
 * Get a random answer word
 */
export function getRandomAnswerWord(): string {
  const index = Math.floor(Math.random() * ANSWER_WORDS.length);
  return ANSWER_WORDS[index];
}

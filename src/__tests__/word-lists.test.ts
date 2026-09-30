import { describe, it, expect } from 'vitest';
import {
  getAnswerWords,
  getGuessWords,
  isValidGuess,
  isValidAnswer,
  validateWordLists,
} from '../lib/word-lists';
import {
  WORDS,
  ROUND_36_ADDITIONS,
  BANNED_GUESSES,
} from '../data/guess_words_clean';

describe('Word Lists - Milestone 4.13', () => {
  it('should load answer words (clean dictionaries)', () => {
    const words = getAnswerWords();
    expect(words).toBeDefined();
    expect(words.length).toBeGreaterThan(0);
    expect(words.every(w => w.length === 5)).toBe(true);
    expect(words.every(w => /^[A-Z]{5}$/.test(w))).toBe(true);
  });

  it('should load guess words (clean dictionaries)', () => {
    const words = getGuessWords();
    expect(words).toBeDefined();
    expect(words.length).toBeGreaterThan(0);
    expect(words.every(w => w.length === 5)).toBe(true);
    expect(words.every(w => /^[A-Z]{5}$/.test(w))).toBe(true);
  });

  it('should validate that answer words are subset of guess words', () => {
    const answerWords = getAnswerWords();
    const guessWords = new Set(getGuessWords());

    for (const word of answerWords) {
      expect(guessWords.has(word)).toBe(true);
    }
  });

  it('should not contain known garbage Scrabble words', () => {
    const guessWords = new Set(getGuessWords());
    const answerWords = new Set(getAnswerWords());

    // Verify no garbage words
    const garbageWords = ['AALII', 'AARGH', 'XYSTI', 'YEXED', 'ABACA', 'ABAFT'];

    for (const garbage of garbageWords) {
      expect(guessWords.has(garbage)).toBe(false);
      expect(answerWords.has(garbage)).toBe(false);
    }
  });

  it('should validate word lists without errors', () => {
    expect(() => validateWordLists()).not.toThrow();
  });

  it('should correctly validate guesses', () => {
    expect(isValidGuess('brain')).toBe(true);
    expect(isValidGuess('about')).toBe(true);
    expect(isValidGuess('xyzab')).toBe(false);
    expect(isValidGuess('notaword')).toBe(false);
  });

  it('should correctly validate answers', () => {
    expect(isValidAnswer('brain')).toBe(true);
    expect(isValidAnswer('about')).toBe(true);
    // Garbage words should NOT be valid answers
    expect(isValidAnswer('aalii')).toBe(false);
    expect(isValidAnswer('xysti')).toBe(false);
  });
});

/**
 * The words added from round 36.
 *
 * Rounds 1-35 played with 4,438 words. From round 36, WORDS is the only list,
 * so every addition is a valid guess and a possible answer.
 */
describe('round 36 word list additions', () => {
  it('adds 146 distinct words', () => {
    expect(ROUND_36_ADDITIONS).toHaveLength(146);
    expect(new Set(ROUND_36_ADDITIONS).size).toBe(146);
  });

  it('keeps every word 5 uppercase letters and none of them banned', () => {
    expect(ROUND_36_ADDITIONS.every(w => /^[A-Z]{5}$/.test(w))).toBe(true);
    const banned = ROUND_36_ADDITIONS.filter(w => BANNED_GUESSES.includes(w));
    expect(banned, `banned words in the additions: ${banned.join(', ')}`).toEqual([]);
  });

  it('makes WORDS the canonical 4,584, additions included', () => {
    expect(WORDS).toHaveLength(4584);
    expect(getGuessWords()).toHaveLength(4584);
    const missing = ROUND_36_ADDITIONS.filter(w => !isValidGuess(w) || !isValidAnswer(w));
    expect(missing, `additions not playable: ${missing.join(', ')}`).toEqual([]);
  });
});

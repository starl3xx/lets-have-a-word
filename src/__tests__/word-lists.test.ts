import { describe, it, expect } from 'vitest';
import {
  getAnswerWords,
  getGuessWords,
  isValidGuess,
  isValidAnswer,
  validateWordLists,
} from '../lib/word-lists';

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

import { describe, it, expect } from 'vitest';
import {
  getAnswerWords,
  getGuessWords,
  getSeedWords,
  isValidGuess,
  isValidAnswer,
  validateWordLists,
} from '../lib/word-lists';

describe('Word Lists', () => {
  it('should load answer words', () => {
    const words = getAnswerWords();
    expect(words).toBeDefined();
    expect(words.length).toBeGreaterThan(0);
    expect(words.every(w => w.length === 5)).toBe(true);
  });

  it('should load guess words', () => {
    const words = getGuessWords();
    expect(words).toBeDefined();
    expect(words.length).toBeGreaterThan(0);
    expect(words.every(w => w.length === 5)).toBe(true);
  });

  it('should load seed words', () => {
    const words = getSeedWords();
    expect(words).toBeDefined();
    expect(words.length).toBeGreaterThan(0);
    expect(words.every(w => w.length === 5)).toBe(true);
  });

  it('should validate that answer words are subset of guess words', () => {
    const answerWords = getAnswerWords();
    const guessWords = new Set(getGuessWords());

    for (const word of answerWords) {
      expect(guessWords.has(word)).toBe(true);
    }
  });

  it('should validate that seed words do not overlap with answer words', () => {
    const answerWords = new Set(getAnswerWords());
    const seedWords = getSeedWords();

    for (const word of seedWords) {
      expect(answerWords.has(word)).toBe(false);
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
    // Seed words should NOT be valid answers
    expect(isValidAnswer('aahed')).toBe(false);
  });
});

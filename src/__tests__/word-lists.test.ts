import { describe, it, expect } from 'vitest';
import {
  getAnswerWords,
  getGuessWords,
  isValidGuess,
  isValidAnswer,
  validateWordLists,
} from '../lib/word-lists';
import {
  isValidGuessForRound,
  getWordsForRound,
  WORD_LIST_EXPANSION_ROUND,
} from '../lib/word-validation';
import {
  WORDS,
  WORDS_THROUGH_ROUND_35,
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
 * The round-36 expansion.
 *
 * Round 35 was live when these landed, and its answer, bonus words and burn
 * words were committed onchain from the smaller list. A new word can never be
 * round 35's answer, so letting one through would have put impossible words
 * on that round's wheel and let a player spend a paid guess on one.
 */
describe('round 36 word list expansion', () => {
  it('adds 146 words, all of them genuinely new', () => {
    expect(ROUND_36_ADDITIONS).toHaveLength(146);
    expect(new Set(ROUND_36_ADDITIONS).size).toBe(146);

    const legacy = new Set(WORDS_THROUGH_ROUND_35);
    const alreadyThere = ROUND_36_ADDITIONS.filter(w => legacy.has(w));
    expect(alreadyThere, `already playable before round 36: ${alreadyThere.join(', ')}`).toEqual([]);
  });

  it('keeps every word 5 uppercase letters and none of them banned', () => {
    expect(ROUND_36_ADDITIONS.every(w => /^[A-Z]{5}$/.test(w))).toBe(true);
    const banned = ROUND_36_ADDITIONS.filter(w => BANNED_GUESSES.includes(w));
    expect(banned, `banned words in the additions: ${banned.join(', ')}`).toEqual([]);
  });

  it('is purely additive: 4,438 becomes 4,584 and nothing is lost', () => {
    expect(WORDS_THROUGH_ROUND_35).toHaveLength(4438);
    expect(WORDS).toHaveLength(4584);
    const current = new Set(WORDS);
    expect(WORDS_THROUGH_ROUND_35.every(w => current.has(w))).toBe(true);
  });

  it('refuses a new word in round 35 and accepts it in round 36', () => {
    // ABBOT is in the additions; BRAIN was always playable.
    expect(isValidGuessForRound('ABBOT', 35)).toBe(false);
    expect(isValidGuessForRound('ABBOT', WORD_LIST_EXPANSION_ROUND)).toBe(true);
    expect(isValidGuessForRound('ABBOT', 99)).toBe(true);

    expect(isValidGuessForRound('BRAIN', 35)).toBe(true);
    expect(isValidGuessForRound('BRAIN', 36)).toBe(true);
  });

  it('normalises case the same way in both eras', () => {
    expect(isValidGuessForRound('abbot', 36)).toBe(true);
    expect(isValidGuessForRound('  Abbot  ', 36)).toBe(true);
    expect(isValidGuessForRound('abbot', 35)).toBe(false);
  });

  it('rejects a non-word in every round', () => {
    expect(isValidGuessForRound('xyzab', 35)).toBe(false);
    expect(isValidGuessForRound('xyzab', 36)).toBe(false);
  });

  it('serves the wheel a round-sized list', () => {
    expect(getWordsForRound(35)).toHaveLength(4438);
    expect(getWordsForRound(36)).toHaveLength(4584);
    expect(getWordsForRound(35)).not.toContain('ABBOT');
    expect(getWordsForRound(36)).toContain('ABBOT');
  });

  it('leaves answer selection on the current list, because every new round is 36+', () => {
    // createRound refuses while a round is active, so the next round created
    // is 36 or later and its answer may come from the additions.
    expect(isValidAnswer('ABBOT')).toBe(true);
    expect(isValidGuess('ABBOT')).toBe(true);
  });
});

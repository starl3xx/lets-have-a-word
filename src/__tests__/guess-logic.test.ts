import { describe, it, expect, beforeEach } from 'vitest';
import {
  submitGuess,
  getWrongWordsForRound,
  getGuessCountForUserInRound,
  getTopGuessersForRound,
} from '../lib/guesses';
import { createRound, getActiveRound, resolveRound } from '../lib/rounds';
import type { SubmitGuessParams } from '../types';

/**
 * Note: These tests require a running PostgreSQL database
 * Set DATABASE_URL in .env before running tests
 */

describe('Guess Logic - Milestone 1.3', () => {
  let testRoundId: number;
  let testAnswer: string;

  beforeEach(async () => {
    // Ensure no active round, then create a fresh test round
    const existingRound = await getActiveRound();
    if (existingRound) {
      await resolveRound(existingRound.id, 99999);
    }

    // Create a new round with a known answer
    testAnswer = 'crane';
    const round = await createRound({ forceAnswer: testAnswer });
    testRoundId = round.id;
  });

  describe('submitGuess() - Validation', () => {
    it('should reject non-5-letter words', async () => {
      const result = await submitGuess({
        fid: 1000,
        word: 'cat', // Too short
      });

      expect(result.status).toBe('invalid_word');
      if (result.status === 'invalid_word') {
        expect(result.reason).toBe('not_5_letters');
      }
    });

    it('should reject non-alphabetic words', async () => {
      const result = await submitGuess({
        fid: 1000,
        word: '12345', // Numbers
      });

      expect(result.status).toBe('invalid_word');
      if (result.status === 'invalid_word') {
        expect(result.reason).toBe('non_alpha');
      }
    });

    it('should reject words not in dictionary', async () => {
      const result = await submitGuess({
        fid: 1000,
        word: 'zzzzz', // Not a real word
      });

      expect(result.status).toBe('invalid_word');
      if (result.status === 'invalid_word') {
        expect(result.reason).toBe('not_in_dictionary');
      }
    });

    it('should normalize words to uppercase', async () => {
      const result = await submitGuess({
        fid: 1000,
        word: 'about', // Lowercase but valid
      });

      expect(result.status).toBe('incorrect');
      if (result.status === 'incorrect') {
        expect(result.word).toBe('ABOUT'); // Should be normalized
      }
    });
  });

  describe('submitGuess() - Incorrect Guesses', () => {
    it('should record an incorrect guess', async () => {
      const result = await submitGuess({
        fid: 1000,
        word: 'house',
      });

      expect(result.status).toBe('incorrect');
      if (result.status === 'incorrect') {
        expect(result.word).toBe('HOUSE');
        expect(result.totalGuessesForUserThisRound).toBe(1);
      }
    });

    it('should increment user guess count', async () => {
      await submitGuess({ fid: 1000, word: 'house' });
      await submitGuess({ fid: 1000, word: 'phone' });
      const result = await submitGuess({ fid: 1000, word: 'table' });

      expect(result.status).toBe('incorrect');
      if (result.status === 'incorrect') {
        expect(result.totalGuessesForUserThisRound).toBe(3);
      }
    });

    it('should prevent duplicate wrong guesses globally', async () => {
      // User 1000 guesses "house" (wrong)
      const result1 = await submitGuess({ fid: 1000, word: 'house' });
      expect(result1.status).toBe('incorrect');

      // User 2000 tries to guess "house" (should be blocked)
      const result2 = await submitGuess({ fid: 2000, word: 'house' });
      expect(result2.status).toBe('already_guessed_word');
      if (result2.status === 'already_guessed_word') {
        expect(result2.word).toBe('HOUSE');
      }
    });

    it('should handle case-insensitive duplicate detection', async () => {
      await submitGuess({ fid: 1000, word: 'house' });

      // Try with different casing
      const result = await submitGuess({ fid: 2000, word: 'HOUSE' });
      expect(result.status).toBe('already_guessed_word');
    });
  });

  describe('submitGuess() - Correct Guesses', () => {
    it('should accept correct guess and resolve round', async () => {
      const result = await submitGuess({
        fid: 5000,
        word: testAnswer, // 'crane'
      });

      expect(result.status).toBe('correct');
      if (result.status === 'correct') {
        expect(result.word).toBe(testAnswer.toUpperCase());
        expect(result.roundId).toBe(testRoundId);
        expect(result.winnerFid).toBe(5000);
      }

      // Verify round is resolved
      const round = await getActiveRound();
      expect(round).toBeNull(); // No active round anymore
    });

    it('should handle case-insensitive correct guesses', async () => {
      const result = await submitGuess({
        fid: 5000,
        word: 'CrAnE', // Mixed case
      });

      expect(result.status).toBe('correct');
    });

    it('should reject guesses after round is resolved', async () => {
      // First guess wins
      await submitGuess({ fid: 5000, word: testAnswer });

      // Second guess should be rejected
      const result = await submitGuess({ fid: 6000, word: 'house' });
      expect(result.status).toBe('round_closed');
    });
  });

  describe('submitGuess() - Paid vs Free', () => {
    it('should track isPaid flag', async () => {
      const freeResult = await submitGuess({
        fid: 1000,
        word: 'house',
        isPaidGuess: false,
      });

      expect(freeResult.status).toBe('incorrect');

      const paidResult = await submitGuess({
        fid: 1000,
        word: 'phone',
        isPaidGuess: true,
      });

      expect(paidResult.status).toBe('incorrect');

      // Both should count toward total
      const count = await getGuessCountForUserInRound(1000, testRoundId);
      expect(count).toBe(2);
    });
  });

  describe('getWrongWordsForRound()', () => {
    it('should return empty array for new round', async () => {
      const words = await getWrongWordsForRound(testRoundId);
      expect(words).toEqual([]);
    });

    it('should return all wrong guesses alphabetically', async () => {
      await submitGuess({ fid: 1000, word: 'zebra' });
      await submitGuess({ fid: 2000, word: 'apple' });
      await submitGuess({ fid: 3000, word: 'house' });

      const words = await getWrongWordsForRound(testRoundId);

      expect(words).toEqual(['APPLE', 'HOUSE', 'ZEBRA']);
    });

    it('should not include duplicate words', async () => {
      await submitGuess({ fid: 1000, word: 'house' });
      // Second user can't guess "house" again (global dedup)
      // So we manually check the list doesn't have dupes

      const words = await getWrongWordsForRound(testRoundId);
      const uniqueWords = [...new Set(words)];

      expect(words.length).toBe(uniqueWords.length);
    });

    it('should not include correct guess', async () => {
      await submitGuess({ fid: 1000, word: 'house' });
      await submitGuess({ fid: 2000, word: 'phone' });
      await submitGuess({ fid: 3000, word: testAnswer }); // Correct!

      const words = await getWrongWordsForRound(testRoundId);

      expect(words).toEqual(['HOUSE', 'PHONE']);
      expect(words).not.toContain(testAnswer.toUpperCase());
    });
  });

  describe('getGuessCountForUserInRound()', () => {
    it('should return 0 for user with no guesses', async () => {
      const count = await getGuessCountForUserInRound(9999, testRoundId);
      expect(count).toBe(0);
    });

    it('should count all guesses for a user', async () => {
      await submitGuess({ fid: 1000, word: 'house' });
      await submitGuess({ fid: 1000, word: 'phone' });
      await submitGuess({ fid: 1000, word: 'table' });

      const count = await getGuessCountForUserInRound(1000, testRoundId);
      expect(count).toBe(3);
    });

    it('should not count other users guesses', async () => {
      await submitGuess({ fid: 1000, word: 'house' });
      await submitGuess({ fid: 2000, word: 'phone' });

      const count1000 = await getGuessCountForUserInRound(1000, testRoundId);
      const count2000 = await getGuessCountForUserInRound(2000, testRoundId);

      expect(count1000).toBe(1);
      expect(count2000).toBe(1);
    });

    it('should count both free and paid guesses', async () => {
      await submitGuess({ fid: 1000, word: 'house', isPaidGuess: false });
      await submitGuess({ fid: 1000, word: 'phone', isPaidGuess: true });

      const count = await getGuessCountForUserInRound(1000, testRoundId);
      expect(count).toBe(2);
    });
  });

  describe('getTopGuessersForRound()', () => {
    it('should return empty array for round with no guesses', async () => {
      const top = await getTopGuessersForRound(testRoundId);
      expect(top).toEqual([]);
    });

    it('should rank users by guess count descending', async () => {
      // User 1000: 3 guesses
      await submitGuess({ fid: 1000, word: 'house' });
      await submitGuess({ fid: 1000, word: 'phone' });
      await submitGuess({ fid: 1000, word: 'table' });

      // User 2000: 1 guess
      await submitGuess({ fid: 2000, word: 'chair' });

      // User 3000: 2 guesses
      await submitGuess({ fid: 3000, word: 'light' });
      await submitGuess({ fid: 3000, word: 'bread' });

      const top = await getTopGuessersForRound(testRoundId, 10);

      expect(top.length).toBe(3);
      expect(top[0].fid).toBe(1000);
      expect(top[0].guessCount).toBe(3);
      expect(top[1].fid).toBe(3000);
      expect(top[1].guessCount).toBe(2);
      expect(top[2].fid).toBe(2000);
      expect(top[2].guessCount).toBe(1);
    });

    it('should use firstGuessAt as tiebreaker', async () => {
      // Both users make 2 guesses
      await submitGuess({ fid: 1000, word: 'house' });
      await new Promise(resolve => setTimeout(resolve, 10)); // Small delay
      await submitGuess({ fid: 2000, word: 'phone' });

      await submitGuess({ fid: 1000, word: 'table' });
      await submitGuess({ fid: 2000, word: 'chair' });

      const top = await getTopGuessersForRound(testRoundId, 10);

      expect(top.length).toBe(2);
      expect(top[0].guessCount).toBe(2);
      expect(top[1].guessCount).toBe(2);

      // User 1000 should be first (guessed earlier)
      expect(top[0].fid).toBe(1000);
      expect(top[1].fid).toBe(2000);
    });

    it('should respect limit parameter', async () => {
      // Create 5 users with guesses
      for (let i = 1; i <= 5; i++) {
        await submitGuess({ fid: 1000 + i, word: `word${i}` as any });
      }

      const top3 = await getTopGuessersForRound(testRoundId, 3);
      expect(top3.length).toBe(3);

      const top10 = await getTopGuessersForRound(testRoundId, 10);
      expect(top10.length).toBe(5); // Only 5 users actually guessed
    });

    it('should include firstGuessAt timestamp', async () => {
      const before = new Date();
      await submitGuess({ fid: 1000, word: 'house' });
      const after = new Date();

      const top = await getTopGuessersForRound(testRoundId, 10);

      expect(top.length).toBe(1);
      expect(top[0].firstGuessAt).toBeInstanceOf(Date);
      expect(top[0].firstGuessAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(top[0].firstGuessAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('Full Game Flow', () => {
    it('should handle complete game lifecycle', async () => {
      // Multiple users guess incorrectly
      await submitGuess({ fid: 1001, word: 'house' });
      await submitGuess({ fid: 1002, word: 'phone' });
      await submitGuess({ fid: 1001, word: 'table' }); // Second guess
      await submitGuess({ fid: 1003, word: 'chair' });

      // Check wrong words
      const wrongWords = await getWrongWordsForRound(testRoundId);
      expect(wrongWords).toContain('HOUSE');
      expect(wrongWords).toContain('PHONE');
      expect(wrongWords.length).toBe(4);

      // Check top guessers
      const topBefore = await getTopGuessersForRound(testRoundId, 10);
      expect(topBefore[0].fid).toBe(1001); // 2 guesses
      expect(topBefore[0].guessCount).toBe(2);

      // Winner guesses correctly
      const winResult = await submitGuess({ fid: 5000, word: testAnswer });
      expect(winResult.status).toBe('correct');

      // Verify round closed
      const afterRound = await getActiveRound();
      expect(afterRound).toBeNull();

      // Further guesses rejected
      const lateGuess = await submitGuess({ fid: 9999, word: 'apple' });
      expect(lateGuess.status).toBe('round_closed');
    });
  });
});

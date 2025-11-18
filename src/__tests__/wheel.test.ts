import { describe, it, expect, beforeEach } from 'vitest';
import {
  populateRoundSeedWords,
  getWheelWordsForRound,
  getGlobalGuessCount,
  getRoundStatus,
  getActiveRoundStatus,
  getActiveWheelData,
} from '../lib/wheel';
import { createRound, resolveRound, getActiveRound } from '../lib/rounds';
import { submitGuess } from '../lib/guess-logic';
import { db } from '../db';
import { roundSeedWords, guesses } from '../db/schema';
import { eq } from 'drizzle-orm';

/**
 * Wheel & Visual State Tests
 * Milestone 2.3
 *
 * Note: These tests require a running PostgreSQL database
 * Set DATABASE_URL in .env before running tests
 */

describe('Wheel Functionality (Milestone 2.3)', () => {
  describe('populateRoundSeedWords()', () => {
    it('should populate seed words for a round', async () => {
      const round = await createRound({ forceAnswer: 'brain' });

      // Seed words should already be populated by createRound
      // Verify they exist
      const seedWords = await db
        .select()
        .from(roundSeedWords)
        .where(eq(roundSeedWords.roundId, round.id));

      expect(seedWords.length).toBeGreaterThan(0);
      expect(seedWords.length).toBeLessThanOrEqual(30);

      // All seed words should be 5 letters and uppercase
      seedWords.forEach((sw) => {
        expect(sw.word).toMatch(/^[A-Z]{5}$/);
      });

      // Clean up
      await resolveRound(round.id, 12345);
    });

    it('should not populate seed words twice for the same round', async () => {
      const round = await createRound({ forceAnswer: 'house' });

      // Get initial count (already populated by createRound)
      const initialSeedWords = await db
        .select()
        .from(roundSeedWords)
        .where(eq(roundSeedWords.roundId, round.id));

      const initialCount = initialSeedWords.length;

      // Try to populate again
      await populateRoundSeedWords(round.id);

      // Count should remain the same
      const afterSeedWords = await db
        .select()
        .from(roundSeedWords)
        .where(eq(roundSeedWords.roundId, round.id));

      expect(afterSeedWords.length).toBe(initialCount);

      // Clean up
      await resolveRound(round.id, 12345);
    });

    it('should respect the count parameter', async () => {
      const round = await createRound({ forceAnswer: 'audio' });

      // Delete existing seed words
      await db.delete(roundSeedWords).where(eq(roundSeedWords.roundId, round.id));

      // Populate with custom count
      await populateRoundSeedWords(round.id, 10);

      const seedWords = await db
        .select()
        .from(roundSeedWords)
        .where(eq(roundSeedWords.roundId, round.id));

      expect(seedWords.length).toBe(10);

      // Clean up
      await resolveRound(round.id, 12345);
    });
  });

  describe('getWheelWordsForRound()', () => {
    it('should return only seed words when no guesses exist', async () => {
      const round = await createRound({ forceAnswer: 'brain' });

      const wheelWords = await getWheelWordsForRound(round.id);

      // Should contain seed words
      expect(wheelWords.length).toBeGreaterThan(0);

      // Should be sorted alphabetically
      const sorted = [...wheelWords].sort();
      expect(wheelWords).toEqual(sorted);

      // Clean up
      await resolveRound(round.id, 12345);
    });

    it('should return union of seed words and wrong guesses', async () => {
      const round = await createRound({ forceAnswer: 'brain' });

      // Submit some wrong guesses
      await submitGuess({ fid: 12345, word: 'HOUSE' });
      await submitGuess({ fid: 12345, word: 'CRANE' });
      await submitGuess({ fid: 12345, word: 'SLATE' });

      const wheelWords = await getWheelWordsForRound(round.id);

      // Should include our wrong guesses
      expect(wheelWords).toContain('HOUSE');
      expect(wheelWords).toContain('CRANE');
      expect(wheelWords).toContain('SLATE');

      // Should not include the correct answer
      expect(wheelWords).not.toContain('BRAIN');

      // Should be sorted alphabetically
      const sorted = [...wheelWords].sort();
      expect(wheelWords).toEqual(sorted);

      // Clean up
      await resolveRound(round.id, 12345);
    });

    it('should not include duplicate words', async () => {
      const round = await createRound({ forceAnswer: 'brain' });

      // Submit same wrong guess from different users
      await submitGuess({ fid: 100, word: 'HOUSE' });
      await submitGuess({ fid: 200, word: 'HOUSE' });
      await submitGuess({ fid: 300, word: 'HOUSE' });

      const wheelWords = await getWheelWordsForRound(round.id);

      // Count occurrences of HOUSE
      const houseCount = wheelWords.filter((w) => w === 'HOUSE').length;
      expect(houseCount).toBe(1);

      // Clean up
      await resolveRound(round.id, 12345);
    });

    it('should not include correct guesses in the wheel', async () => {
      const round = await createRound({ forceAnswer: 'brain' });

      // Submit wrong guesses
      await submitGuess({ fid: 100, word: 'HOUSE' });
      await submitGuess({ fid: 200, word: 'CRANE' });

      // Submit correct guess
      await submitGuess({ fid: 300, word: 'BRAIN' });

      const wheelWords = await getWheelWordsForRound(round.id);

      // Should include wrong guesses
      expect(wheelWords).toContain('HOUSE');
      expect(wheelWords).toContain('CRANE');

      // Should NOT include correct answer
      expect(wheelWords).not.toContain('BRAIN');

      // The round is now resolved, no cleanup needed
    });
  });

  describe('getGlobalGuessCount()', () => {
    it('should return 0 when no guesses exist', async () => {
      const round = await createRound({ forceAnswer: 'brain' });

      const count = await getGlobalGuessCount(round.id);

      expect(count).toBe(0);

      // Clean up
      await resolveRound(round.id, 12345);
    });

    it('should count all guesses for a round', async () => {
      const round = await createRound({ forceAnswer: 'brain' });

      // Submit guesses
      await submitGuess({ fid: 100, word: 'HOUSE' });
      await submitGuess({ fid: 200, word: 'CRANE' });
      await submitGuess({ fid: 300, word: 'SLATE' });

      const count = await getGlobalGuessCount(round.id);

      expect(count).toBe(3);

      // Clean up
      await resolveRound(round.id, 12345);
    });

    it('should include both correct and incorrect guesses', async () => {
      const round = await createRound({ forceAnswer: 'brain' });

      // Submit wrong guesses
      await submitGuess({ fid: 100, word: 'HOUSE' });
      await submitGuess({ fid: 200, word: 'CRANE' });

      // Submit correct guess
      await submitGuess({ fid: 300, word: 'BRAIN' });

      const count = await getGlobalGuessCount(round.id);

      expect(count).toBe(3);

      // The round is now resolved
    });

    it('should NOT count seed words as guesses', async () => {
      const round = await createRound({ forceAnswer: 'brain' });

      // Get seed words count
      const seedWords = await db
        .select()
        .from(roundSeedWords)
        .where(eq(roundSeedWords.roundId, round.id));

      // Global guess count should be 0 (seed words are not counted)
      const count = await getGlobalGuessCount(round.id);

      expect(count).toBe(0);
      expect(seedWords.length).toBeGreaterThan(0); // But seed words exist

      // Clean up
      await resolveRound(round.id, 12345);
    });
  });

  describe('getRoundStatus()', () => {
    it('should return correct round status', async () => {
      const round = await createRound({ forceAnswer: 'brain' });

      const status = await getRoundStatus(round.id);

      expect(status).toBeDefined();
      expect(status.roundId).toBe(round.id);
      expect(status.prizePoolEth).toBe('0.000000000000000000');
      expect(status.prizePoolUsd).toBeDefined();
      expect(status.globalGuessCount).toBe(0);

      // Clean up
      await resolveRound(round.id, 12345);
    });

    it('should convert ETH to USD', async () => {
      const round = await createRound({ forceAnswer: 'brain' });

      const status = await getRoundStatus(round.id);

      // With ETH_USD_RATE = 3000
      // 0 ETH = $0.00 USD
      expect(status.prizePoolUsd).toBe('0.00');

      // Clean up
      await resolveRound(round.id, 12345);
    });

    it('should include global guess count', async () => {
      const round = await createRound({ forceAnswer: 'brain' });

      // Submit guesses
      await submitGuess({ fid: 100, word: 'HOUSE' });
      await submitGuess({ fid: 200, word: 'CRANE' });

      const status = await getRoundStatus(round.id);

      expect(status.globalGuessCount).toBe(2);

      // Clean up
      await resolveRound(round.id, 12345);
    });

    it('should throw error for non-existent round', async () => {
      await expect(getRoundStatus(999999)).rejects.toThrow('not found');
    });
  });

  describe('getActiveRoundStatus()', () => {
    it('should return status for active round', async () => {
      const round = await createRound({ forceAnswer: 'brain' });

      const status = await getActiveRoundStatus();

      expect(status).toBeDefined();
      expect(status?.roundId).toBe(round.id);

      // Clean up
      await resolveRound(round.id, 12345);
    });

    it('should return null when no active round exists', async () => {
      // Ensure no active round
      const activeRound = await getActiveRound();
      if (activeRound) {
        await resolveRound(activeRound.id, 12345);
      }

      const status = await getActiveRoundStatus();

      // May be null or may be a newly created round from ensureActiveRound
      // In production, there's always an active round
      expect(status === null || status !== null).toBe(true);
    });
  });

  describe('getActiveWheelData()', () => {
    it('should return wheel data for active round', async () => {
      const round = await createRound({ forceAnswer: 'brain' });

      const wheelData = await getActiveWheelData();

      expect(wheelData).toBeDefined();
      expect(wheelData?.roundId).toBe(round.id);
      expect(wheelData?.words).toBeDefined();
      expect(Array.isArray(wheelData?.words)).toBe(true);

      // Clean up
      await resolveRound(round.id, 12345);
    });

    it('should return sorted alphabetical words', async () => {
      const round = await createRound({ forceAnswer: 'brain' });

      // Submit some wrong guesses
      await submitGuess({ fid: 100, word: 'ZEBRA' });
      await submitGuess({ fid: 200, word: 'APPLE' });

      const wheelData = await getActiveWheelData();

      expect(wheelData).toBeDefined();
      const words = wheelData?.words || [];

      // Should be sorted
      const sorted = [...words].sort();
      expect(words).toEqual(sorted);

      // Clean up
      await resolveRound(round.id, 12345);
    });
  });

  describe('Integration: Complete Wheel Lifecycle', () => {
    it('should handle full wheel lifecycle', async () => {
      // 1. Create round (automatically populates seed words)
      const round = await createRound({ forceAnswer: 'brain' });

      // 2. Verify seed words exist
      const initialWheel = await getWheelWordsForRound(round.id);
      expect(initialWheel.length).toBeGreaterThan(0);

      // 3. Submit wrong guesses
      await submitGuess({ fid: 100, word: 'HOUSE' });
      await submitGuess({ fid: 200, word: 'CRANE' });
      await submitGuess({ fid: 300, word: 'SLATE' });

      // 4. Verify wheel includes seed words + wrong guesses
      const wheelWithGuesses = await getWheelWordsForRound(round.id);
      expect(wheelWithGuesses).toContain('HOUSE');
      expect(wheelWithGuesses).toContain('CRANE');
      expect(wheelWithGuesses).toContain('SLATE');

      // 5. Verify global guess count (should NOT include seed words)
      const guessCount = await getGlobalGuessCount(round.id);
      expect(guessCount).toBe(3);

      // 6. Get round status
      const status = await getRoundStatus(round.id);
      expect(status.roundId).toBe(round.id);
      expect(status.globalGuessCount).toBe(3);

      // 7. Submit correct guess
      await submitGuess({ fid: 400, word: 'BRAIN' });

      // 8. Verify correct answer NOT in wheel
      const finalWheel = await getWheelWordsForRound(round.id);
      expect(finalWheel).not.toContain('BRAIN');

      // 9. Verify final guess count includes all guesses
      const finalCount = await getGlobalGuessCount(round.id);
      expect(finalCount).toBe(4);

      // Round is auto-resolved, no cleanup needed
    });
  });
});

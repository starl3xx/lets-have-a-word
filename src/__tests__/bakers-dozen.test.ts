import { describe, it, expect, beforeEach } from 'vitest';
import {
  getBakersDozenDayKey,
  processBakersDozenGuess,
  getBakersDozenProgress,
  checkAndAwardBakersDozen,
} from '../lib/wordmarks';
import { db, bakersDozenProgress, userBadges } from '../db';
import { eq } from 'drizzle-orm';

/**
 * Baker's Dozen Wordmark Tests
 *
 * Tests for the Baker's Dozen wordmark which is awarded when a user:
 * - Guesses words starting with 13 different letters
 * - Across 13 different days
 * - Only the FIRST guess of each day counts
 *
 * Day boundary: 11:00 UTC (same as app-wide reset)
 */

describe('Baker\'s Dozen Wordmark', () => {
  let testFid: number;

  beforeEach(async () => {
    // Use unique FID for each test to avoid conflicts
    testFid = Math.floor(Math.random() * 1000000) + 100000;

    // Clean up any existing data for this FID
    await db.delete(bakersDozenProgress).where(eq(bakersDozenProgress.fid, testFid));
    await db.delete(userBadges).where(eq(userBadges.fid, testFid));
  });

  describe('Day Key Calculation', () => {
    it('should calculate correct day key for noon UTC', () => {
      // Noon UTC is after the 11:00 UTC boundary, so it's the same day
      const noonUtc = new Date('2025-01-15T12:00:00Z').getTime();
      const key = getBakersDozenDayKey(noonUtc);
      expect(key).toBeGreaterThan(0);
    });

    it('should use 11:00 UTC as day boundary', () => {
      // 10:59 UTC should be previous day
      const before = new Date('2025-01-15T10:59:00Z').getTime();
      // 11:00 UTC should be next day
      const after = new Date('2025-01-15T11:00:00Z').getTime();

      const keyBefore = getBakersDozenDayKey(before);
      const keyAfter = getBakersDozenDayKey(after);

      expect(keyAfter).toBe(keyBefore + 1);
    });

    it('should return same key for times within same day', () => {
      // Both times are after 11:00 UTC on the same calendar day
      const time1 = new Date('2025-01-15T12:00:00Z').getTime();
      const time2 = new Date('2025-01-15T23:59:00Z').getTime();

      expect(getBakersDozenDayKey(time1)).toBe(getBakersDozenDayKey(time2));
    });

    it('should return different keys for consecutive days', () => {
      // Day 1: after 11:00 UTC
      const day1 = new Date('2025-01-15T12:00:00Z').getTime();
      // Day 2: after 11:00 UTC
      const day2 = new Date('2025-01-16T12:00:00Z').getTime();

      expect(getBakersDozenDayKey(day2)).toBe(getBakersDozenDayKey(day1) + 1);
    });
  });

  describe('First Guess of Day Detection', () => {
    it('should identify first guess of day correctly', async () => {
      const timestamp = new Date('2025-01-15T12:00:00Z').getTime();

      const result = await processBakersDozenGuess(testFid, 'apple', timestamp);

      expect(result.isFirstGuessOfDay).toBe(true);
      expect(result.letterEarned).toBe('A');
      expect(result.newLetterAdded).toBe(true);
      expect(result.dayConsumed).toBe(true);
    });

    it('should NOT count second guess on same day', async () => {
      const timestamp1 = new Date('2025-01-15T12:00:00Z').getTime();
      const timestamp2 = new Date('2025-01-15T14:00:00Z').getTime();

      // First guess
      await processBakersDozenGuess(testFid, 'apple', timestamp1);

      // Second guess same day
      const result = await processBakersDozenGuess(testFid, 'banana', timestamp2);

      expect(result.isFirstGuessOfDay).toBe(false);
      expect(result.letterEarned).toBeNull();
      expect(result.newLetterAdded).toBe(false);
      expect(result.dayConsumed).toBe(false);
    });

    it('should count first guess on different days', async () => {
      const day1 = new Date('2025-01-15T12:00:00Z').getTime();
      const day2 = new Date('2025-01-16T12:00:00Z').getTime();

      // Day 1
      const result1 = await processBakersDozenGuess(testFid, 'apple', day1);
      expect(result1.isFirstGuessOfDay).toBe(true);

      // Day 2
      const result2 = await processBakersDozenGuess(testFid, 'banana', day2);
      expect(result2.isFirstGuessOfDay).toBe(true);
    });
  });

  describe('Letter Tracking', () => {
    it('should track new letters correctly', async () => {
      const day1 = new Date('2025-01-15T12:00:00Z').getTime();

      const result = await processBakersDozenGuess(testFid, 'apple', day1);

      expect(result.letterEarned).toBe('A');
      expect(result.newLetterAdded).toBe(true);
      expect(result.progress.distinctLetters).toBe(1);
    });

    it('should NOT add duplicate letter on new day', async () => {
      const day1 = new Date('2025-01-15T12:00:00Z').getTime();
      const day2 = new Date('2025-01-16T12:00:00Z').getTime();

      // Day 1: guess word starting with 'A'
      await processBakersDozenGuess(testFid, 'apple', day1);

      // Day 2: guess word starting with 'A' again
      const result = await processBakersDozenGuess(testFid, 'arrow', day2);

      expect(result.isFirstGuessOfDay).toBe(true);
      expect(result.letterEarned).toBe('A');
      expect(result.newLetterAdded).toBe(false); // Already had 'A'
      expect(result.dayConsumed).toBe(true); // Day still counts
    });

    it('should normalize letter case', async () => {
      const day1 = new Date('2025-01-15T12:00:00Z').getTime();
      const day2 = new Date('2025-01-16T12:00:00Z').getTime();

      // Lowercase word
      await processBakersDozenGuess(testFid, 'apple', day1);

      // Uppercase word with same starting letter
      const result = await processBakersDozenGuess(testFid, 'ARROW', day2);

      expect(result.newLetterAdded).toBe(false); // 'a' and 'A' are the same
    });

    it('should ignore non A-Z starting letters', async () => {
      const day1 = new Date('2025-01-15T12:00:00Z').getTime();

      // Word starting with a number (hypothetical)
      const result = await processBakersDozenGuess(testFid, '123test', day1);

      expect(result.isFirstGuessOfDay).toBe(true);
      expect(result.letterEarned).toBeNull();
      expect(result.dayConsumed).toBe(false); // Day not consumed for non-letter
    });
  });

  describe('Progress Tracking', () => {
    it('should track distinct days correctly', async () => {
      // Simulate 5 days of guessing
      for (let i = 0; i < 5; i++) {
        const day = new Date(`2025-01-${15 + i}T12:00:00Z`).getTime();
        const letter = String.fromCharCode(65 + i); // A, B, C, D, E
        await processBakersDozenGuess(testFid, `${letter}word`, day);
      }

      const progress = await getBakersDozenProgress(testFid);
      expect(progress.distinctDays).toBe(5);
      expect(progress.distinctLetters).toBe(5);
    });

    it('should return correct progress state', async () => {
      const day = new Date('2025-01-15T12:00:00Z').getTime();
      await processBakersDozenGuess(testFid, 'apple', day);

      const progress = await getBakersDozenProgress(testFid);
      expect(progress.distinctDays).toBe(1);
      expect(progress.distinctLetters).toBe(1);
      expect(progress.letterMask).toBe(1); // Bit 0 (A) set
      expect(progress.isComplete).toBe(false);
    });
  });

  describe('Award Logic', () => {
    it('should award wordmark when 13 days AND 13 letters reached', async () => {
      // Simulate 13 days with 13 different letters
      for (let i = 0; i < 13; i++) {
        const day = new Date(`2025-01-${15 + i}T12:00:00Z`).getTime();
        const letter = String.fromCharCode(65 + i); // A through M
        await processBakersDozenGuess(testFid, `${letter}word`, day);
      }

      // Check progress
      const progress = await getBakersDozenProgress(testFid);
      expect(progress.distinctDays).toBe(13);
      expect(progress.distinctLetters).toBe(13);
      expect(progress.isComplete).toBe(true);

      // Check wordmark was awarded
      const [badge] = await db
        .select()
        .from(userBadges)
        .where(eq(userBadges.fid, testFid))
        .limit(1);

      expect(badge).toBeDefined();
      expect(badge.badgeType).toBe('BAKERS_DOZEN');
    });

    it('should NOT award wordmark with 13 days but only 12 letters', async () => {
      // Simulate 13 days but only 12 unique letters (one repeated)
      for (let i = 0; i < 12; i++) {
        const day = new Date(`2025-01-${15 + i}T12:00:00Z`).getTime();
        const letter = String.fromCharCode(65 + i); // A through L
        await processBakersDozenGuess(testFid, `${letter}word`, day);
      }

      // Day 13: repeat letter 'A'
      const day13 = new Date('2025-01-27T12:00:00Z').getTime();
      await processBakersDozenGuess(testFid, 'apple', day13);

      // Check progress
      const progress = await getBakersDozenProgress(testFid);
      expect(progress.distinctDays).toBe(13);
      expect(progress.distinctLetters).toBe(12);
      expect(progress.isComplete).toBe(false);

      // Check wordmark was NOT awarded
      const badges = await db
        .select()
        .from(userBadges)
        .where(eq(userBadges.fid, testFid));

      expect(badges.length).toBe(0);
    });

    it('should NOT award wordmark with 12 days even with 13 letters (impossible scenario check)', async () => {
      // Only 12 days can only yield 12 letters max
      for (let i = 0; i < 12; i++) {
        const day = new Date(`2025-01-${15 + i}T12:00:00Z`).getTime();
        const letter = String.fromCharCode(65 + i); // A through L
        await processBakersDozenGuess(testFid, `${letter}word`, day);
      }

      // Check progress
      const progress = await getBakersDozenProgress(testFid);
      expect(progress.distinctDays).toBe(12);
      expect(progress.distinctLetters).toBe(12);
      expect(progress.isComplete).toBe(false);

      // Check wordmark was NOT awarded
      const badges = await db
        .select()
        .from(userBadges)
        .where(eq(userBadges.fid, testFid));

      expect(badges.length).toBe(0);
    });

    it('should be idempotent - not award twice', async () => {
      // Simulate reaching the goal
      for (let i = 0; i < 13; i++) {
        const day = new Date(`2025-01-${15 + i}T12:00:00Z`).getTime();
        const letter = String.fromCharCode(65 + i);
        await processBakersDozenGuess(testFid, `${letter}word`, day);
      }

      // Try to award again
      const awarded = await checkAndAwardBakersDozen(testFid);
      expect(awarded).toBe(false); // Already awarded

      // Should still only have one badge
      const badges = await db
        .select()
        .from(userBadges)
        .where(eq(userBadges.fid, testFid));

      expect(badges.length).toBe(1);
    });
  });

  describe('Non-Consecutive Days', () => {
    it('should work with non-consecutive days', async () => {
      // Days spread across a month
      const days = [1, 5, 8, 12, 15, 18, 20, 22, 25, 27, 28, 29, 30];

      for (let i = 0; i < days.length; i++) {
        const day = new Date(`2025-01-${days[i].toString().padStart(2, '0')}T12:00:00Z`).getTime();
        const letter = String.fromCharCode(65 + i);
        await processBakersDozenGuess(testFid, `${letter}word`, day);
      }

      // Check progress
      const progress = await getBakersDozenProgress(testFid);
      expect(progress.distinctDays).toBe(13);
      expect(progress.distinctLetters).toBe(13);
      expect(progress.isComplete).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle user with no prior progress', async () => {
      const progress = await getBakersDozenProgress(testFid);
      expect(progress.distinctDays).toBe(0);
      expect(progress.distinctLetters).toBe(0);
      expect(progress.letterMask).toBe(0);
      expect(progress.isComplete).toBe(false);
    });

    it('should handle all 26 letters', async () => {
      // Simulate 26 days with all letters
      for (let i = 0; i < 26; i++) {
        const day = new Date(`2025-01-${(i + 1).toString().padStart(2, '0')}T12:00:00Z`).getTime();
        const letter = String.fromCharCode(65 + i); // A through Z
        await processBakersDozenGuess(testFid, `${letter}word`, day);
      }

      const progress = await getBakersDozenProgress(testFid);
      expect(progress.distinctDays).toBe(26);
      expect(progress.distinctLetters).toBe(26);
      expect(progress.letterMask).toBe((1 << 26) - 1); // All bits set
    });

    it('should award at exactly 13 days/letters', async () => {
      // Process 12 days - should not award
      for (let i = 0; i < 12; i++) {
        const day = new Date(`2025-01-${15 + i}T12:00:00Z`).getTime();
        const letter = String.fromCharCode(65 + i);
        const result = await processBakersDozenGuess(testFid, `${letter}word`, day);
        expect(result.awarded).toBe(false);
      }

      // Day 13 - should award
      const day13 = new Date('2025-01-27T12:00:00Z').getTime();
      const result = await processBakersDozenGuess(testFid, 'mango', day13);
      expect(result.awarded).toBe(true);
      expect(result.progress.distinctDays).toBe(13);
      expect(result.progress.distinctLetters).toBe(13);
    });
  });
});

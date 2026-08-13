import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as prices from '../lib/prices';
import {
  populateRoundSeedWords,
  getWheelWordsForRound,
  getGlobalGuessCount,
  getRoundStatus,
  getActiveRoundStatus,
  getActiveWheelData,
} from '../lib/wheel';
import { createRound, resolveRound, getActiveRound } from '../lib/rounds';
import { createTestRound, retireActiveRounds } from './helpers/rounds';
import { submitGuess } from '../lib/guesses';
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

  afterEach(async () => {
    // createRound refuses to run while a round is active, so without this the
    // second test in the file fails and every one after it.
    await retireActiveRounds();
  });
  describe('populateRoundSeedWords()', () => {
    /**
     * Seed words were removed in Milestone 4.11. The wheel now renders every
     * guessable word carrying a status rather than a sampled subset, so there
     * is nothing left to seed and `populateRoundSeedWords` is an explicit
     * no-op kept only so older callers do not break.
     *
     * The three tests this replaces asserted it filled `round_seed_words` —
     * one of them that a `count` argument it now ignores produced exactly ten
     * rows. They had been asserting against deleted behaviour, and the two
     * that "passed" did so by comparing zero to zero.
     */
    it('should be a no-op that writes no seed words', async () => {
      const round = await createTestRound({ forceAnswer: 'brain' });

      await populateRoundSeedWords(round.id);
      await populateRoundSeedWords(round.id, 10);

      const seedWords = await db
        .select()
        .from(roundSeedWords)
        .where(eq(roundSeedWords.roundId, round.id));

      expect(seedWords).toHaveLength(0);

      // Clean up
      await resolveRound(round.id, 12345);
    });
  });

  describe('getWheelWordsForRound()', () => {
    /**
     * Milestone 4.10 changed the return type: the wheel is now the whole guess
     * list, every word carrying a status of 'unguessed' | 'wrong' | 'winner',
     * rather than an array of the strings that had been guessed.
     *
     * The tests below had not been updated, so they asked whether an array of
     * objects `toContain('HOUSE')` — which is false for every word, guessed or
     * not. Worse, the two assertions that still passed passed for the wrong
     * reason: `not.toContain('BRAIN')` was reading as "the answer is not
     * leaked" when in fact no bare string could ever be found in that array,
     * so it would have held even if the wheel had marked the answer as the
     * winner before anyone guessed it. Status is now asserted directly.
     */
    const statusOf = (words: Awaited<ReturnType<typeof getWheelWordsForRound>>, word: string) =>
      words.find((w) => w.word === word)?.status;

    it('should return every guessable word as unguessed when no guesses exist', async () => {
      const round = await createTestRound({ forceAnswer: 'brain' });

      const wheelWords = await getWheelWordsForRound(round.id);

      expect(wheelWords.length).toBeGreaterThan(0);
      expect(wheelWords.every((w) => w.status === 'unguessed')).toBe(true);

      // Sorted alphabetically by word — compare the words themselves, since
      // sorting the objects compares "[object Object]" and always agrees.
      const words = wheelWords.map((w) => w.word);
      expect(words).toEqual([...words].sort((a, b) => a.localeCompare(b)));

      // Clean up
      await resolveRound(round.id, 12345);
    });

    it('should mark wrong guesses as wrong and leave the answer unguessed', async () => {
      const round = await createTestRound({ forceAnswer: 'brain' });

      // Submit some wrong guesses
      await submitGuess({ fid: 12345, word: 'HOUSE' });
      await submitGuess({ fid: 12345, word: 'CRANE' });
      await submitGuess({ fid: 12345, word: 'SLATE' });

      const wheelWords = await getWheelWordsForRound(round.id);

      expect(statusOf(wheelWords, 'HOUSE')).toBe('wrong');
      expect(statusOf(wheelWords, 'CRANE')).toBe('wrong');
      expect(statusOf(wheelWords, 'SLATE')).toBe('wrong');

      // The answer must stay indistinguishable from any other unguessed word
      // until it is actually guessed, or the wheel leaks it.
      expect(statusOf(wheelWords, 'BRAIN')).toBe('unguessed');

      // Clean up
      await resolveRound(round.id, 12345);
    });

    it('should list each word exactly once however many times it is guessed', async () => {
      const round = await createTestRound({ forceAnswer: 'brain' });

      // Submit same wrong guess from different users
      await submitGuess({ fid: 100, word: 'HOUSE' });
      await submitGuess({ fid: 200, word: 'HOUSE' });
      await submitGuess({ fid: 300, word: 'HOUSE' });

      const wheelWords = await getWheelWordsForRound(round.id);

      const houseEntries = wheelWords.filter((w) => w.word === 'HOUSE');
      expect(houseEntries).toHaveLength(1);
      expect(houseEntries[0].status).toBe('wrong');

      // Clean up
      await resolveRound(round.id, 12345);
    });

    it('should mark a correct guess as the winner', async () => {
      const round = await createTestRound({ forceAnswer: 'brain' });

      // Submit wrong guesses
      await submitGuess({ fid: 100, word: 'HOUSE' });
      await submitGuess({ fid: 200, word: 'CRANE' });

      // Submit correct guess
      await submitGuess({ fid: 300, word: 'BRAIN' });

      const wheelWords = await getWheelWordsForRound(round.id);

      expect(statusOf(wheelWords, 'HOUSE')).toBe('wrong');
      expect(statusOf(wheelWords, 'CRANE')).toBe('wrong');
      expect(statusOf(wheelWords, 'BRAIN')).toBe('winner');

      // The round is now resolved, no cleanup needed
    });
  });

  describe('getGlobalGuessCount()', () => {
    it('should return 0 when no guesses exist', async () => {
      const round = await createTestRound({ forceAnswer: 'brain' });

      const count = await getGlobalGuessCount(round.id);

      expect(count).toBe(0);

      // Clean up
      await resolveRound(round.id, 12345);
    });

    it('should count all guesses for a round', async () => {
      const round = await createTestRound({ forceAnswer: 'brain' });

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
      const round = await createTestRound({ forceAnswer: 'brain' });

      // Submit wrong guesses
      await submitGuess({ fid: 100, word: 'HOUSE' });
      await submitGuess({ fid: 200, word: 'CRANE' });

      // Submit correct guess
      await submitGuess({ fid: 300, word: 'BRAIN' });

      const count = await getGlobalGuessCount(round.id);

      expect(count).toBe(3);

      // The round is now resolved
    });

    it('should count only real guesses, not the words shown on the wheel', async () => {
      const round = await createTestRound({ forceAnswer: 'brain' });

      // The wheel shows the whole guess list from the moment a round opens.
      // None of it counts as a guess: only rows in `guesses` do.
      const wheelWords = await getWheelWordsForRound(round.id);
      expect(wheelWords.length).toBeGreaterThan(0);

      const count = await getGlobalGuessCount(round.id);
      expect(count).toBe(0);

      // Clean up
      await resolveRound(round.id, 12345);
    });
  });

  describe('getRoundStatus()', () => {
    /**
     * getRoundStatus derives prizePoolUsd from getEthUsdPrice, which makes a
     * live call to CoinGecko and returns null when that call fails — and
     * CoinGecko rate-limits anonymous callers freely. Left alone these two
     * tests pass or fail depending on someone else's API, which is how a suite
     * earns a reputation for being flaky and stops being trusted. The rate is
     * pinned instead.
     */
    beforeEach(() => {
      vi.spyOn(prices, 'getEthUsdPrice').mockResolvedValue(3000);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return correct round status', async () => {
      const round = await createTestRound({ forceAnswer: 'brain' });

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
      const round = await createTestRound({ forceAnswer: 'brain' });

      const status = await getRoundStatus(round.id);

      // With ETH_USD_RATE = 3000
      // 0 ETH = $0.00 USD
      expect(status.prizePoolUsd).toBe('0.00');

      // Clean up
      await resolveRound(round.id, 12345);
    });

    it('should include global guess count', async () => {
      const round = await createTestRound({ forceAnswer: 'brain' });

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
      const round = await createTestRound({ forceAnswer: 'brain' });

      const status = await getActiveRoundStatus();

      expect(status).toBeDefined();
      expect(status?.roundId).toBe(round.id);

      // Clean up
      await resolveRound(round.id, 12345);
    });

    it('should return the status of the round that is already active', async () => {
      // This replaces a test named "should return null when no active round
      // exists" whose only assertion was `status === null || status !== null`
      // — true of every value — and which could not run anyway: with no
      // active round, getActiveRoundStatus goes through ensureActiveRound and
      // *creates* one, which needs a deployed contract. It never returns null,
      // as its own doc comment says. What is worth pinning is that it reports
      // the existing round rather than starting a second one.
      const round = await createTestRound({ forceAnswer: 'brain' });

      const status = await getActiveRoundStatus();

      expect(status).not.toBeNull();
      expect(status.roundId).toBe(round.id);

      const stillActive = await getActiveRound();
      expect(stillActive!.id).toBe(round.id);

      // Clean up
      await resolveRound(round.id, 12345);
    });
  });

  describe('getActiveWheelData()', () => {
    it('should return wheel data for active round', async () => {
      const round = await createTestRound({ forceAnswer: 'brain' });

      const wheelData = await getActiveWheelData();

      expect(wheelData).toBeDefined();
      expect(wheelData?.roundId).toBe(round.id);
      expect(wheelData?.words).toBeDefined();
      expect(Array.isArray(wheelData?.words)).toBe(true);

      // Clean up
      await resolveRound(round.id, 12345);
    });

    it('should return sorted alphabetical words', async () => {
      const round = await createTestRound({ forceAnswer: 'brain' });

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
      // 1. Create round
      const round = await createTestRound({ forceAnswer: 'brain' });

      // 2. The wheel starts as the full guess list, nothing guessed yet
      const initialWheel = await getWheelWordsForRound(round.id);
      expect(initialWheel.length).toBeGreaterThan(0);
      expect(initialWheel.every((w) => w.status === 'unguessed')).toBe(true);

      // 3. Submit wrong guesses
      await submitGuess({ fid: 100, word: 'HOUSE' });
      await submitGuess({ fid: 200, word: 'CRANE' });
      await submitGuess({ fid: 300, word: 'SLATE' });

      // 4. Those three words turn wrong; nothing else moves
      const wheelWithGuesses = await getWheelWordsForRound(round.id);
      const wrongWords = wheelWithGuesses.filter((w) => w.status === 'wrong').map((w) => w.word);
      expect(wrongWords.sort()).toEqual(['CRANE', 'HOUSE', 'SLATE']);

      // 5. Verify global guess count (should NOT include seed words)
      const guessCount = await getGlobalGuessCount(round.id);
      expect(guessCount).toBe(3);

      // 6. Get round status
      const status = await getRoundStatus(round.id);
      expect(status.roundId).toBe(round.id);
      expect(status.globalGuessCount).toBe(3);

      // 7. Submit correct guess
      await submitGuess({ fid: 400, word: 'BRAIN' });

      // 8. The answer is now, and only now, marked as the winner
      const finalWheel = await getWheelWordsForRound(round.id);
      expect(finalWheel.find((w) => w.word === 'BRAIN')?.status).toBe('winner');

      // 9. Verify final guess count includes all guesses
      const finalCount = await getGlobalGuessCount(round.id);
      expect(finalCount).toBe(4);

      // Round is auto-resolved, no cleanup needed
    });
  });
});

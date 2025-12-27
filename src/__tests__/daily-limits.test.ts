import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  getOrCreateDailyState,
  submitGuessWithDailyLimits,
  canBuyAnotherPack,
  awardPaidPack,
  awardShareBonus,
  getFreeGuessesRemaining,
  getTodayUTC,
  DAILY_LIMITS_RULES,
} from '../lib/daily-limits';
import * as economyConfig from '../../config/economy';
import { createRound, resolveRound } from '../lib/rounds';
import { db } from '../db';
import { dailyGuessState } from '../db/schema';
import { eq, and } from 'drizzle-orm';

/**
 * Daily Limits & Bonus Mechanics Tests
 * Milestone 2.2
 *
 * Note: These tests require a running PostgreSQL database
 * Set DATABASE_URL in .env before running tests
 */

describe('Daily Limits & Bonuses - Milestone 2.2', () => {
  let testFid: number;
  let testDate: string;
  let testRoundId: number;

  beforeEach(async () => {
    // Use unique FID for each test to avoid conflicts
    testFid = Math.floor(Math.random() * 1000000) + 100000;
    testDate = getTodayUTC();

    // Create a test round
    const round = await createRound({ forceAnswer: 'brain' });
    testRoundId = round.id;
  });

  describe('Daily State Management', () => {
    it('should create daily state for new user with base free guesses', async () => {
      const state = await getOrCreateDailyState(testFid, testDate);

      expect(state).toBeDefined();
      expect(state.fid).toBe(testFid);
      expect(state.date).toBe(testDate);
      expect(state.freeAllocatedBase).toBe(DAILY_LIMITS_RULES.freeGuessesPerDayBase);
      expect(state.freeAllocatedClankton).toBe(0); // Stub returns false
      expect(state.freeAllocatedShareBonus).toBe(0);
      expect(state.freeUsed).toBe(0);
      expect(state.paidGuessCredits).toBe(0);
      expect(state.paidPacksPurchased).toBe(0);
      expect(state.hasSharedToday).toBe(false);
    });

    it('should return existing state on subsequent calls', async () => {
      const state1 = await getOrCreateDailyState(testFid, testDate);
      const state2 = await getOrCreateDailyState(testFid, testDate);

      expect(state1.id).toBe(state2.id);
      expect(state1.createdAt).toEqual(state2.createdAt);
    });

    it('should calculate free guesses remaining correctly', async () => {
      const state = await getOrCreateDailyState(testFid, testDate);

      // Initially: 1 base + 0 CLANKTON + 0 share = 1 total
      expect(getFreeGuessesRemaining(state)).toBe(1);

      // After using 1
      await db
        .update(dailyGuessState)
        .set({ freeUsed: 1 })
        .where(eq(dailyGuessState.id, state.id));
      const updatedState = await getOrCreateDailyState(testFid, testDate);
      expect(getFreeGuessesRemaining(updatedState)).toBe(0);
    });
  });

  describe('Free Guess Consumption', () => {
    it('should consume free guesses before paid guesses', async () => {
      // User has 1 free guess
      const state = await getOrCreateDailyState(testFid, testDate);
      expect(getFreeGuessesRemaining(state)).toBe(1);

      // Submit first guess (should use free)
      const result1 = await submitGuessWithDailyLimits({
        fid: testFid,
        word: 'house',
      });

      expect(result1.status).toBe('incorrect');

      // Check state after first guess
      const stateAfter1 = await getOrCreateDailyState(testFid, testDate);
      expect(stateAfter1.freeUsed).toBe(1);
      expect(getFreeGuessesRemaining(stateAfter1)).toBe(0);

      // Clean up
      await resolveRound(testRoundId, 99999);
    });

    it('should reject guess when no free or paid guesses remain', async () => {
      // User has 1 free guess initially
      const state = await getOrCreateDailyState(testFid, testDate);

      // Use the free guess
      await submitGuessWithDailyLimits({
        fid: testFid,
        word: 'house',
      });

      // Try to guess again (should be rejected)
      const result = await submitGuessWithDailyLimits({
        fid: testFid,
        word: 'phone',
      });

      expect(result.status).toBe('no_guesses_left_today');

      // Clean up
      await resolveRound(testRoundId, 99999);
    });

    it('should use paid guesses when free guesses exhausted', async () => {
      const state = await getOrCreateDailyState(testFid, testDate);

      // Award a paid pack (3 credits)
      await awardPaidPack(testFid, testDate);

      // Use free guess first
      await submitGuessWithDailyLimits({
        fid: testFid,
        word: 'house',
      });

      // Now use paid guess
      const result2 = await submitGuessWithDailyLimits({
        fid: testFid,
        word: 'phone',
      });

      expect(result2.status).toBe('incorrect');

      // Check state
      const finalState = await getOrCreateDailyState(testFid, testDate);
      expect(finalState.freeUsed).toBe(1);
      expect(finalState.paidGuessCredits).toBe(2); // 3 - 1 = 2 remaining

      // Clean up
      await resolveRound(testRoundId, 99999);
    });
  });

  describe('Paid Pack Purchases', () => {
    it('should award paid pack and add credits', async () => {
      const stateBefore = await getOrCreateDailyState(testFid, testDate);
      expect(stateBefore.paidPacksPurchased).toBe(0);
      expect(stateBefore.paidGuessCredits).toBe(0);

      await awardPaidPack(testFid, testDate);

      const stateAfter = await getOrCreateDailyState(testFid, testDate);
      expect(stateAfter.paidPacksPurchased).toBe(1);
      expect(stateAfter.paidGuessCredits).toBe(DAILY_LIMITS_RULES.paidGuessPackSize);
    });

    it('should allow up to max packs per day', async () => {
      // Buy first pack
      const canBuy1 = await canBuyAnotherPack(testFid, testDate);
      expect(canBuy1).toBe(true);
      await awardPaidPack(testFid, testDate);

      // Buy second pack
      const canBuy2 = await canBuyAnotherPack(testFid, testDate);
      expect(canBuy2).toBe(true);
      await awardPaidPack(testFid, testDate);

      // Buy third pack
      const canBuy3 = await canBuyAnotherPack(testFid, testDate);
      expect(canBuy3).toBe(true);
      await awardPaidPack(testFid, testDate);

      // Try to buy fourth pack (should fail)
      const canBuy4 = await canBuyAnotherPack(testFid, testDate);
      expect(canBuy4).toBe(false);

      await expect(awardPaidPack(testFid, testDate)).rejects.toThrow('Cannot buy more packs');

      // Verify state
      const finalState = await getOrCreateDailyState(testFid, testDate);
      expect(finalState.paidPacksPurchased).toBe(DAILY_LIMITS_RULES.maxPaidPacksPerDay);
      expect(finalState.paidGuessCredits).toBe(
        DAILY_LIMITS_RULES.paidGuessPackSize * DAILY_LIMITS_RULES.maxPaidPacksPerDay
      );
    });

    it('should correctly consume paid credits across multiple guesses', async () => {
      // Award 1 pack (3 credits)
      await awardPaidPack(testFid, testDate);

      // Use free guess first
      await submitGuessWithDailyLimits({ fid: testFid, word: 'house' });

      // Use 3 paid guesses
      await submitGuessWithDailyLimits({ fid: testFid, word: 'phone' });
      await submitGuessWithDailyLimits({ fid: testFid, word: 'table' });
      await submitGuessWithDailyLimits({ fid: testFid, word: 'chair' });

      // Try another guess (should be rejected)
      const result = await submitGuessWithDailyLimits({ fid: testFid, word: 'light' });
      expect(result.status).toBe('no_guesses_left_today');

      // Clean up
      await resolveRound(testRoundId, 99999);
    });
  });

  describe('Share Bonus', () => {
    it('should award share bonus once per day', async () => {
      const stateBefore = await getOrCreateDailyState(testFid, testDate);
      expect(stateBefore.hasSharedToday).toBe(false);
      expect(stateBefore.freeAllocatedShareBonus).toBe(0);

      // Award share bonus
      const result = await awardShareBonus(testFid, testDate);
      expect(result).toBeDefined();
      expect(result?.hasSharedToday).toBe(true);
      expect(result?.freeAllocatedShareBonus).toBe(DAILY_LIMITS_RULES.shareBonusGuesses);

      // Try to award again (should return null)
      const result2 = await awardShareBonus(testFid, testDate);
      expect(result2).toBeNull();
    });

    it('should increase free guesses available after share bonus', async () => {
      const state1 = await getOrCreateDailyState(testFid, testDate);
      const initialFree = getFreeGuessesRemaining(state1);
      expect(initialFree).toBe(1); // Base only

      // Award share bonus
      await awardShareBonus(testFid, testDate);

      const state2 = await getOrCreateDailyState(testFid, testDate);
      const newFree = getFreeGuessesRemaining(state2);
      expect(newFree).toBe(initialFree + DAILY_LIMITS_RULES.shareBonusGuesses);
    });

    it('should allow using share bonus guess', async () => {
      // Use base free guess
      await submitGuessWithDailyLimits({ fid: testFid, word: 'house' });

      // Would be out of guesses, but award share bonus
      await awardShareBonus(testFid, testDate);

      // Should be able to guess again
      const result = await submitGuessWithDailyLimits({ fid: testFid, word: 'phone' });
      expect(result.status).toBe('incorrect');

      // Now should be out of guesses
      const result2 = await submitGuessWithDailyLimits({ fid: testFid, word: 'table' });
      expect(result2.status).toBe('no_guesses_left_today');

      // Clean up
      await resolveRound(testRoundId, 99999);
    });
  });

  describe('Full Day Scenario', () => {
    it('should handle complete daily flow with all guess types', async () => {
      // Initial state: 1 base free guess
      const state1 = await getOrCreateDailyState(testFid, testDate);
      expect(getFreeGuessesRemaining(state1)).toBe(1);

      // 1. Use base free guess
      const guess1 = await submitGuessWithDailyLimits({ fid: testFid, word: 'house' });
      expect(guess1.status).toBe('incorrect');

      // 2. Award share bonus
      await awardShareBonus(testFid, testDate);
      const state2 = await getOrCreateDailyState(testFid, testDate);
      expect(getFreeGuessesRemaining(state2)).toBe(1); // Share bonus guess

      // 3. Use share bonus guess
      const guess2 = await submitGuessWithDailyLimits({ fid: testFid, word: 'phone' });
      expect(guess2.status).toBe('incorrect');

      // 4. Buy a pack (3 paid guesses)
      await awardPaidPack(testFid, testDate);

      // 5. Use all 3 paid guesses
      const guess3 = await submitGuessWithDailyLimits({ fid: testFid, word: 'table' });
      expect(guess3.status).toBe('incorrect');

      const guess4 = await submitGuessWithDailyLimits({ fid: testFid, word: 'chair' });
      expect(guess4.status).toBe('incorrect');

      const guess5 = await submitGuessWithDailyLimits({ fid: testFid, word: 'light' });
      expect(guess5.status).toBe('incorrect');

      // 6. No more guesses
      const guess6 = await submitGuessWithDailyLimits({ fid: testFid, word: 'bread' });
      expect(guess6.status).toBe('no_guesses_left_today');

      // Verify final state
      const finalState = await getOrCreateDailyState(testFid, testDate);
      expect(finalState.freeUsed).toBe(2); // base + share
      expect(finalState.paidGuessCredits).toBe(0); // all used
      expect(finalState.hasSharedToday).toBe(true);

      // Clean up
      await resolveRound(testRoundId, 99999);
    });
  });

  /**
   * Duplicate Guess Credit Consumption Tests
   * These tests verify that rejected guesses (duplicates, invalid words, etc.)
   * do NOT consume guess credits.
   *
   * Bug fix: Previously, credits were consumed BEFORE validation, causing
   * duplicate guesses to incorrectly decrement the free/paid guess counter.
   */
  describe('Duplicate Guess Credit Protection', () => {
    it('should NOT consume free guess credit for duplicate guesses', async () => {
      // User A has 1 free guess
      const stateBefore = await getOrCreateDailyState(testFid, testDate);
      expect(getFreeGuessesRemaining(stateBefore)).toBe(1);

      // User A guesses 'house' (first time - should succeed and consume credit)
      const result1 = await submitGuessWithDailyLimits({ fid: testFid, word: 'house' });
      expect(result1.status).toBe('incorrect');

      // Verify credit was consumed
      const stateAfterFirst = await getOrCreateDailyState(testFid, testDate);
      expect(stateAfterFirst.freeUsed).toBe(1);
      expect(getFreeGuessesRemaining(stateAfterFirst)).toBe(0);

      // Award share bonus so user has another guess
      await awardShareBonus(testFid, testDate);
      const stateWithBonus = await getOrCreateDailyState(testFid, testDate);
      expect(getFreeGuessesRemaining(stateWithBonus)).toBe(1); // 1 share bonus guess

      // User A tries to guess 'house' again (duplicate - should be rejected)
      const result2 = await submitGuessWithDailyLimits({ fid: testFid, word: 'house' });
      expect(result2.status).toBe('already_guessed_word');

      // Verify NO additional credit was consumed
      const stateAfterDupe = await getOrCreateDailyState(testFid, testDate);
      expect(stateAfterDupe.freeUsed).toBe(1); // Still 1, not 2!
      expect(getFreeGuessesRemaining(stateAfterDupe)).toBe(1); // Still have share bonus

      // Verify user can still make a valid guess with their remaining credit
      const result3 = await submitGuessWithDailyLimits({ fid: testFid, word: 'table' });
      expect(result3.status).toBe('incorrect');

      // Clean up
      await resolveRound(testRoundId, 99999);
    });

    it('should NOT consume paid guess credit for duplicate guesses', async () => {
      // Use free guess first
      await submitGuessWithDailyLimits({ fid: testFid, word: 'house' });

      // Award a paid pack (3 credits)
      await awardPaidPack(testFid, testDate);
      const stateWithPack = await getOrCreateDailyState(testFid, testDate);
      expect(stateWithPack.paidGuessCredits).toBe(3);

      // Try to guess 'house' again with paid guess (duplicate - should be rejected)
      const result = await submitGuessWithDailyLimits({ fid: testFid, word: 'house' });
      expect(result.status).toBe('already_guessed_word');

      // Verify NO paid credit was consumed
      const stateAfterDupe = await getOrCreateDailyState(testFid, testDate);
      expect(stateAfterDupe.paidGuessCredits).toBe(3); // Still 3, not 2!

      // Clean up
      await resolveRound(testRoundId, 99999);
    });

    it('should NOT consume credit for invalid word submissions', async () => {
      const stateBefore = await getOrCreateDailyState(testFid, testDate);
      expect(getFreeGuessesRemaining(stateBefore)).toBe(1);

      // Try to guess an invalid word (not in dictionary)
      const result = await submitGuessWithDailyLimits({ fid: testFid, word: 'zzzzz' });
      expect(result.status).toBe('invalid_word');

      // Verify NO credit was consumed
      const stateAfterInvalid = await getOrCreateDailyState(testFid, testDate);
      expect(stateAfterInvalid.freeUsed).toBe(0); // No guess consumed
      expect(getFreeGuessesRemaining(stateAfterInvalid)).toBe(1);

      // Clean up
      await resolveRound(testRoundId, 99999);
    });

    it('should handle cross-user duplicate guesses correctly', async () => {
      const otherFid = testFid + 1;

      // User A guesses 'house' (first guess in round)
      const result1 = await submitGuessWithDailyLimits({ fid: testFid, word: 'house' });
      expect(result1.status).toBe('incorrect');

      // User A's credit consumed
      const stateA = await getOrCreateDailyState(testFid, testDate);
      expect(stateA.freeUsed).toBe(1);

      // User B tries to guess 'house' (already guessed globally)
      const result2 = await submitGuessWithDailyLimits({ fid: otherFid, word: 'house' });
      expect(result2.status).toBe('already_guessed_word');

      // User B's credit should NOT be consumed
      const stateB = await getOrCreateDailyState(otherFid, testDate);
      expect(stateB.freeUsed).toBe(0); // No credit consumed!
      expect(getFreeGuessesRemaining(stateB)).toBe(1); // Still have their free guess

      // User B can still make a valid guess
      const result3 = await submitGuessWithDailyLimits({ fid: otherFid, word: 'phone' });
      expect(result3.status).toBe('incorrect');

      // Clean up
      await resolveRound(testRoundId, 99999);
    });

    it('should correctly consume credit only for valid, non-duplicate guesses', async () => {
      // Start with share bonus for 2 total free guesses
      await awardShareBonus(testFid, testDate);
      const initialState = await getOrCreateDailyState(testFid, testDate);
      expect(getFreeGuessesRemaining(initialState)).toBe(2); // 1 base + 1 share

      // Guess 1: valid word -> should consume
      const r1 = await submitGuessWithDailyLimits({ fid: testFid, word: 'house' });
      expect(r1.status).toBe('incorrect');

      // Attempt 2: duplicate -> should NOT consume
      const r2 = await submitGuessWithDailyLimits({ fid: testFid, word: 'house' });
      expect(r2.status).toBe('already_guessed_word');

      // Attempt 3: invalid word -> should NOT consume
      const r3 = await submitGuessWithDailyLimits({ fid: testFid, word: 'zzzzz' });
      expect(r3.status).toBe('invalid_word');

      // Check: should still have 1 guess remaining (only 1 consumed)
      const midState = await getOrCreateDailyState(testFid, testDate);
      expect(midState.freeUsed).toBe(1);
      expect(getFreeGuessesRemaining(midState)).toBe(1);

      // Guess 2: valid word -> should consume
      const r4 = await submitGuessWithDailyLimits({ fid: testFid, word: 'phone' });
      expect(r4.status).toBe('incorrect');

      // Now out of guesses
      const finalState = await getOrCreateDailyState(testFid, testDate);
      expect(finalState.freeUsed).toBe(2);
      expect(getFreeGuessesRemaining(finalState)).toBe(0);

      // Clean up
      await resolveRound(testRoundId, 99999);
    });
  });

  /**
   * CLANKTON Tier Upgrade Tests
   * Milestone 5.4c: Market cap tier upgrade mid-day
   *
   * These tests verify that CLANKTON holders get upgraded from 2→3 free guesses
   * when the market cap crosses $250K during the day.
   */
  describe('CLANKTON Tier Upgrade Mid-Day', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should upgrade CLANKTON holder from 2 to 3 guesses when tier increases mid-day', async () => {
      // Simulate LOW tier (mcap < $250K) - holder gets 2 bonus guesses
      vi.spyOn(economyConfig, 'getClanktonHolderBonusGuesses').mockReturnValue(2);

      // Create a daily state with CLANKTON bonus at LOW tier
      // We'll manually insert a row to simulate an existing holder
      const [initialState] = await db
        .insert(dailyGuessState)
        .values({
          fid: testFid,
          date: testDate,
          freeAllocatedBase: 1,
          freeAllocatedClankton: 2, // LOW tier
          freeAllocatedShareBonus: 0,
          freeUsed: 0,
          paidGuessCredits: 0,
          paidPacksPurchased: 0,
          hasSharedToday: false,
        })
        .returning();

      expect(initialState.freeAllocatedClankton).toBe(2);
      expect(getFreeGuessesRemaining(initialState)).toBe(3); // 1 base + 2 CLANKTON

      // Now simulate market cap crossing $250K (HIGH tier)
      vi.spyOn(economyConfig, 'getClanktonHolderBonusGuesses').mockReturnValue(3);

      // User opens app again - should get upgraded
      const upgradedState = await getOrCreateDailyState(testFid, testDate);

      expect(upgradedState.freeAllocatedClankton).toBe(3); // Upgraded!
      expect(getFreeGuessesRemaining(upgradedState)).toBe(4); // 1 base + 3 CLANKTON
    });

    it('should NOT downgrade CLANKTON holder if market cap drops below threshold', async () => {
      // Start with HIGH tier (mcap >= $250K)
      vi.spyOn(economyConfig, 'getClanktonHolderBonusGuesses').mockReturnValue(3);

      // Create a daily state with CLANKTON bonus at HIGH tier
      const [initialState] = await db
        .insert(dailyGuessState)
        .values({
          fid: testFid,
          date: testDate,
          freeAllocatedBase: 1,
          freeAllocatedClankton: 3, // HIGH tier
          freeAllocatedShareBonus: 0,
          freeUsed: 0,
          paidGuessCredits: 0,
          paidPacksPurchased: 0,
          hasSharedToday: false,
        })
        .returning();

      expect(initialState.freeAllocatedClankton).toBe(3);

      // Simulate market cap dropping below $250K (LOW tier)
      vi.spyOn(economyConfig, 'getClanktonHolderBonusGuesses').mockReturnValue(2);

      // User opens app again - should NOT be downgraded
      const state = await getOrCreateDailyState(testFid, testDate);

      expect(state.freeAllocatedClankton).toBe(3); // Still 3, not downgraded
      expect(getFreeGuessesRemaining(state)).toBe(4); // 1 base + 3 CLANKTON
    });

    it('should not affect non-CLANKTON holders when tier changes', async () => {
      // Simulate LOW tier
      vi.spyOn(economyConfig, 'getClanktonHolderBonusGuesses').mockReturnValue(2);

      // Create a daily state for non-holder
      const [initialState] = await db
        .insert(dailyGuessState)
        .values({
          fid: testFid,
          date: testDate,
          freeAllocatedBase: 1,
          freeAllocatedClankton: 0, // NOT a holder
          freeAllocatedShareBonus: 0,
          freeUsed: 0,
          paidGuessCredits: 0,
          paidPacksPurchased: 0,
          hasSharedToday: false,
        })
        .returning();

      expect(initialState.freeAllocatedClankton).toBe(0);

      // Simulate market cap crossing $250K (HIGH tier)
      vi.spyOn(economyConfig, 'getClanktonHolderBonusGuesses').mockReturnValue(3);

      // User opens app again - should NOT get any bonus (not a holder)
      const state = await getOrCreateDailyState(testFid, testDate);

      expect(state.freeAllocatedClankton).toBe(0); // Still 0
      expect(getFreeGuessesRemaining(state)).toBe(1); // Just 1 base
    });

    it('should upgrade holder who already used some guesses', async () => {
      // Simulate LOW tier initially
      vi.spyOn(economyConfig, 'getClanktonHolderBonusGuesses').mockReturnValue(2);

      // Create a daily state with CLANKTON bonus, some guesses used
      const [initialState] = await db
        .insert(dailyGuessState)
        .values({
          fid: testFid,
          date: testDate,
          freeAllocatedBase: 1,
          freeAllocatedClankton: 2, // LOW tier
          freeAllocatedShareBonus: 0,
          freeUsed: 2, // Used 2 guesses already
          paidGuessCredits: 0,
          paidPacksPurchased: 0,
          hasSharedToday: false,
        })
        .returning();

      // Originally had 3 total (1 base + 2 CLANKTON), used 2, so 1 remaining
      expect(getFreeGuessesRemaining(initialState)).toBe(1);

      // Simulate market cap crossing $250K (HIGH tier)
      vi.spyOn(economyConfig, 'getClanktonHolderBonusGuesses').mockReturnValue(3);

      // User opens app again - should get upgraded
      const upgradedState = await getOrCreateDailyState(testFid, testDate);

      expect(upgradedState.freeAllocatedClankton).toBe(3); // Upgraded!
      // Now has 4 total (1 base + 3 CLANKTON), used 2, so 2 remaining
      expect(getFreeGuessesRemaining(upgradedState)).toBe(2);
    });
  });
});

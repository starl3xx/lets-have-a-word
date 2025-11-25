import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  applyPaidGuessEconomicEffects,
  resolveRoundAndCreatePayouts,
  createNextRoundFromSeed,
} from './economics';
import { db } from '../db';
import { rounds, systemState, roundPayouts, guesses, users } from '../db/schema';
import { eq } from 'drizzle-orm';

/**
 * Comprehensive tests for Milestone 3.1 - Economics Module
 *
 * Tests cover:
 * - applyPaidGuessEconomicEffects: 80/20 split with seed cap
 * - resolveRoundAndCreatePayouts: 80/10/10 jackpot split
 * - createNextRoundFromSeed: round creation with seed initialization
 */

describe('Economics Module - Milestone 3.1', () => {
  describe('applyPaidGuessEconomicEffects', () => {
    it('should split 80% to prize pool and 20% to seed when seed is below cap', async () => {
      // Create a test round with initial values
      const [round] = await db
        .insert(rounds)
        .values({
          rulesetId: 1,
          answer: 'TESTS',
          salt: 'test-salt',
          commitHash: 'test-hash',
          prizePoolEth: '0.1',
          seedNextRoundEth: '0.02', // Below 0.03 cap
        })
        .returning();

      // Apply economics for a 0.001 ETH guess
      await applyPaidGuessEconomicEffects(round.id, '0.001');

      // Fetch updated round
      const [updated] = await db
        .select()
        .from(rounds)
        .where(eq(rounds.id, round.id));

      // Prize pool should increase by 80% of 0.001 = 0.0008
      expect(parseFloat(updated.prizePoolEth)).toBeCloseTo(0.1 + 0.0008, 6);

      // Seed should increase by 20% of 0.001 = 0.0002
      expect(parseFloat(updated.seedNextRoundEth)).toBeCloseTo(0.02 + 0.0002, 6);

      // Clean up
      await db.delete(rounds).where(eq(rounds.id, round.id));
    });

    it('should cap seed at 0.03 ETH and overflow to creator balance', async () => {
      // Create a test round with seed near cap
      const [round] = await db
        .insert(rounds)
        .values({
          rulesetId: 1,
          answer: 'TESTS',
          salt: 'test-salt',
          commitHash: 'test-hash',
          prizePoolEth: '0.1',
          seedNextRoundEth: '0.025', // Close to 0.03 cap
        })
        .returning();

      // Get or create system state
      let [state] = await db.select().from(systemState).limit(1);
      if (!state) {
        [state] = await db
          .insert(systemState)
          .values({ creatorBalanceEth: '0' })
          .returning();
      }

      const initialCreatorBalance = parseFloat(state.creatorBalanceEth);

      // Apply economics for a 0.05 ETH guess
      // 20% = 0.01 ETH should go to seed/creator
      // Only 0.005 can fit in seed (0.03 - 0.025 = 0.005)
      // Remaining 0.005 should go to creator balance
      await applyPaidGuessEconomicEffects(round.id, '0.05');

      // Fetch updated round
      const [updatedRound] = await db
        .select()
        .from(rounds)
        .where(eq(rounds.id, round.id));

      // Prize pool should increase by 80% of 0.05 = 0.04
      expect(parseFloat(updatedRound.prizePoolEth)).toBeCloseTo(0.1 + 0.04, 6);

      // Seed should be capped at 0.03
      expect(parseFloat(updatedRound.seedNextRoundEth)).toBeCloseTo(0.03, 6);

      // Check creator balance increased by overflow (0.005 ETH)
      const [updatedState] = await db.select().from(systemState).limit(1);
      expect(parseFloat(updatedState.creatorBalanceEth)).toBeCloseTo(
        initialCreatorBalance + 0.005,
        6
      );

      // Clean up
      await db.delete(rounds).where(eq(rounds.id, round.id));
    });

    it('should send all 20% to creator when seed is at cap', async () => {
      // Create a test round with seed at cap
      const [round] = await db
        .insert(rounds)
        .values({
          rulesetId: 1,
          answer: 'TESTS',
          salt: 'test-salt',
          commitHash: 'test-hash',
          prizePoolEth: '0.5',
          seedNextRoundEth: '0.03', // At cap
        })
        .returning();

      // Get or create system state
      let [state] = await db.select().from(systemState).limit(1);
      if (!state) {
        [state] = await db
          .insert(systemState)
          .values({ creatorBalanceEth: '0' })
          .returning();
      }

      const initialCreatorBalance = parseFloat(state.creatorBalanceEth);

      // Apply economics for a 0.01 ETH guess
      // 20% = 0.002 ETH should all go to creator
      await applyPaidGuessEconomicEffects(round.id, '0.01');

      // Fetch updated round
      const [updatedRound] = await db
        .select()
        .from(rounds)
        .where(eq(rounds.id, round.id));

      // Prize pool should increase by 80% of 0.01 = 0.008
      expect(parseFloat(updatedRound.prizePoolEth)).toBeCloseTo(0.5 + 0.008, 6);

      // Seed should remain at cap
      expect(parseFloat(updatedRound.seedNextRoundEth)).toBeCloseTo(0.03, 6);

      // Creator balance should increase by full 20%
      const [updatedState] = await db.select().from(systemState).limit(1);
      expect(parseFloat(updatedState.creatorBalanceEth)).toBeCloseTo(
        initialCreatorBalance + 0.002,
        6
      );

      // Clean up
      await db.delete(rounds).where(eq(rounds.id, round.id));
    });
  });

  describe('resolveRoundAndCreatePayouts', () => {
    it('should create payouts with 80% winner, 10% referrer, 10% top guessers', async () => {
      // Create test users (use unique FIDs to avoid conflicts)
      const [winner] = await db
        .insert(users)
        .values({
          fid: 88888,
          referrerFid: 77777,
          xp: 0,
        })
        .returning();

      const [referrer] = await db
        .insert(users)
        .values({
          fid: 77777,
          xp: 0,
        })
        .returning();

      // Create test round with 1 ETH jackpot
      const [round] = await db
        .insert(rounds)
        .values({
          rulesetId: 1,
          answer: 'TESTS',
          salt: 'test-salt',
          commitHash: 'test-hash',
          prizePoolEth: '1.0',
          seedNextRoundEth: '0.05',
        })
        .returning();

      // Create some paid guesses from other users (for top 10)
      await db.insert(guesses).values([
        { roundId: round.id, fid: 11111, word: 'WRONG', isPaid: true, isCorrect: false },
        { roundId: round.id, fid: 11111, word: 'NOPE', isPaid: true, isCorrect: false },
        { roundId: round.id, fid: 22222, word: 'BAD', isPaid: true, isCorrect: false },
      ]);

      // Resolve round and create payouts
      await resolveRoundAndCreatePayouts(round.id, winner.fid);

      // Check that payouts were created
      const payouts = await db
        .select()
        .from(roundPayouts)
        .where(eq(roundPayouts.roundId, round.id));

      // Should have 4 payouts: winner, referrer, and 2 top guessers
      expect(payouts.length).toBe(4);

      // Check winner payout (80%)
      const winnerPayout = payouts.find((p) => p.role === 'winner');
      expect(winnerPayout).toBeDefined();
      expect(winnerPayout!.fid).toBe(winner.fid);
      expect(parseFloat(winnerPayout!.amountEth)).toBeCloseTo(0.8, 6);

      // Check referrer payout (10%)
      const referrerPayout = payouts.find((p) => p.role === 'referrer');
      expect(referrerPayout).toBeDefined();
      expect(referrerPayout!.fid).toBe(referrer.fid);
      expect(parseFloat(referrerPayout!.amountEth)).toBeCloseTo(0.1, 6);

      // Check top guesser payouts (10% / 2 = 0.05 each)
      const topGuessersPayouts = payouts.filter((p) => p.role === 'top_guesser');
      expect(topGuessersPayouts.length).toBe(2);
      topGuessersPayouts.forEach((p) => {
        expect(parseFloat(p.amountEth)).toBeCloseTo(0.05, 6);
      });

      // Check round is marked as resolved
      const [resolvedRound] = await db
        .select()
        .from(rounds)
        .where(eq(rounds.id, round.id));
      expect(resolvedRound.resolvedAt).not.toBeNull();
      expect(resolvedRound.winnerFid).toBe(winner.fid);

      // Clean up
      await db.delete(roundPayouts).where(eq(roundPayouts.roundId, round.id));
      await db.delete(guesses).where(eq(guesses.roundId, round.id));
      await db.delete(rounds).where(eq(rounds.id, round.id));
      await db.delete(users).where(eq(users.fid, winner.fid));
      await db.delete(users).where(eq(users.fid, referrer.fid));
    });

    it('should allocate referrer share to seed + creator when no referrer exists (Milestone 4.9)', async () => {
      // Create winner without referrer (use unique FID to avoid conflicts)
      const [winner] = await db
        .insert(users)
        .values({
          fid: 99999,
          referrerFid: null,
          xp: 0,
        })
        .returning();

      // Create test round with seed below cap
      const [round] = await db
        .insert(rounds)
        .values({
          rulesetId: 1,
          answer: 'TESTS',
          salt: 'test-salt',
          commitHash: 'test-hash',
          prizePoolEth: '1.0',
          seedNextRoundEth: '0.02', // Below 0.03 cap
        })
        .returning();

      // Get or create system state
      let [state] = await db.select().from(systemState).limit(1);
      if (!state) {
        [state] = await db
          .insert(systemState)
          .values({ creatorBalanceEth: '0' })
          .returning();
      }
      const initialCreatorBalance = parseFloat(state.creatorBalanceEth);

      // Resolve round
      await resolveRoundAndCreatePayouts(round.id, winner.fid);

      // Check payouts
      const payouts = await db
        .select()
        .from(roundPayouts)
        .where(eq(roundPayouts.roundId, round.id));

      // Should NOT have a referrer payout to the winner
      const referrerPayout = payouts.find((p) => p.role === 'referrer');
      expect(referrerPayout).toBeUndefined();

      // Should have seed and creator payouts instead
      const seedPayout = payouts.find((p) => p.role === 'seed');
      const creatorPayout = payouts.find((p) => p.role === 'creator');

      // 10% = 0.1 ETH referrer share
      // Seed can take 0.01 (to reach 0.03 cap from 0.02)
      // Creator gets remaining 0.09
      expect(seedPayout).toBeDefined();
      expect(seedPayout!.fid).toBeNull();
      expect(parseFloat(seedPayout!.amountEth)).toBeCloseTo(0.01, 6);

      expect(creatorPayout).toBeDefined();
      expect(creatorPayout!.fid).toBeNull();
      expect(parseFloat(creatorPayout!.amountEth)).toBeCloseTo(0.09, 6);

      // Check round seed was updated
      const [updatedRound] = await db
        .select()
        .from(rounds)
        .where(eq(rounds.id, round.id));
      expect(parseFloat(updatedRound.seedNextRoundEth)).toBeCloseTo(0.03, 6); // At cap

      // Check creator balance was updated
      const [updatedState] = await db.select().from(systemState).limit(1);
      expect(parseFloat(updatedState.creatorBalanceEth)).toBeCloseTo(
        initialCreatorBalance + 0.09,
        6
      );

      // Clean up
      await db.delete(roundPayouts).where(eq(roundPayouts.roundId, round.id));
      await db.delete(rounds).where(eq(rounds.id, round.id));
      await db.delete(users).where(eq(users.fid, winner.fid));
    });

    it('should handle rounds with zero jackpot gracefully', async () => {
      // Create test round with zero jackpot
      const [round] = await db
        .insert(rounds)
        .values({
          rulesetId: 1,
          answer: 'TESTS',
          salt: 'test-salt',
          commitHash: 'test-hash',
          prizePoolEth: '0',
          seedNextRoundEth: '0',
        })
        .returning();

      // Should not throw error
      await expect(resolveRoundAndCreatePayouts(round.id, 12345)).resolves.not.toThrow();

      // No payouts should be created
      const payouts = await db
        .select()
        .from(roundPayouts)
        .where(eq(roundPayouts.roundId, round.id));

      expect(payouts.length).toBe(0);

      // Clean up
      await db.delete(rounds).where(eq(rounds.id, round.id));
    });
  });

  describe('createNextRoundFromSeed', () => {
    it('should initialize new round with seed from previous round', async () => {
      // Create previous round with seed
      const [prevRound] = await db
        .insert(rounds)
        .values({
          rulesetId: 1,
          answer: 'PREV',
          salt: 'prev-salt',
          commitHash: 'prev-hash',
          prizePoolEth: '0.5',
          seedNextRoundEth: '0.08', // Seed to carry forward
          resolvedAt: new Date(),
        })
        .returning();

      // Create next round from seed
      const newRoundId = await createNextRoundFromSeed(
        prevRound.id,
        'NEXTS',
        'new-salt',
        'new-hash',
        1
      );

      // Fetch new round
      const [newRound] = await db
        .select()
        .from(rounds)
        .where(eq(rounds.id, newRoundId));

      // Prize pool should be initialized with previous round's seed
      expect(parseFloat(newRound.prizePoolEth)).toBeCloseTo(0.08, 6);

      // Seed should be reset to 0
      expect(parseFloat(newRound.seedNextRoundEth)).toBeCloseTo(0, 6);

      // Other fields should be correct
      expect(newRound.answer).toBe('NEXTS');
      expect(newRound.salt).toBe('new-salt');
      expect(newRound.commitHash).toBe('new-hash');
      expect(newRound.resolvedAt).toBeNull();

      // Clean up
      await db.delete(rounds).where(eq(rounds.id, newRoundId));
      await db.delete(rounds).where(eq(rounds.id, prevRound.id));
    });

    it('should work when previous round has zero seed', async () => {
      // Create previous round with zero seed
      const [prevRound] = await db
        .insert(rounds)
        .values({
          rulesetId: 1,
          answer: 'PREV',
          salt: 'prev-salt',
          commitHash: 'prev-hash',
          prizePoolEth: '1.0',
          seedNextRoundEth: '0', // No seed
          resolvedAt: new Date(),
        })
        .returning();

      // Create next round from seed
      const newRoundId = await createNextRoundFromSeed(
        prevRound.id,
        'NEXTS',
        'new-salt',
        'new-hash',
        1
      );

      // Fetch new round
      const [newRound] = await db
        .select()
        .from(rounds)
        .where(eq(rounds.id, newRoundId));

      // Prize pool should be 0
      expect(parseFloat(newRound.prizePoolEth)).toBeCloseTo(0, 6);

      // Seed should also be 0
      expect(parseFloat(newRound.seedNextRoundEth)).toBeCloseTo(0, 6);

      // Clean up
      await db.delete(rounds).where(eq(rounds.id, newRoundId));
      await db.delete(rounds).where(eq(rounds.id, prevRound.id));
    });
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  applyPaidGuessEconomicEffects,
  resolveRoundAndCreatePayouts,
  createNextRoundFromSeed,
} from './economics';
import { db } from '../db';
import {
  rounds,
  systemState,
  roundPayouts,
  guesses,
  users,
  announcerEvents,
  wordRewards,
} from '../db/schema';
import { eq, inArray } from 'drizzle-orm';

/**
 * Comprehensive tests for Milestone 3.1 - Economics Module
 *
 * Tests cover:
 * - applyPaidGuessEconomicEffects: 80/20 split with seed cap
 * - resolveRoundAndCreatePayouts: 80/10/10 jackpot split
 * - createNextRoundFromSeed: round creation with seed initialization
 */

/**
 * ETH amount of a payout row.
 *
 * `amount_eth` became nullable when $WORD payouts arrived — a $WORD row
 * carries `amount_word` and leaves this null. Every round in this file is an
 * ETH round, so a null here means the row was written in the wrong currency,
 * which is worth failing on rather than quietly reading as NaN.
 */
function ethAmount(payout: { amountEth: string | null }): number {
  expect(payout.amountEth).not.toBeNull();
  return parseFloat(payout.amountEth!);
}

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
          seedNextRoundEth: '0.01', // Below 0.02 cap
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
      expect(parseFloat(updated.seedNextRoundEth)).toBeCloseTo(0.01 + 0.0002, 6);

      // Clean up
      await db.delete(rounds).where(eq(rounds.id, round.id));
    });

    it('should cap seed at 0.02 ETH and overflow to creator balance', async () => {
      // Create a test round with seed near cap
      const [round] = await db
        .insert(rounds)
        .values({
          rulesetId: 1,
          answer: 'TESTS',
          salt: 'test-salt',
          commitHash: 'test-hash',
          prizePoolEth: '0.1',
          seedNextRoundEth: '0.015', // Close to 0.02 cap
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
      // Only 0.005 can fit in seed (0.02 - 0.015 = 0.005)
      // Remaining 0.005 should go to creator balance
      await applyPaidGuessEconomicEffects(round.id, '0.05');

      // Fetch updated round
      const [updatedRound] = await db
        .select()
        .from(rounds)
        .where(eq(rounds.id, round.id));

      // Prize pool should increase by 80% of 0.05 = 0.04
      expect(parseFloat(updatedRound.prizePoolEth)).toBeCloseTo(0.1 + 0.04, 6);

      // Seed should be capped at 0.02
      expect(parseFloat(updatedRound.seedNextRoundEth)).toBeCloseTo(0.02, 6);

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
          seedNextRoundEth: '0.02', // At cap
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
      expect(parseFloat(updatedRound.seedNextRoundEth)).toBeCloseTo(0.02, 6);

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
    it('should create payouts with 80% winner, 5% referrer, 10% top guessers, 5% seed', async () => {
      // Create test users (use unique FIDs to avoid conflicts).
      //
      // Every FID that can receive a payout needs a wallet: resolveRound calls
      // getWinnerPayoutAddress for the winner, the referrer AND each top
      // guesser, and it throws rather than silently skipping someone who has
      // no address. That is correct — you cannot pay an account you cannot
      // identify — so the test has to supply them.
      // Clear first, not only at the end: these tests clean up on their last
      // line, so any failure leaves the rows behind and every later run dies
      // on the unique FID constraint instead of on its own assertion.
      await db.delete(users).where(inArray(users.fid, [88888, 77777, 11111, 22222]));

      const [winner] = await db
        .insert(users)
        .values({
          fid: 88888,
          referrerFid: 77777,
          signerWalletAddress: '0x1111111111111111111111111111111111111111',
          xp: 0,
        })
        .returning();

      const [referrer] = await db
        .insert(users)
        .values({
          fid: 77777,
          signerWalletAddress: '0x2222222222222222222222222222222222222222',
          xp: 0,
        })
        .returning();

      await db.insert(users).values([
        { fid: 11111, signerWalletAddress: '0x3333333333333333333333333333333333333333', xp: 0 },
        { fid: 22222, signerWalletAddress: '0x4444444444444444444444444444444444444444', xp: 0 },
      ]);

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

      // winner, referrer, 2 top guessers, seed, and the creator overflow the
      // capped seed produces on a pool this large.
      expect(payouts.length).toBe(6);

      // Check winner payout (80%)
      const winnerPayout = payouts.find((p) => p.role === 'winner');
      expect(winnerPayout).toBeDefined();
      expect(winnerPayout!.fid).toBe(winner.fid);
      expect(ethAmount(winnerPayout!)).toBeCloseTo(0.8, 6);

      // Check referrer payout (5%)
      const referrerPayout = payouts.find((p) => p.role === 'referrer');
      expect(referrerPayout).toBeDefined();
      expect(referrerPayout!.fid).toBe(referrer.fid);
      expect(ethAmount(referrerPayout!)).toBeCloseTo(0.05, 6);

      // Top guessers share 10%, tiered rather than split evenly (Milestone
      // 6.9b): with two of them the 1900/1600 bps weights renormalise to
      // 5428/4571 of the bucket, and the rounding dust goes to rank 1.
      const topGuessersPayouts = payouts.filter((p) => p.role === 'top_guesser');
      expect(topGuessersPayouts.length).toBe(2);
      const topGuesserAmounts = topGuessersPayouts
        .map(ethAmount)
        .sort((a, b) => b - a);
      expect(topGuesserAmounts[0]).toBeCloseTo(0.05429, 5);
      expect(topGuesserAmounts[1]).toBeCloseTo(0.04571, 5);
      expect(topGuesserAmounts[0] + topGuesserAmounts[1]).toBeCloseTo(0.1, 6);

      // Seed is 5%, capped at 0.02 ETH; the 0.03 above the cap goes to the
      // creator, so the six payouts still sum to the whole pool.
      const seedPayout = payouts.find((p) => p.role === 'seed');
      expect(ethAmount(seedPayout!)).toBeCloseTo(0.02, 6);
      const creatorPayout = payouts.find((p) => p.role === 'creator');
      expect(ethAmount(creatorPayout!)).toBeCloseTo(0.03, 6);
      const total = payouts.reduce((sum, p) => sum + ethAmount(p), 0);
      expect(total).toBeCloseTo(1.0, 6);

      // Check round is marked as resolved
      const [resolvedRound] = await db
        .select()
        .from(rounds)
        .where(eq(rounds.id, round.id));
      expect(resolvedRound.resolvedAt).not.toBeNull();
      expect(resolvedRound.winnerFid).toBe(winner.fid);

      // Clean up. announcer_events and word_rewards both have a FK to rounds
      // and resolution writes into them, so the round cannot be deleted until
      // those rows go first.
      await db.delete(announcerEvents).where(eq(announcerEvents.roundId, round.id));
      await db.delete(wordRewards).where(eq(wordRewards.roundId, round.id));
      await db.delete(roundPayouts).where(eq(roundPayouts.roundId, round.id));
      await db.delete(guesses).where(eq(guesses.roundId, round.id));
      await db.delete(rounds).where(eq(rounds.id, round.id));
      await db.delete(users).where(eq(users.fid, winner.fid));
      await db.delete(users).where(eq(users.fid, referrer.fid));
      await db.delete(users).where(eq(users.fid, 11111));
      await db.delete(users).where(eq(users.fid, 22222));
    });

    it('should allocate referrer share to seed + creator when no referrer exists (Milestone 4.9)', async () => {
      await db.delete(users).where(eq(users.fid, 99999));

      // Create winner without referrer (use unique FID to avoid conflicts)
      const [winner] = await db
        .insert(users)
        .values({
          fid: 99999,
          referrerFid: null,
          signerWalletAddress: '0x5555555555555555555555555555555555555555',
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
          seedNextRoundEth: '0.01', // Below 0.02 cap
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

      // The referrer's 5% is halved: 2.5% to the top 10 and 2.5% to the seed,
      // giving an uncapped seed of 7.5% = 0.075 ETH. That is over the 0.02 cap,
      // so the seed takes 0.02 and the creator takes the remaining 0.055.
      expect(seedPayout).toBeDefined();
      expect(seedPayout!.fid).toBeNull();
      expect(ethAmount(seedPayout!)).toBeCloseTo(0.02, 6);

      expect(creatorPayout).toBeDefined();
      expect(creatorPayout!.fid).toBeNull();
      expect(ethAmount(creatorPayout!)).toBeCloseTo(0.055, 6);

      // Nobody else guessed, so the winner also takes the 12.5% top-10 bucket
      // as a second row rather than it being left unallocated.
      const winnerTopTen = payouts.find((p) => p.role === 'top_guesser');
      expect(winnerTopTen).toBeDefined();
      expect(winnerTopTen!.fid).toBe(winner.fid);
      expect(ethAmount(winnerTopTen!)).toBeCloseTo(0.125, 6);

      // Check round seed was updated
      const [updatedRound] = await db
        .select()
        .from(rounds)
        .where(eq(rounds.id, round.id));
      expect(parseFloat(updatedRound.seedNextRoundEth)).toBeCloseTo(0.02, 6); // At cap

      // Check creator balance was updated
      const [updatedState] = await db.select().from(systemState).limit(1);
      expect(parseFloat(updatedState.creatorBalanceEth)).toBeCloseTo(
        initialCreatorBalance + 0.055,
        6
      );

      // Clean up. announcer_events and word_rewards both have a FK to rounds
      // and resolution writes into them, so the round cannot be deleted until
      // those rows go first.
      await db.delete(announcerEvents).where(eq(announcerEvents.roundId, round.id));
      await db.delete(wordRewards).where(eq(wordRewards.roundId, round.id));
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

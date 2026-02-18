import { db, gameRules, rounds } from '../db';
import { eq } from 'drizzle-orm';
import type { GameRules, GameRulesConfig } from '../types';
import { getWordHolderBonusGuesses } from '../../config/economy';

/**
 * Default ruleset configuration (v1)
 * Note: wordBonusGuesses is now dynamic based on market cap (Milestone 5.4c)
 */
export const DEFAULT_RULES_CONFIG: GameRulesConfig = {
  freeGuessesPerDayBase: 1,
  wordBonusGuesses: getWordHolderBonusGuesses(), // Dynamic: 2 if mcap < $250k, 3 if >= $250k
  shareBonusGuesses: 1,
  paidGuessPackSize: 3, // Buy 3 guesses at a time
  paidGuessPackPriceEth: '0.0003', // 0.0003 ETH per pack of 3
  maxPaidPacksPerDay: 3, // Max 3 packs per day
  maxPaidGuessesPerDay: 9, // 3 packs × 3 guesses = 9 total
  jackpotSplit: {
    winner: 0.8,
    referrer: 0.1,
    top10: 0.1,
  },
  seedCapEth: '0.02', // Updated from 0.03 in seed cap reduction
  wordThreshold: '100000000',
};

/**
 * Get the current active game rules (default ruleset ID 1)
 */
export async function getCurrentRules(): Promise<GameRules> {
  const result = await db
    .select()
    .from(gameRules)
    .where(eq(gameRules.id, 1))
    .limit(1);

  if (result.length === 0) {
    throw new Error('No game rules found with ID 1. Please run seed script.');
  }

  return {
    id: result[0].id,
    name: result[0].name,
    config: result[0].config,
    createdAt: result[0].createdAt,
    updatedAt: result[0].updatedAt,
  };
}

/**
 * Get game rules for a specific round
 */
export async function getRulesForRound(roundId: number): Promise<GameRules> {
  // Get the round
  const roundResult = await db
    .select()
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .limit(1);

  if (roundResult.length === 0) {
    throw new Error(`Round ${roundId} not found`);
  }

  const round = roundResult[0];

  // Get the ruleset
  const rulesResult = await db
    .select()
    .from(gameRules)
    .where(eq(gameRules.id, round.rulesetId))
    .limit(1);

  if (rulesResult.length === 0) {
    throw new Error(`Game rules ${round.rulesetId} not found for round ${roundId}`);
  }

  return {
    id: rulesResult[0].id,
    name: rulesResult[0].name,
    config: rulesResult[0].config,
    createdAt: rulesResult[0].createdAt,
    updatedAt: rulesResult[0].updatedAt,
  };
}

/**
 * Get a game rules by ID
 */
export async function getRulesById(rulesetId: number): Promise<GameRules> {
  const result = await db
    .select()
    .from(gameRules)
    .where(eq(gameRules.id, rulesetId))
    .limit(1);

  if (result.length === 0) {
    throw new Error(`Game rules ${rulesetId} not found`);
  }

  return {
    id: result[0].id,
    name: result[0].name,
    config: result[0].config,
    createdAt: result[0].createdAt,
    updatedAt: result[0].updatedAt,
  };
}

/**
 * Dev Mode Game State Synthesis
 * Milestone 4.8 — Dev mode backend for previewing and testing all input states
 * Milestone 4.12 — Updated to use CoinGecko for ETH/USD conversion
 *
 * This module provides utilities for generating synthetic game states
 * for development, preview, and testing purposes.
 */

import type { GameStateResponse, DevBackendState } from '../types';
import { getEthUsdPrice } from './prices';
import { db, rounds, gameRules } from '../db';
import { isNull, desc, eq } from 'drizzle-orm';
import { createCommitment } from './commit-reveal';

/**
 * Ensure a game rule exists for dev mode rounds
 * Creates one if it doesn't exist, returns the ID
 *
 * Note: Uses try/catch to handle race conditions where multiple requests
 * try to create the same row simultaneously (unique constraint on name).
 */
async function ensureDevGameRule(): Promise<number> {
  // Check if any game rule exists
  const existingRule = await db
    .select({ id: gameRules.id })
    .from(gameRules)
    .limit(1);

  if (existingRule.length > 0) {
    return existingRule[0].id;
  }

  // Create a default game rule for dev mode
  console.log('🎮 Dev mode: Creating default game rule');
  try {
    const [newRule] = await db
      .insert(gameRules)
      .values({
        name: 'dev_default',
        config: {
          freeGuessesPerDay: 1,
          paidGuessPackSize: 3,
          paidGuessPackPriceEth: '0.0003',
          maxPaidPacksPerDay: 3,
          clanktonBonusGuesses: 2,
          clanktonBonusThreshold: 100000000,
          shareBonusGuesses: 1,
          prizePoolSplit: {
            winner: 0.8,
            referrer: 0.1,
            topGuessers: 0.1,
          },
        },
      })
      .returning();

    console.log(`🎮 Dev mode: Created game rule with id=${newRule.id}`);
    return newRule.id;
  } catch (error: any) {
    // Handle race condition: if another request created the row first,
    // fetch and return the existing row
    if (error.code === '23505' || error.message?.includes('unique constraint')) {
      console.log('🔄 Race condition in ensureDevGameRule, fetching existing row');
      const [existingRow] = await db
        .select({ id: gameRules.id })
        .from(gameRules)
        .limit(1);

      if (existingRow) {
        return existingRow.id;
      }
    }
    // Re-throw unexpected errors
    throw error;
  }
}

/**
 * Parameters for synthesizing dev game state
 */
export interface SynthesizeDevStateParams {
  devState?: DevBackendState;
  devInput?: string;
  solution: string;
  fid: number;
  guessCount?: number; // How many guesses user has made this round
}

/**
 * Synthesize a dev game state for preview/testing
 *
 * Used in two scenarios:
 * 1. Forced-state preview (devState provided) - returns snapshot for QC/screenshots
 * 2. Interactive dev mode (no devState) - returns fresh round for interactive play
 *
 * NOTE: For USD conversion, use synthesizeDevGameStateAsync() instead to fetch live prices
 *
 * @param params - State synthesis parameters
 * @returns GameStateResponse with synthetic data (hardcoded USD price)
 */
export function synthesizeDevGameState(
  params: SynthesizeDevStateParams
): GameStateResponse {
  const { devState, devInput, solution, fid, guessCount = 0 } = params;

  // Base game state
  const baseState: GameStateResponse = {
    roundId: 999999, // Synthetic round ID
    prizePoolEth: '0.42',
    prizePoolUsd: '1260.00', // Hardcoded fallback - use synthesizeDevGameStateAsync for live prices
    globalGuessCount: 73,
    userState: {
      fid,
      freeGuessesRemaining: 3,
      paidGuessesRemaining: 0,
      totalGuessesRemaining: 3,
      clanktonBonusActive: false,
    },
    wheelWords: generateWheelWords(devState, devInput, solution),
    devMode: true,
    devSolution: solution,
  };

  // If devState is provided, add it to response (forced preview mode)
  if (devState) {
    baseState.devState = devState;
    baseState.devInput = devInput;

    // Adjust user state based on devState
    if (devState === 'OUT_OF_GUESSES') {
      baseState.userState.freeGuessesRemaining = 0;
      baseState.userState.paidGuessesRemaining = 0;
      baseState.userState.totalGuessesRemaining = 0;
    }

    // For RESULT states, adjust wheel words to include the guess
    if (devState === 'RESULT_WRONG_VALID' && devInput) {
      // Add the wrong guess to wheel words if not already there
      if (!baseState.wheelWords.includes(devInput.toLowerCase())) {
        baseState.wheelWords.push(devInput.toLowerCase());
      }
    }
  }

  return baseState;
}

/**
 * Generate wheel words based on state
 * Returns a mix of seed words and wrong guesses
 */
function generateWheelWords(
  devState?: DevBackendState,
  devInput?: string,
  solution?: string
): string[] {
  // Default seed words for wheel
  const seedWords = [
    'words',
    'games',
    'brain',
    'think',
    'smart',
    'plays',
    'solve',
    'logic',
  ];

  // If we have a wrong guess result, include the input
  if (devState === 'RESULT_WRONG_VALID' && devInput) {
    const wrongGuess = devInput.toLowerCase();
    if (!seedWords.includes(wrongGuess) && wrongGuess !== solution?.toLowerCase()) {
      return [...seedWords, wrongGuess];
    }
  }

  return seedWords;
}

/**
 * Synthesize a dev game state with live ETH/USD conversion (async)
 * Milestone 4.12 — Uses CoinGecko for real-time price
 *
 * Same as synthesizeDevGameState but fetches live ETH/USD price from CoinGecko
 *
 * @param params - State synthesis parameters
 * @returns GameStateResponse with synthetic data and live USD conversion
 */
export async function synthesizeDevGameStateAsync(
  params: SynthesizeDevStateParams
): Promise<GameStateResponse> {
  const { devState, devInput, solution, fid, guessCount = 0 } = params;

  // Fetch live ETH/USD price
  const ethUsdRate = await getEthUsdPrice();
  const prizePoolEthNum = 0.42;
  const prizePoolUsd = ethUsdRate != null
    ? (prizePoolEthNum * ethUsdRate).toFixed(2)
    : '1260.00'; // Fallback to hardcoded value

  // Base game state with live USD price
  const baseState: GameStateResponse = {
    roundId: 999999, // Synthetic round ID
    prizePoolEth: '0.42',
    prizePoolUsd,
    globalGuessCount: 73,
    userState: {
      fid,
      freeGuessesRemaining: 3,
      paidGuessesRemaining: 0,
      totalGuessesRemaining: 3,
      clanktonBonusActive: false,
    },
    wheelWords: generateWheelWords(devState, devInput, solution),
    devMode: true,
    devSolution: solution,
  };

  // If devState is provided, add it to response (forced preview mode)
  if (devState) {
    baseState.devState = devState;
    baseState.devInput = devInput;

    // Adjust user state based on devState
    if (devState === 'OUT_OF_GUESSES') {
      baseState.userState.freeGuessesRemaining = 0;
      baseState.userState.paidGuessesRemaining = 0;
      baseState.userState.totalGuessesRemaining = 0;
    }

    // For RESULT states, adjust wheel words to include the guess
    if (devState === 'RESULT_WRONG_VALID' && devInput) {
      // Add the wrong guess to wheel words if not already there
      if (!baseState.wheelWords.includes(devInput.toLowerCase())) {
        baseState.wheelWords.push(devInput.toLowerCase());
      }
    }
  }

  return baseState;
}

/**
 * Check if dev mode is enabled
 * Uses NEXT_PUBLIC_ prefix so it works on both client and server
 */
export function isDevModeEnabled(): boolean {
  return process.env.NEXT_PUBLIC_LHAW_DEV_MODE === 'true';
}

/**
 * Check if forced-state preview is enabled
 */
export function isForceStateEnabled(): boolean {
  return process.env.LHAW_DEV_FORCE_STATE_ENABLED === 'true';
}

/**
 * Get the fixed solution for dev mode
 * Defaults to 'CRANE' if not set
 */
export function getDevFixedSolution(): string {
  return (process.env.LHAW_DEV_FIXED_SOLUTION || 'CRANE').toUpperCase();
}

/**
 * Get the dev user ID
 * Defaults to 12345 if not set
 */
export function getDevUserId(): number {
  const devUserId = process.env.LHAW_DEV_USER_ID;
  return devUserId ? parseInt(devUserId, 10) : 12345;
}

/**
 * Validate dev backend state
 * Returns true if the state is a valid backend-owned state
 */
export function isValidDevBackendState(state: string): state is DevBackendState {
  const validStates: DevBackendState[] = [
    'SUBMITTING',
    'RESULT_CORRECT',
    'RESULT_WRONG_VALID',
    'OUT_OF_GUESSES',
  ];
  return validStates.includes(state as DevBackendState);
}

/**
 * Generate seeded wrong words for dev mode
 * Milestone 4.14 — Pre-populate ~20% of wheel words as "wrong" for visual testing
 *
 * @param guessWords - Full list of valid guess words
 * @param answerWord - The correct answer (excluded from wrong words)
 * @returns Set of words to mark as "wrong"
 */
export function getDevModeSeededWrongWords(
  guessWords: string[],
  answerWord: string
): Set<string> {
  if (!isDevModeEnabled()) {
    return new Set();
  }

  const total = guessWords.length;
  const target = Math.floor(total * 0.2); // 20% of words
  const picked = new Set<string>();

  // Use a deterministic seed based on answer word for consistent results
  // (This ensures the same answer always generates the same set of wrong words)
  const seedValue = answerWord.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);

  // Simple seeded random number generator
  let seed = seedValue;
  const seededRandom = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  // Pick random words excluding the answer
  while (picked.size < target) {
    const randomIndex = Math.floor(seededRandom() * total);
    const word = guessWords[randomIndex].toUpperCase();
    if (word !== answerWord.toUpperCase()) {
      picked.add(word);
    }
  }

  console.log(`🎮 Dev mode: Generated ${picked.size} seeded wrong words (20% of ${total})`);
  return picked;
}

/**
 * Ensure a dev round exists with the fixed solution
 * Milestone 6.5.1 — Dev Mode Guess Economy Parity
 *
 * This function ensures there's an active round in dev mode with the fixed solution.
 * If no active round exists, or if the active round has a different answer,
 * it creates a new round with the fixed solution.
 *
 * This allows dev mode to use the exact same daily limits logic as production,
 * while still having a known answer for testing.
 *
 * @returns The active round's ID
 */
export async function ensureDevRound(): Promise<number> {
  if (!isDevModeEnabled()) {
    throw new Error('ensureDevRound should only be called in dev mode');
  }

  const fixedSolution = getDevFixedSolution();

  // Check if there's an active round with the correct answer
  const existingRound = await db
    .select()
    .from(rounds)
    .where(isNull(rounds.resolvedAt))
    .orderBy(desc(rounds.startedAt))
    .limit(1);

  if (existingRound.length > 0) {
    const round = existingRound[0];

    // If the existing round has the correct answer, use it
    if (round.answer === fixedSolution) {
      console.log(`🎮 Dev mode: Using existing round ${round.id} with answer ${fixedSolution}`);
      return round.id;
    }

    // Otherwise, resolve the old round and create a new one
    console.log(`🎮 Dev mode: Resolving round ${round.id} (answer mismatch: ${round.answer} != ${fixedSolution})`);
    await db
      .update(rounds)
      .set({ resolvedAt: new Date() })
      .where(isNull(rounds.resolvedAt));
  }

  // Create a new round with the fixed solution
  console.log(`🎮 Dev mode: Creating new round with answer ${fixedSolution}`);
  const { salt, commitHash } = createCommitment(fixedSolution);

  // Ensure a game rule exists (creates one if needed)
  const rulesetId = await ensureDevGameRule();

  // Random initial prize pool between 0.03 and 0.4 ETH
  const initialPrizePool = (0.03 + Math.random() * 0.37).toFixed(4);

  const [newRound] = await db
    .insert(rounds)
    .values({
      rulesetId,
      answer: fixedSolution,
      salt,
      commitHash,
      prizePoolEth: initialPrizePool,
      seedNextRoundEth: '0',
      winnerFid: null,
      referrerFid: null,
      isDevTestRound: true,
      startedAt: new Date(),
      resolvedAt: null,
    })
    .returning();

  console.log(`🎮 Dev mode: Created round ${newRound.id} with answer ${fixedSolution}, prize pool ${initialPrizePool} ETH`);
  return newRound.id;
}

/**
 * Simple seeded random number generator for deterministic "random" values
 * Same seed always produces same sequence of numbers
 */
function seededRandom(seed: number): () => number {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

/**
 * Get the current dev round's status from the database
 * Returns the actual prize pool (affected by pack purchases) with deterministic display values
 * Display values are "random" but consistent for the same round (won't change on poll)
 */
export async function getDevRoundStatus(): Promise<{
  roundId: number;
  prizePoolEth: string;
  globalGuessCount: number;
}> {
  const actualRoundId = await ensureDevRound();

  const [round] = await db
    .select()
    .from(rounds)
    .where(eq(rounds.id, actualRoundId))
    .limit(1);

  if (!round) {
    throw new Error('Dev round not found after ensureDevRound');
  }

  // Generate deterministic "random" values based on actual round ID
  // These will be consistent for the same round, only change when a new round is created
  const rng = seededRandom(actualRoundId);
  const displayRoundId = Math.floor(5 + rng() * 296); // 5-300
  const displayGuessCount = Math.floor(100 + rng() * 5900); // 100-6000

  return {
    roundId: displayRoundId,
    prizePoolEth: round.prizePoolEth, // Actual value from database
    globalGuessCount: displayGuessCount,
  };
}

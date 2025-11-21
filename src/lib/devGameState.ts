/**
 * Dev Mode Game State Synthesis
 * Milestone 4.8 — Dev mode backend for previewing and testing all input states
 *
 * This module provides utilities for generating synthetic game states
 * for development, preview, and testing purposes.
 */

import type { GameStateResponse, DevBackendState } from '../types';

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
 * @param params - State synthesis parameters
 * @returns GameStateResponse with synthetic data
 */
export function synthesizeDevGameState(
  params: SynthesizeDevStateParams
): GameStateResponse {
  const { devState, devInput, solution, fid, guessCount = 0 } = params;

  // Base game state
  const baseState: GameStateResponse = {
    roundId: 999999, // Synthetic round ID
    prizePoolEth: '0.42',
    prizePoolUsd: '1260.00',
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
 * Check if dev mode is enabled
 */
export function isDevModeEnabled(): boolean {
  return process.env.LHAW_DEV_MODE === 'true';
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

/**
 * useGuessInput Hook
 * Milestone 6.4 — Task 3.1: Guess Input Row Tap/Focus Logic
 *
 * Centralized state machine for the 5-letter input row.
 * Defines predictable, consistent behavior across all input states.
 *
 * Rules:
 * 1. Empty row: Tapping any box focuses the first box; typing fills left-to-right
 * 2. Partial/full row: Tapping does nothing; typing appends; backspace deletes from right
 * 3. Error/red state: Taps and input are ignored until state resets
 * 4. Out of guesses: Input disabled; taps and input do nothing
 * 5. Submitting: Input locked; no changes allowed
 */

import { useCallback, useMemo } from 'react';
import type { InputState } from '../lib/input-state';

export interface UseGuessInputOptions {
  letters: string[];
  inputState: InputState;
  disabled?: boolean;
}

export interface UseGuessInputResult {
  /**
   * Whether the input row should accept new letters
   */
  canAcceptInput: boolean;

  /**
   * Whether tapping on boxes should do anything
   */
  canHandleTap: boolean;

  /**
   * Whether backspace should work
   */
  canHandleBackspace: boolean;

  /**
   * Whether the row is in an error (red) state
   */
  isErrorState: boolean;

  /**
   * Whether the row is in a locked state (submitting or out of guesses)
   */
  isLockedState: boolean;

  /**
   * Get the next index to type into (first empty slot from left)
   */
  getNextInputIndex: () => number;

  /**
   * Get the last index to delete from (rightmost filled slot)
   */
  getLastFilledIndex: () => number;

  /**
   * Handle a letter input - returns new letters array or null if blocked
   */
  handleLetter: (letter: string) => string[] | null;

  /**
   * Handle backspace - returns new letters array or null if blocked
   */
  handleBackspace: () => string[] | null;

  /**
   * Handle box tap - returns true if tap was valid and should focus input
   */
  handleBoxTap: (boxIndex: number) => boolean;
}

/**
 * Input states that block all user interaction
 */
const LOCKED_STATES: InputState[] = [
  'SUBMITTING',
  'OUT_OF_GUESSES',
  'RESULT_CORRECT',
];

/**
 * Input states that show error feedback (red borders)
 * These block input temporarily until the state resets
 */
const ERROR_STATES: InputState[] = [
  'TYPING_FULL_INVALID_NONSENSE',
  'TYPING_FULL_INVALID_ALREADY_GUESSED',
  'RESULT_WRONG_VALID',
];

/**
 * Hook for managing guess input row behavior
 */
export function useGuessInput({
  letters,
  inputState,
  disabled = false,
}: UseGuessInputOptions): UseGuessInputResult {
  /**
   * Check if in a locked state
   */
  const isLockedState = useMemo(() => {
    return disabled || LOCKED_STATES.includes(inputState);
  }, [disabled, inputState]);

  /**
   * Check if in an error state
   */
  const isErrorState = useMemo(() => {
    return ERROR_STATES.includes(inputState);
  }, [inputState]);

  /**
   * Can accept new letter input?
   * Blocked if: disabled, locked, error state, or all 5 boxes filled
   */
  const canAcceptInput = useMemo(() => {
    if (isLockedState || isErrorState) return false;

    // Check if row is full
    const filledCount = letters.filter(l => l !== '').length;
    return filledCount < 5;
  }, [isLockedState, isErrorState, letters]);

  /**
   * Can handle tap on boxes?
   * Only allowed when row is empty and not in locked/error state
   */
  const canHandleTap = useMemo(() => {
    if (isLockedState || isErrorState) return false;

    // Only focus on tap when row is completely empty
    const filledCount = letters.filter(l => l !== '').length;
    return filledCount === 0;
  }, [isLockedState, isErrorState, letters]);

  /**
   * Can handle backspace?
   * Blocked if: disabled, locked, error state, or all boxes empty
   */
  const canHandleBackspace = useMemo(() => {
    if (isLockedState || isErrorState) return false;

    // Check if there's anything to delete
    return letters.some(l => l !== '');
  }, [isLockedState, isErrorState, letters]);

  /**
   * Get the next empty index (first empty slot from left)
   */
  const getNextInputIndex = useCallback(() => {
    const idx = letters.findIndex(l => l === '');
    return idx === -1 ? 5 : idx; // Return 5 if all filled
  }, [letters]);

  /**
   * Get the last filled index (rightmost non-empty slot)
   */
  const getLastFilledIndex = useCallback(() => {
    for (let i = letters.length - 1; i >= 0; i--) {
      if (letters[i] !== '') return i;
    }
    return -1; // Return -1 if all empty
  }, [letters]);

  /**
   * Handle a letter input
   * Returns new letters array or null if blocked
   */
  const handleLetter = useCallback(
    (letter: string): string[] | null => {
      if (!canAcceptInput) return null;

      const nextIndex = getNextInputIndex();
      if (nextIndex >= 5) return null; // Already full

      const newLetters = [...letters];
      newLetters[nextIndex] = letter.toUpperCase();
      return newLetters;
    },
    [canAcceptInput, getNextInputIndex, letters]
  );

  /**
   * Handle backspace
   * Returns new letters array or null if blocked
   */
  const handleBackspace = useCallback((): string[] | null => {
    if (!canHandleBackspace) return null;

    const lastIndex = getLastFilledIndex();
    if (lastIndex < 0) return null; // Nothing to delete

    const newLetters = [...letters];
    newLetters[lastIndex] = '';
    return newLetters;
  }, [canHandleBackspace, getLastFilledIndex, letters]);

  /**
   * Handle box tap
   * Returns true if tap should focus input, false otherwise
   *
   * Behavior:
   * - If row is empty: Allow focus (return true)
   * - If row has letters: Do nothing (return false)
   * - If in error/locked state: Do nothing (return false)
   */
  const handleBoxTap = useCallback(
    (_boxIndex: number): boolean => {
      // Only allow tap to focus when row is completely empty
      return canHandleTap;
    },
    [canHandleTap]
  );

  return {
    canAcceptInput,
    canHandleTap,
    canHandleBackspace,
    isErrorState,
    isLockedState,
    getNextInputIndex,
    getLastFilledIndex,
    handleLetter,
    handleBackspace,
    handleBoxTap,
  };
}

/**
 * Input State Haptics Hook
 * Milestone 4.7 — Haptics integration
 *
 * Monitors input state transitions and triggers appropriate haptic feedback.
 * This ensures haptics only fire when the state actually changes, not on every render.
 */

import { useEffect, useRef } from 'react';
import { haptics } from './haptics';
import { InputState } from './input-state';

/**
 * Hook to trigger haptics based on input state transitions
 *
 * @param inputState - Current input state
 *
 * Triggers haptics on these transitions:
 * - TYPING_PARTIAL -> TYPING_FULL_VALID: inputBecameValid()
 * - any -> TYPING_FULL_INVALID_*: inputBecameInvalid()
 * - any -> RESULT_CORRECT: guessSuccess()
 * - any -> RESULT_WRONG_VALID: guessWrong()
 * - any -> OUT_OF_GUESSES: outOfGuesses()
 */
export function useInputStateHaptics(inputState: InputState) {
  const prevStateRef = useRef<InputState | null>(null);

  useEffect(() => {
    const prev = prevStateRef.current;
    const curr = inputState;

    // Only trigger haptics when state actually changes
    if (prev !== curr) {
      // Transition to valid full word (e.g., typed 5th letter and it's valid)
      if (prev === 'TYPING_PARTIAL' && curr === 'TYPING_FULL_VALID') {
        void haptics.inputBecameValid();
      }

      // Transition to invalid full word (either nonsense or already guessed)
      if (
        (curr === 'TYPING_FULL_INVALID_NONSENSE' || curr === 'TYPING_FULL_INVALID_ALREADY_GUESSED') &&
        prev !== 'TYPING_FULL_INVALID_NONSENSE' &&
        prev !== 'TYPING_FULL_INVALID_ALREADY_GUESSED'
      ) {
        void haptics.inputBecameInvalid();
      }

      // Guess was correct
      if (curr === 'RESULT_CORRECT') {
        void haptics.guessSuccess();
      }

      // Guess was wrong but valid
      if (curr === 'RESULT_WRONG_VALID') {
        void haptics.guessWrong();
      }

      // User ran out of guesses
      if (curr === 'OUT_OF_GUESSES' && prev !== 'OUT_OF_GUESSES') {
        void haptics.outOfGuesses();
      }
    }

    // Update previous state
    prevStateRef.current = curr;
  }, [inputState]);
}

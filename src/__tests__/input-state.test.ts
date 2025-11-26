import { describe, it, expect } from 'vitest';
import {
  getInputState,
  getErrorMessage,
  isGuessButtonEnabled,
  isInvalidState,
  type InputState,
  type InputStateParams,
} from '../lib/input-state';

/**
 * Input State Machine Tests
 * Milestone 4.6 — Input States & Visual Behavior
 *
 * Tests the centralized input state machine to ensure consistent behavior
 * for duplicate guesses and other validation states.
 */

describe('Input State Machine', () => {
  describe('getInputState()', () => {
    const baseParams: InputStateParams = {
      letters: ['', '', '', '', ''],
      isInGuessList: true,
      isAlreadyGuessed: false,
      isSubmitting: false,
      hasGuessesLeft: true,
      resultState: 'typing',
    };

    it('should return IDLE_EMPTY for empty letters', () => {
      const result = getInputState(baseParams);
      expect(result).toBe('IDLE_EMPTY');
    });

    it('should return TYPING_PARTIAL for 1-4 letters', () => {
      const result = getInputState({
        ...baseParams,
        letters: ['S', 'H', 'A', '', ''],
      });
      expect(result).toBe('TYPING_PARTIAL');
    });

    it('should return TYPING_FULL_VALID for valid 5-letter word not already guessed', () => {
      const result = getInputState({
        ...baseParams,
        letters: ['S', 'H', 'A', 'M', 'E'],
        isInGuessList: true,
        isAlreadyGuessed: false,
      });
      expect(result).toBe('TYPING_FULL_VALID');
    });

    it('should return TYPING_FULL_INVALID_ALREADY_GUESSED for duplicate guess', () => {
      const result = getInputState({
        ...baseParams,
        letters: ['S', 'H', 'A', 'M', 'E'],
        isInGuessList: true,
        isAlreadyGuessed: true, // Already guessed!
      });
      expect(result).toBe('TYPING_FULL_INVALID_ALREADY_GUESSED');
    });

    it('should return TYPING_FULL_INVALID_NONSENSE for invalid word', () => {
      const result = getInputState({
        ...baseParams,
        letters: ['Z', 'Z', 'Z', 'Z', 'Z'],
        isInGuessList: false, // Not in dictionary
        isAlreadyGuessed: false,
      });
      expect(result).toBe('TYPING_FULL_INVALID_NONSENSE');
    });

    it('should prioritize isAlreadyGuessed over isInGuessList', () => {
      // If a word is already guessed, it should show ALREADY_GUESSED
      // even if isInGuessList is true
      const result = getInputState({
        ...baseParams,
        letters: ['S', 'H', 'A', 'M', 'E'],
        isInGuessList: true,
        isAlreadyGuessed: true,
      });
      expect(result).toBe('TYPING_FULL_INVALID_ALREADY_GUESSED');
    });

    it('should return OUT_OF_GUESSES when hasGuessesLeft is false', () => {
      const result = getInputState({
        ...baseParams,
        hasGuessesLeft: false,
      });
      expect(result).toBe('OUT_OF_GUESSES');
    });

    it('should return SUBMITTING when isSubmitting is true', () => {
      const result = getInputState({
        ...baseParams,
        letters: ['S', 'H', 'A', 'M', 'E'],
        isSubmitting: true,
      });
      expect(result).toBe('SUBMITTING');
    });

    it('should return RESULT_CORRECT when resultState is correct', () => {
      const result = getInputState({
        ...baseParams,
        resultState: 'correct',
      });
      expect(result).toBe('RESULT_CORRECT');
    });

    it('should return RESULT_WRONG_VALID when resultState is wrong', () => {
      const result = getInputState({
        ...baseParams,
        resultState: 'wrong',
      });
      expect(result).toBe('RESULT_WRONG_VALID');
    });
  });

  describe('getErrorMessage()', () => {
    it('should return "Already guessed this round" for TYPING_FULL_INVALID_ALREADY_GUESSED', () => {
      const message = getErrorMessage('TYPING_FULL_INVALID_ALREADY_GUESSED');
      expect(message).toBe('Already guessed this round');
    });

    it('should return "Not a valid word" for TYPING_FULL_INVALID_NONSENSE', () => {
      const message = getErrorMessage('TYPING_FULL_INVALID_NONSENSE');
      expect(message).toBe('Not a valid word');
    });

    it('should return "No guesses left today" for OUT_OF_GUESSES', () => {
      const message = getErrorMessage('OUT_OF_GUESSES');
      expect(message).toBe('No guesses left today');
    });

    it('should return null for non-error states', () => {
      expect(getErrorMessage('IDLE_EMPTY')).toBeNull();
      expect(getErrorMessage('TYPING_PARTIAL')).toBeNull();
      expect(getErrorMessage('TYPING_FULL_VALID')).toBeNull();
      expect(getErrorMessage('SUBMITTING')).toBeNull();
      expect(getErrorMessage('RESULT_CORRECT')).toBeNull();
      expect(getErrorMessage('RESULT_WRONG_VALID')).toBeNull();
    });
  });

  describe('isGuessButtonEnabled()', () => {
    it('should return true only for TYPING_FULL_VALID', () => {
      expect(isGuessButtonEnabled('TYPING_FULL_VALID')).toBe(true);
    });

    it('should return false for TYPING_FULL_INVALID_ALREADY_GUESSED', () => {
      expect(isGuessButtonEnabled('TYPING_FULL_INVALID_ALREADY_GUESSED')).toBe(false);
    });

    it('should return false for all other states', () => {
      const otherStates: InputState[] = [
        'IDLE_EMPTY',
        'TYPING_PARTIAL',
        'TYPING_FULL_INVALID_NONSENSE',
        'SUBMITTING',
        'RESULT_CORRECT',
        'RESULT_WRONG_VALID',
        'OUT_OF_GUESSES',
      ];

      for (const state of otherStates) {
        expect(isGuessButtonEnabled(state)).toBe(false);
      }
    });
  });

  describe('isInvalidState()', () => {
    it('should return true for TYPING_FULL_INVALID_ALREADY_GUESSED', () => {
      expect(isInvalidState('TYPING_FULL_INVALID_ALREADY_GUESSED')).toBe(true);
    });

    it('should return true for TYPING_FULL_INVALID_NONSENSE', () => {
      expect(isInvalidState('TYPING_FULL_INVALID_NONSENSE')).toBe(true);
    });

    it('should return false for valid and other states', () => {
      const validStates: InputState[] = [
        'IDLE_EMPTY',
        'TYPING_PARTIAL',
        'TYPING_FULL_VALID',
        'SUBMITTING',
        'RESULT_CORRECT',
        'RESULT_WRONG_VALID',
        'OUT_OF_GUESSES',
      ];

      for (const state of validStates) {
        expect(isInvalidState(state)).toBe(false);
      }
    });
  });

  /**
   * Duplicate Guess State Invariants
   * These tests verify the critical invariant: duplicate guesses are treated
   * as hard errors that block submission.
   */
  describe('Duplicate Guess Invariants', () => {
    it('should block submission for duplicate guesses', () => {
      // Simulate typing a word that's already been guessed
      const state = getInputState({
        letters: ['S', 'H', 'A', 'M', 'E'],
        isInGuessList: true,
        isAlreadyGuessed: true,
        isSubmitting: false,
        hasGuessesLeft: true,
        resultState: 'typing',
      });

      // State should be ALREADY_GUESSED
      expect(state).toBe('TYPING_FULL_INVALID_ALREADY_GUESSED');

      // Button should be disabled
      expect(isGuessButtonEnabled(state)).toBe(false);

      // Should be considered an invalid state
      expect(isInvalidState(state)).toBe(true);

      // Error message should be correct
      expect(getErrorMessage(state)).toBe('Already guessed this round');
    });

    it('should transition from valid to invalid when word becomes duplicate', () => {
      const baseParams: InputStateParams = {
        letters: ['S', 'H', 'A', 'M', 'E'],
        isInGuessList: true,
        isSubmitting: false,
        hasGuessesLeft: true,
        resultState: 'typing',
        isAlreadyGuessed: false,
      };

      // Initially valid
      const stateBefore = getInputState(baseParams);
      expect(stateBefore).toBe('TYPING_FULL_VALID');
      expect(isGuessButtonEnabled(stateBefore)).toBe(true);

      // After the word gets guessed by someone, it becomes a duplicate
      const stateAfter = getInputState({
        ...baseParams,
        isAlreadyGuessed: true,
      });
      expect(stateAfter).toBe('TYPING_FULL_INVALID_ALREADY_GUESSED');
      expect(isGuessButtonEnabled(stateAfter)).toBe(false);
    });
  });
});

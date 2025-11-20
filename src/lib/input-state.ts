/**
 * Input State Machine
 * Milestone 4.6 — Input States & Visual Behavior
 *
 * Defines all possible states for the main input experience and provides
 * a single source of truth for determining the current state based on inputs.
 */

/**
 * All possible input states
 */
export type InputState =
  | 'IDLE_EMPTY'              // Nothing typed yet
  | 'TYPING_PARTIAL'          // 1-4 letters typed
  | 'TYPING_FULL_VALID'       // 5 letters, word is valid and not already guessed
  | 'TYPING_FULL_INVALID_NONSENSE'    // 5 letters, not in GUESS_WORDS
  | 'TYPING_FULL_INVALID_ALREADY_GUESSED'  // 5 letters, already in wrong guesses
  | 'SUBMITTING'              // GUESS pressed, waiting for server
  | 'RESULT_CORRECT'          // Guess was correct
  | 'RESULT_WRONG_VALID'      // Guess was valid but incorrect
  | 'OUT_OF_GUESSES';         // User has 0 guesses available

/**
 * Input parameters for state machine
 */
export interface InputStateParams {
  letters: string[];           // Current 5-letter array
  isInGuessList: boolean;      // Is word in GUESS_WORDS?
  isAlreadyGuessed: boolean;   // Is word in wheelWords (already guessed)?
  isSubmitting: boolean;       // Is guess being submitted?
  hasGuessesLeft: boolean;     // Does user have guesses remaining?
  resultState?: 'typing' | 'wrong' | 'correct';  // Result from last submission
}

/**
 * Get the current input state based on parameters
 * This is the single source of truth for all input state logic
 */
export function getInputState(params: InputStateParams): InputState {
  const {
    letters,
    isInGuessList,
    isAlreadyGuessed,
    isSubmitting,
    hasGuessesLeft,
    resultState,
  } = params;

  // Get the word from letters
  const word = letters.join('');
  const letterCount = word.length;

  // Check for result states first (after submission)
  if (resultState === 'correct') {
    return 'RESULT_CORRECT';
  }
  if (resultState === 'wrong') {
    return 'RESULT_WRONG_VALID';
  }

  // Check if submitting
  if (isSubmitting) {
    return 'SUBMITTING';
  }

  // Check if out of guesses
  if (!hasGuessesLeft) {
    return 'OUT_OF_GUESSES';
  }

  // Check typing states
  if (letterCount === 0) {
    return 'IDLE_EMPTY';
  }

  if (letterCount < 5) {
    return 'TYPING_PARTIAL';
  }

  // letterCount === 5
  // Check if already guessed
  if (isAlreadyGuessed) {
    return 'TYPING_FULL_INVALID_ALREADY_GUESSED';
  }

  // Check if valid word
  if (!isInGuessList) {
    return 'TYPING_FULL_INVALID_NONSENSE';
  }

  // Valid, not already guessed, 5 letters
  return 'TYPING_FULL_VALID';
}

/**
 * Get error message for invalid states
 */
export function getErrorMessage(state: InputState): string | null {
  switch (state) {
    case 'TYPING_FULL_INVALID_NONSENSE':
      return 'Not a valid word';
    case 'TYPING_FULL_INVALID_ALREADY_GUESSED':
      return 'Already guessed this round';
    case 'OUT_OF_GUESSES':
      return 'No guesses left today';
    default:
      return null;
  }
}

/**
 * Check if GUESS button should be enabled
 */
export function isGuessButtonEnabled(state: InputState): boolean {
  return state === 'TYPING_FULL_VALID';
}

/**
 * Get box border color based on state
 */
export function getBoxBorderColor(state: InputState, hasLetter: boolean): string {
  // Result states
  if (state === 'RESULT_CORRECT') {
    return 'border-green-500';
  }
  if (state === 'RESULT_WRONG_VALID') {
    return 'border-red-500';
  }

  // Invalid states
  if (state === 'TYPING_FULL_INVALID_NONSENSE' || state === 'TYPING_FULL_INVALID_ALREADY_GUESSED') {
    return 'border-red-500';
  }

  // Out of guesses
  if (state === 'OUT_OF_GUESSES') {
    return 'border-gray-400';
  }

  // Typing states
  if (state === 'TYPING_FULL_VALID') {
    return 'border-blue-500';
  }

  if (hasLetter && (state === 'TYPING_PARTIAL' || state === 'SUBMITTING')) {
    return 'border-blue-500';
  }

  // Empty or idle
  return 'border-gray-300';
}

/**
 * Get box background color based on state
 */
export function getBoxBackgroundColor(state: InputState): string {
  if (state === 'OUT_OF_GUESSES') {
    return 'bg-gray-100';
  }
  return 'bg-white';
}

/**
 * Get box text color based on state
 */
export function getBoxTextColor(state: InputState, hasLetter: boolean): string {
  if (state === 'OUT_OF_GUESSES') {
    return 'text-gray-400';
  }
  if (!hasLetter) {
    return 'text-gray-300';
  }
  return 'text-gray-900';
}

/**
 * Check if the state should show a "ready to guess" glow
 */
export function shouldShowReadyGlow(state: InputState): boolean {
  return state === 'TYPING_FULL_VALID';
}

/**
 * Check if the state is an invalid state
 */
export function isInvalidState(state: InputState): boolean {
  return (
    state === 'TYPING_FULL_INVALID_NONSENSE' ||
    state === 'TYPING_FULL_INVALID_ALREADY_GUESSED'
  );
}

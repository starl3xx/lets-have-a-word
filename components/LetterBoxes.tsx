import { useRef, useEffect, useState, KeyboardEvent, ChangeEvent, useCallback, memo } from 'react';
import { getBoxBorderColor, getBoxBackgroundColor, getBoxTextColor, shouldShowReadyGlow, isInvalidState, type InputState } from '../src/lib/input-state';
import { useGuessInput } from '../src/hooks/useGuessInput';

interface LetterBoxesProps {
  letters: string[];
  onChange: (letters: string[]) => void;
  onSubmit?: () => void;
  disabled?: boolean;
  isShaking?: boolean;
  resultState?: 'typing' | 'wrong' | 'correct'; // Three-state system
  inputState?: InputState; // Milestone 4.6: Current input state
}

/**
 * Milestone 6.4.3: Memoized visual state for each letter slot
 * Computed once per render to avoid recalculation on every box
 */
type SlotVisualState = 'empty' | 'typing' | 'valid' | 'error' | 'result-correct' | 'result-wrong' | 'disabled';

/**
 * Milestone 6.4.3: Props for the memoized GuessSlot component
 * Minimal prop surface to avoid prop churn and unnecessary re-renders
 */
interface GuessSlotProps {
  letter: string;
  index: number;
  visualState: SlotVisualState;
  showReadyGlow: boolean;
  isLockedState: boolean;
  cursorType: 'not-allowed' | 'default' | 'text';
}

/**
 * Milestone 6.4.3: Get CSS classes for a slot based on visual state
 * Extracted to pure function for clarity and testability
 */
function getSlotClasses(
  visualState: SlotVisualState,
  hasLetter: boolean,
): string {
  switch (visualState) {
    case 'result-correct':
      return 'bg-white border-green-500 text-gray-900';
    case 'result-wrong':
      return 'bg-white border-red-500 text-gray-900';
    case 'error':
      return 'bg-white border-red-500 text-gray-900';
    case 'disabled':
      return 'bg-gray-100 border-gray-300 text-gray-400';
    case 'valid':
    case 'typing':
      // If there's a letter, show it with black text and blue border immediately
      return hasLetter
        ? 'bg-white border-blue-500 text-gray-900'
        : 'bg-white border-gray-300 text-gray-300';
    case 'empty':
    default:
      return 'bg-white border-gray-300 text-gray-300';
  }
}

/**
 * Milestone 6.4.3: GuessSlot - Memoized individual letter box
 *
 * Performance optimization: Each slot only re-renders when its own props change.
 * By using React.memo with a minimal prop surface, we prevent all 5 boxes from
 * re-rendering on every keystroke - only the affected box updates.
 *
 * This eliminates the "gray then black" flicker on the first input box by
 * ensuring the letter appears with its final styling in a single render pass.
 */
const GuessSlot = memo(function GuessSlot({
  letter,
  index,
  visualState,
  showReadyGlow,
  isLockedState,
  cursorType,
}: GuessSlotProps) {
  const hasLetter = !!letter;
  const slotClasses = getSlotClasses(visualState, hasLetter);

  // Map cursor type to class
  const cursorClass =
    cursorType === 'not-allowed'
      ? 'cursor-not-allowed'
      : cursorType === 'text'
      ? 'cursor-text hover:border-blue-400'
      : 'cursor-default';

  return (
    <div
      className={`
        w-16 h-16
        flex items-center justify-center
        text-3xl font-bold uppercase
        border-4 rounded-lg
        ${slotClasses}
        ${cursorClass}
        ${showReadyGlow ? 'ring-2 ring-blue-300 ring-opacity-50' : ''}
        ${visualState === 'result-correct' ? 'animate-pulse-glow' : ''}
        ${isLockedState ? 'opacity-60' : ''}
        shadow-md
      `}
      style={{
        // Milestone 6.4.6: Only transition border-color and ring, not all properties
        // This avoids expensive style recalculation on every keystroke
        transition: 'border-color 150ms, box-shadow 150ms',
      }}
    >
      {letter || '_'}
    </div>
  );
});

/**
 * LetterBoxes Component
 * Milestone 4.3 + 4.6 + 6.4 + 6.4.3
 *
 * Displays 5 letter boxes for word input with smooth typing behavior
 * Supports mobile keyboard, backspace, and visual feedback
 *
 * Milestone 4.6: Now uses state machine for consistent visual behavior
 * - State-based border colors (gray, blue, red, green)
 * - State-based error feedback
 * - "Ready to guess" glow for valid words
 *
 * Milestone 6.4: Centralized tap/focus behavior
 * - Empty row: tapping focuses first box
 * - Partial/full row: tapping does nothing
 * - Error/locked states: all interaction blocked
 *
 * Milestone 6.4.3: Performance optimization
 * - Memoized GuessSlot components to prevent unnecessary re-renders
 * - Each slot only re-renders when its own state changes
 * - Eliminates "gray then black" flicker on first input box
 */
export default function LetterBoxes({
  letters,
  onChange,
  onSubmit,
  disabled = false,
  isShaking = false,
  resultState = 'typing',
  inputState,
}: LetterBoxesProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  // Milestone 6.4: Use centralized input hook for tap/focus behavior
  const {
    canHandleTap,
    isErrorState,
    isLockedState,
  } = useGuessInput({
    letters,
    inputState: inputState || 'IDLE_EMPTY',
    disabled,
  });

  /**
   * Milestone 6.4.3: Compute the visual state once for all slots
   * This is more efficient than computing per-slot inline
   */
  const visualState: SlotVisualState = (() => {
    if (inputState === 'RESULT_CORRECT' || resultState === 'correct') {
      return 'result-correct';
    }
    if (inputState === 'RESULT_WRONG_VALID' || resultState === 'wrong') {
      return 'result-wrong';
    }
    if (inputState === 'TYPING_FULL_INVALID_NONSENSE' ||
        inputState === 'TYPING_FULL_INVALID_ALREADY_GUESSED') {
      return 'error';
    }
    if (disabled || inputState === 'OUT_OF_GUESSES') {
      return 'disabled';
    }
    if (inputState === 'TYPING_FULL_VALID') {
      return 'valid';
    }
    if (inputState === 'TYPING_PARTIAL') {
      return 'typing';
    }
    return 'empty';
  })();

  /**
   * Milestone 6.4.3: Compute cursor type once for all slots
   */
  const cursorType: 'not-allowed' | 'default' | 'text' = (() => {
    if (isLockedState) return 'not-allowed';
    if (isErrorState) return 'default';
    if (canHandleTap) return 'text';
    return 'default';
  })();

  /**
   * Focus input for hardware keyboard support on desktop (Milestone 4.4)
   * Mobile users will use the custom GameKeyboard component
   */
  useEffect(() => {
    if (!inputRef.current || disabled) return;

    // Only auto-focus on desktop (for hardware keyboard support)
    const isMobile =
      typeof navigator !== 'undefined' &&
      /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    if (!isMobile) {
      // Desktop: focus for hardware keyboard input
      inputRef.current.focus();
    }
  }, [disabled]);

  /**
   * Handle keyboard input (Milestone 4.4: Minimal handling, main logic is in window listener)
   */
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Just prevent default for all keys to avoid any native behavior
    // The window-level keyboard listener in index.tsx handles all input
    if (e.key === 'Enter' || e.key === 'Backspace' || /^[a-zA-Z]$/.test(e.key)) {
      e.preventDefault();
    }
  };

  /**
   * Handle change event (for mobile keyboard input)
   */
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toUpperCase();

    // Only allow A-Z letters
    const filtered = value.replace(/[^A-Z]/g, '');

    // Convert to array (max 5 letters)
    const newLetters = filtered.slice(0, 5).split('');

    // Pad with empty strings to length 5
    while (newLetters.length < 5) {
      newLetters.push('');
    }

    onChange(newLetters);
  };

  /**
   * Handle box click - focus the hidden input
   * Milestone 6.4: Only focus when row is empty; ignore taps otherwise
   *
   * Behavior:
   * - Empty row: Focus input for keyboard typing
   * - Partial/full row: Do nothing (no cursor repositioning)
   * - Error state: Do nothing (input blocked)
   * - Locked state: Do nothing (input disabled)
   */
  const handleBoxClick = useCallback(() => {
    // Milestone 6.4: Only allow focus when row is empty
    if (!canHandleTap) {
      return; // Ignore tap - row has letters, is in error state, or is locked
    }
    inputRef.current?.focus();
  }, [canHandleTap]);

  // Check if we should show the "ready to guess" glow (Milestone 4.6)
  const showReadyGlow = inputState ? shouldShowReadyGlow(inputState) : false;

  return (
    <div className="relative">
      {/* Hidden input for hardware keyboard support only (Milestone 4.4) */}
      <input
        ref={inputRef}
        type="text"
        inputMode="none"
        value={letters.join('')}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        disabled={disabled}
        className="absolute opacity-0 pointer-events-none"
        style={{ fontSize: '16px' }} // Prevent iOS zoom on focus
        maxLength={5}
        autoComplete="off"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        readOnly
      />

      {/* Visual letter boxes - using memoized GuessSlot components (Milestone 6.4.3) */}
      <div
        className={`flex gap-2 justify-center ${isShaking ? 'animate-shake' : ''}`}
        onClick={handleBoxClick}
      >
        {letters.map((letter, index) => (
          <GuessSlot
            key={index}
            letter={letter}
            index={index}
            visualState={visualState}
            showReadyGlow={showReadyGlow}
            isLockedState={isLockedState}
            cursorType={cursorType}
          />
        ))}
      </div>
    </div>
  );
}

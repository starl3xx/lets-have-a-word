import { useRef, useEffect, useState, KeyboardEvent, ChangeEvent, useCallback } from 'react';
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
 * LetterBoxes Component
 * Milestone 4.3 + 4.6 + 6.4
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

  /**
   * Get box styling based on state (Milestone 4.6)
   * Uses state machine for consistent visual behavior
   */
  const getBoxStyle = (letter: string, index: number) => {
    // Use state machine if available (Milestone 4.6)
    if (inputState) {
      const borderColor = getBoxBorderColor(inputState, !!letter);
      const bgColor = getBoxBackgroundColor(inputState);
      const textColor = getBoxTextColor(inputState, !!letter);
      return `${bgColor} ${borderColor} ${textColor}`;
    }

    // Fallback to old three-state system if inputState not provided
    if (resultState === 'wrong') {
      return 'bg-white border-red-500 text-gray-900';
    }
    if (resultState === 'correct') {
      return 'bg-white border-green-500 text-gray-900';
    }

    if (disabled) {
      return 'bg-gray-100 border-gray-300 text-gray-400';
    }

    if (letter) {
      return 'bg-white border-blue-500 text-gray-900';
    }

    return 'bg-white border-gray-300 text-gray-300';
  };

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

      {/* Visual letter boxes */}
      <div
        className={`flex gap-2 justify-center ${isShaking ? 'animate-shake' : ''}`}
        onClick={handleBoxClick}
      >
        {letters.map((letter, index) => {
          // Milestone 6.4: Determine cursor style based on state
          // - Locked/disabled: not-allowed cursor
          // - Error state: default cursor (no interaction)
          // - Empty row: text cursor (can type)
          // - Partial/full row: default cursor (no tap action)
          const getCursorStyle = () => {
            if (isLockedState) return 'cursor-not-allowed';
            if (isErrorState) return 'cursor-default';
            if (canHandleTap) return 'cursor-text hover:border-blue-400';
            return 'cursor-default';
          };

          return (
            <div
              key={index}
              className={`
                w-16 h-16
                flex items-center justify-center
                text-3xl font-bold uppercase
                border-4 rounded-lg
                transition-all duration-150
                ${getBoxStyle(letter, index)}
                ${getCursorStyle()}
                ${showReadyGlow ? 'ring-2 ring-blue-300 ring-opacity-50' : ''}
                ${resultState === 'correct' ? 'animate-pulse-glow' : ''}
                ${isLockedState ? 'opacity-60' : ''}
                shadow-md
              `}
            >
              {letter || '_'}
            </div>
          );
        })}
      </div>
    </div>
  );
}

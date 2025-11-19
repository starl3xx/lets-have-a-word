import { useRef, useEffect, useState, KeyboardEvent, ChangeEvent } from 'react';

interface LetterBoxesProps {
  letters: string[];
  onChange: (letters: string[]) => void;
  onSubmit?: () => void;
  disabled?: boolean;
  isShaking?: boolean;
  resultState?: 'typing' | 'wrong' | 'correct'; // Three-state system
}

/**
 * LetterBoxes Component
 * Milestone 4.3
 *
 * Displays 5 letter boxes for word input with smooth typing behavior
 * Supports mobile keyboard, backspace, and visual feedback
 *
 * Color states:
 * - Empty: Gray border, white background
 * - Filled (typing): Blue background, white text
 * - Wrong result: Red background (after GUESS)
 * - Correct result: Green background (after GUESS)
 */
export default function LetterBoxes({
  letters,
  onChange,
  onSubmit,
  disabled = false,
  isShaking = false,
  resultState = 'typing',
}: LetterBoxesProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  /**
   * Auto-focus input on mount and when boxes are cleared (all devices)
   * Trigger focus when all letters are empty (fresh start or after submit)
   */
  useEffect(() => {
    if (!inputRef.current || disabled) return;

    // Check if all letters are empty (fresh start)
    const allEmpty = letters.every(l => l === '');
    if (!allEmpty) return;

    const isMobile =
      typeof navigator !== 'undefined' &&
      /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    if (isMobile) {
      // Longer delay for Farcaster mobile to ensure keyboard shows
      setTimeout(() => {
        inputRef.current?.focus();
        // Try clicking to trigger keyboard on iOS
        inputRef.current?.click();
      }, 300);
    } else {
      // Desktop: focus immediately
      inputRef.current.focus();
    }
  }, [disabled, letters]);

  /**
   * Handle keyboard input
   */
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Prevent Enter from submitting (user must tap GUESS button)
    if (e.key === 'Enter') {
      e.preventDefault();
      return;
    }

    // Handle backspace
    if (e.key === 'Backspace') {
      e.preventDefault();
      const newLetters = [...letters];

      // Find last non-empty position and clear it
      for (let i = 4; i >= 0; i--) {
        if (newLetters[i] !== '') {
          newLetters[i] = '';
          break;
        }
      }

      onChange(newLetters);
      return;
    }

    // Handle letter input (A-Z only)
    if (/^[a-zA-Z]$/.test(e.key)) {
      e.preventDefault();
      const newLetters = [...letters];

      // Find first empty position and fill it
      for (let i = 0; i < 5; i++) {
        if (newLetters[i] === '') {
          newLetters[i] = e.key.toUpperCase();
          break;
        }
      }

      onChange(newLetters);
      return;
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
   */
  const handleBoxClick = () => {
    inputRef.current?.focus();
  };

  /**
   * Get box styling based on state
   * Three-state system (border colors only):
   * - Empty: gray border, white bg
   * - Filled (typing): blue border, white bg
   * - Wrong result: red border, white bg
   * - Correct result: green border, white bg (only on correct secret word)
   */
  const getBoxStyle = (letter: string) => {
    // Result states (after GUESS pressed)
    if (resultState === 'wrong') {
      return 'bg-white border-red-500 text-gray-900';
    }
    if (resultState === 'correct') {
      return 'bg-white border-green-500 text-gray-900';
    }

    // Typing states (before GUESS)
    if (disabled) {
      return 'bg-gray-100 border-gray-300 text-gray-400';
    }

    if (letter) {
      // Filled while typing: blue border
      return 'bg-white border-blue-500 text-gray-900';
    }

    // Empty: gray border
    return 'bg-white border-gray-300 text-gray-300';
  };

  return (
    <div className="relative">
      {/* Hidden input for keyboard handling */}
      <input
        ref={inputRef}
        type="text"
        value={letters.join('')}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        disabled={disabled}
        className="absolute opacity-0 pointer-events-none"
        maxLength={5}
        autoComplete="off"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
      />

      {/* Visual letter boxes */}
      <div
        className={`flex gap-2 justify-center ${isShaking ? 'animate-shake' : ''}`}
        onClick={handleBoxClick}
      >
        {letters.map((letter, index) => (
          <div
            key={index}
            className={`
              w-16 h-16
              flex items-center justify-center
              text-3xl font-bold uppercase
              border-4 rounded-lg
              transition-all duration-150
              ${getBoxStyle(letter)}
              ${!disabled && resultState === 'typing' && 'cursor-text hover:border-blue-400'}
              shadow-md
            `}
          >
            {letter || '_'}
          </div>
        ))}
      </div>
    </div>
  );
}

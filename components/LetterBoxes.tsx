import { useRef, useEffect, KeyboardEvent, ChangeEvent } from 'react';

interface LetterBoxesProps {
  letters: string[];
  onChange: (letters: string[]) => void;
  onSubmit?: () => void;
  disabled?: boolean;
  isShaking?: boolean;
}

/**
 * LetterBoxes Component
 * Milestone 4.3
 *
 * Displays 5 letter boxes for word input with smooth typing behavior
 * Supports mobile keyboard, backspace, and visual feedback
 */
export default function LetterBoxes({
  letters,
  onChange,
  onSubmit,
  disabled = false,
  isShaking = false,
}: LetterBoxesProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * Auto-focus input on mount (especially for mobile)
   */
  useEffect(() => {
    if (!inputRef.current) return;

    const isMobile =
      typeof navigator !== 'undefined' &&
      /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    if (isMobile) {
      // Small delay helps iOS Safari actually show the keyboard
      setTimeout(() => {
        inputRef.current?.focus();
      }, 200);
    }
  }, []);

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

  return (
    <div className="relative">
      {/* Hidden input for keyboard handling */}
      <input
        ref={inputRef}
        type="text"
        value={letters.join('')}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
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
              ${disabled ? 'bg-gray-100 border-gray-300 text-gray-400' : 'bg-white'}
              ${letter ? 'border-green-500 text-gray-900' : 'border-gray-300 text-gray-300'}
              ${!disabled && 'cursor-text hover:border-green-400'}
              shadow-md
            `}
          >
            {letter || '_'}
          </div>
        ))}
      </div>

      {/* Character counter */}
      <div className="text-center mt-2">
        <p className="text-xs text-gray-500 font-semibold inline-block relative">
          <span
            className="absolute inset-0 bg-white/80 backdrop-blur-sm rounded px-2 py-1"
            style={{
              left: '-8px',
              right: '-8px',
              top: '-4px',
              bottom: '-4px',
            }}
          ></span>
          <span className="relative z-10">
            {letters.filter(l => l !== '').length}/5 letters
          </span>
        </p>
      </div>
    </div>
  );
}

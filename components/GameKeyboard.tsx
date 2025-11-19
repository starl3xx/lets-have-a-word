/**
 * GameKeyboard Component
 * Milestone 4.4
 *
 * Custom in-app keyboard for A-Z letter input
 * - QWERTY layout (3 rows)
 * - Backspace key
 * - Touch-optimized for mobile
 * - Consistent behavior across devices
 */

interface GameKeyboardProps {
  onLetter: (letter: string) => void;
  onBackspace: () => void;
  disabled?: boolean;
}

const ROW1 = ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'];
const ROW2 = ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'];
const ROW3 = ['Z', 'X', 'C', 'V', 'B', 'N', 'M'];

export default function GameKeyboard({
  onLetter,
  onBackspace,
  disabled = false,
}: GameKeyboardProps) {
  const handleLetterClick = (letter: string) => {
    if (disabled) return;
    onLetter(letter);
  };

  const handleBackspaceClick = () => {
    if (disabled) return;
    onBackspace();
  };

  return (
    <div className="w-full max-w-md mx-auto px-2 py-2 bg-gray-100 rounded-t-lg">
      {/* Row 1 */}
      <div className="flex justify-center gap-1 mb-1">
        {ROW1.map((letter) => (
          <button
            key={letter}
            type="button"
            onClick={() => handleLetterClick(letter)}
            disabled={disabled}
            className={`
              flex-1 max-w-[36px] h-12
              flex items-center justify-center
              text-base font-bold
              rounded
              transition-all
              ${
                disabled
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-white text-gray-900 active:scale-95 active:bg-gray-200 hover:bg-gray-50'
              }
              shadow-sm
            `}
          >
            {letter}
          </button>
        ))}
      </div>

      {/* Row 2 */}
      <div className="flex justify-center gap-1 mb-1">
        {ROW2.map((letter) => (
          <button
            key={letter}
            type="button"
            onClick={() => handleLetterClick(letter)}
            disabled={disabled}
            className={`
              flex-1 max-w-[36px] h-12
              flex items-center justify-center
              text-base font-bold
              rounded
              transition-all
              ${
                disabled
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-white text-gray-900 active:scale-95 active:bg-gray-200 hover:bg-gray-50'
              }
              shadow-sm
            `}
          >
            {letter}
          </button>
        ))}
      </div>

      {/* Row 3 with Backspace */}
      <div className="flex justify-center gap-1">
        {/* Letter keys */}
        {ROW3.map((letter) => (
          <button
            key={letter}
            type="button"
            onClick={() => handleLetterClick(letter)}
            disabled={disabled}
            className={`
              flex-1 max-w-[36px] h-12
              flex items-center justify-center
              text-base font-bold
              rounded
              transition-all
              ${
                disabled
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-white text-gray-900 active:scale-95 active:bg-gray-200 hover:bg-gray-50'
              }
              shadow-sm
            `}
          >
            {letter}
          </button>
        ))}

        {/* Backspace key on right */}
        <button
          type="button"
          onClick={handleBackspaceClick}
          disabled={disabled}
          className={`
            px-3 h-12
            flex items-center justify-center
            text-lg font-bold
            rounded
            transition-all
            ${
              disabled
                ? 'bg-gray-400 text-gray-600 cursor-not-allowed'
                : 'bg-gray-700 text-white active:scale-95 active:bg-gray-800 hover:bg-gray-800'
            }
            shadow-sm
            min-w-[60px]
          `}
        >
          ⌫
        </button>
      </div>
    </div>
  );
}

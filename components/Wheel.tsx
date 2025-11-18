import { useEffect, useRef } from 'react';

/**
 * Wheel Component
 * Milestone 2.3: Displays all wrong words alphabetically in a scrollable list
 *
 * Props:
 * - words: Alphabetically sorted array of wrong words (seed words + real wrong guesses)
 * - currentGuess: The word currently being typed by the user (0-5 letters)
 */
interface WheelProps {
  words: string[];
  currentGuess: string;
}

export default function Wheel({ words, currentGuess }: WheelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const highlightedRef = useRef<HTMLDivElement>(null);

  /**
   * Auto-scroll to the position of the current guess
   * If currentGuess matches or would be near a word alphabetically, scroll to it
   */
  useEffect(() => {
    if (!currentGuess || currentGuess.length === 0 || words.length === 0) {
      return;
    }

    // Find the position where currentGuess would be inserted (binary search-like)
    const targetIndex = words.findIndex((word) => word >= currentGuess);

    if (targetIndex !== -1 && highlightedRef.current && containerRef.current) {
      // Scroll the highlighted word into view (centered)
      highlightedRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [currentGuess, words]);

  /**
   * Determine if a word should be highlighted
   * Highlight words that match the current guess prefix or are alphabetically close
   */
  const shouldHighlight = (word: string): boolean => {
    if (!currentGuess || currentGuess.length === 0) {
      return false;
    }

    // Exact match
    if (word === currentGuess) {
      return true;
    }

    // Prefix match (e.g., "CRA" highlights "CRANE", "CRAFT")
    if (word.startsWith(currentGuess)) {
      return true;
    }

    return false;
  };

  /**
   * Get the index of the first highlighted word (for ref assignment)
   */
  const getHighlightedIndex = (): number => {
    if (!currentGuess || currentGuess.length === 0) {
      return -1;
    }
    return words.findIndex((word) => shouldHighlight(word));
  };

  const highlightedIndex = getHighlightedIndex();

  return (
    <div className="w-full">
      {/* Header */}
      <div className="mb-2">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          Wrong Guesses
        </h2>
        <p className="text-xs text-gray-500">
          {words.length} {words.length === 1 ? 'word' : 'words'}
        </p>
      </div>

      {/* Scrollable word list */}
      <div
        ref={containerRef}
        className="border-2 border-gray-300 rounded-lg bg-white overflow-y-auto"
        style={{ height: '300px' }}
      >
        {words.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            No wrong guesses yet
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {words.map((word, index) => {
              const isHighlighted = shouldHighlight(word);
              const isFirstHighlighted = index === highlightedIndex;

              return (
                <div
                  key={`${word}-${index}`}
                  ref={isFirstHighlighted ? highlightedRef : null}
                  className={`
                    px-3 py-2 rounded font-mono text-center text-sm transition-colors
                    ${isHighlighted
                      ? 'bg-blue-100 text-blue-900 font-bold border-2 border-blue-400'
                      : 'bg-gray-50 text-gray-700 border border-gray-200'
                    }
                  `}
                >
                  {word}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

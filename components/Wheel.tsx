import { useEffect, useRef } from 'react';

/**
 * Wheel Component with Faux-3D Effect
 * Milestone 2.3: Displays wrong words in a carousel-style wheel behind the input boxes
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
  const wordRefs = useRef<(HTMLDivElement | null)[]>([]);
  const gapRef = useRef<HTMLDivElement>(null);

  /**
   * Find the alphabetical index where currentGuess should appear
   * Returns the index of the nearest word to highlight
   */
  const getCenterIndex = (): number => {
    if (!currentGuess || currentGuess.length === 0 || words.length === 0) {
      return -1;
    }

    // Find first word >= currentGuess
    const targetIndex = words.findIndex((word) => word >= currentGuess);

    // If found, use that index
    if (targetIndex !== -1) {
      return targetIndex;
    }

    // If currentGuess > all words, use last word
    return words.length - 1;
  };

  const centerIndex = getCenterIndex();

  /**
   * Determine where to insert the gap
   * - If typing: insert at centerIndex (alphabetical position)
   * - If not typing: insert at middle of list (so words split above/below on load)
   */
  const getGapIndex = (): number => {
    if (centerIndex !== -1) {
      return centerIndex;
    }
    // Default to middle of word list when not typing
    return Math.floor(words.length / 2);
  };

  const gapIndex = getGapIndex();

  /**
   * Auto-scroll to center the gap (where input boxes are)
   * This makes words skip over the input box area
   */
  useEffect(() => {
    if (gapRef.current) {
      gapRef.current.scrollIntoView({
        behavior: centerIndex === -1 ? 'auto' : 'smooth', // Instant on load, smooth when typing
        block: 'center',
      });
    }
  }, [centerIndex, words]);

  /**
   * Calculate distance-based styling for faux-3D effect
   */
  const getWordStyle = (index: number) => {
    if (centerIndex === -1) {
      return { scale: 1.0, opacity: 0.3, fontWeight: 'normal' as const, letterSpacing: '0.05em' };
    }

    const distance = Math.abs(index - centerIndex);
    const isExactMatch = words[index] === currentGuess;

    // Distance-based scale, opacity, and letter spacing for 3D effect
    let scale = 1.0;
    let opacity = 0.25;
    let fontWeight: 'bold' | 'normal' | '300' = 'normal';
    let color = '#bbb';
    let letterSpacing = '0.05em';

    switch (distance) {
      case 0:
        scale = 1.4;
        opacity = 1.0;
        fontWeight = 'bold';
        color = isExactMatch ? '#dc2626' : '#000'; // Red if exact match
        letterSpacing = '0.2em'; // Widest spacing at center
        break;
      case 1:
        scale = 1.2;
        opacity = 0.7;
        fontWeight = 'normal';
        color = '#666';
        letterSpacing = '0.15em';
        break;
      case 2:
        scale = 1.1;
        opacity = 0.5;
        fontWeight = 'normal';
        color = '#999';
        letterSpacing = '0.1em';
        break;
      case 3:
        scale = 1.05;
        opacity = 0.35;
        fontWeight = '300';
        color = '#aaa';
        letterSpacing = '0.07em';
        break;
      default:
        scale = 1.0;
        opacity = 0.25;
        fontWeight = '300';
        color = '#bbb';
        letterSpacing = '0.05em'; // Tightest spacing at edges
    }

    return { scale, opacity, fontWeight, color, letterSpacing };
  };

  /**
   * Check if word is an exact match (for red highlighting)
   */
  const isExactMatch = (word: string): boolean => {
    return currentGuess && word === currentGuess;
  };

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-y-auto overflow-x-hidden"
      style={{
        pointerEvents: 'none',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
      }}
    >
      {/* Hide scrollbar */}
      <style jsx>{`
        div::-webkit-scrollbar {
          display: none;
        }
      `}</style>

      {words.length === 0 ? (
        <div className="flex items-center justify-center h-full">
          <p className="text-gray-300 text-sm" style={{ opacity: 0.3 }}>
            No words yet
          </p>
        </div>
      ) : (
        <div className="py-8 flex flex-col">
          {words.map((word, index) => {
            const style = getWordStyle(index);

            // Insert spacer at gap index to create physical gap for input boxes
            // Always insert (even when not typing) to prevent words appearing behind boxes
            const shouldInsertSpacer = index === gapIndex;

            return (
              <div key={`${word}-${index}`}>
                {shouldInsertSpacer && (
                  <div
                    ref={gapRef}
                    style={{
                      height: '12vh', // Gap for input boxes + padding
                      pointerEvents: 'none',
                    }}
                  />
                )}
                <div
                  ref={(el) => {
                    wordRefs.current[index] = el;
                  }}
                  className="text-center transition-all duration-300 ease-out"
                  style={{
                    transform: `scale(${style.scale})`,
                    opacity: style.opacity,
                    fontWeight: style.fontWeight,
                    color: style.color,
                    fontSize: '1.3rem',
                    lineHeight: '1.6',
                    textTransform: 'uppercase',
                    letterSpacing: style.letterSpacing,
                  }}
                >
                  {word}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

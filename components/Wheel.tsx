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
   * Auto-scroll to center the highlighted word
   */
  useEffect(() => {
    if (centerIndex !== -1 && wordRefs.current[centerIndex]) {
      wordRefs.current[centerIndex]?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [centerIndex, words]);

  /**
   * Calculate distance-based styling for faux-3D effect
   */
  const getWordStyle = (index: number) => {
    if (centerIndex === -1) {
      return { scale: 1.0, opacity: 0.3, fontWeight: 'normal' as const };
    }

    const distance = Math.abs(index - centerIndex);
    const isExactMatch = words[index] === currentGuess;

    // Distance-based scale and opacity
    let scale = 1.0;
    let opacity = 0.05;
    let fontWeight: 'bold' | 'normal' | '300' = 'normal';
    let color = '#ccc';

    switch (distance) {
      case 0:
        scale = 1.4;
        opacity = 1.0;
        fontWeight = 'bold';
        color = isExactMatch ? '#dc2626' : '#000'; // Red if exact match
        break;
      case 1:
        scale = 1.2;
        opacity = 0.7;
        fontWeight = 'normal';
        color = '#666';
        break;
      case 2:
        scale = 1.1;
        opacity = 0.4;
        fontWeight = 'normal';
        color = '#999';
        break;
      case 3:
        scale = 1.05;
        opacity = 0.15;
        fontWeight = '300';
        color = '#ccc';
        break;
      default:
        scale = 1.0;
        opacity = 0.05;
        fontWeight = '300';
        color = '#ddd';
    }

    return { scale, opacity, fontWeight, color };
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
        // Mask creates actual gap for input boxes (center ~40-60%) and hides bottom for button
        WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 38%, transparent 38%, transparent 62%, black 62%, black 77%, transparent 77%)',
        maskImage: 'linear-gradient(to bottom, black 0%, black 38%, transparent 38%, transparent 62%, black 62%, black 77%, transparent 77%)',
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
        <div>
          {words.map((word, index) => {
            const style = getWordStyle(index);

            return (
              <div
                key={`${word}-${index}`}
                ref={(el) => {
                  wordRefs.current[index] = el;
                }}
                className="text-center transition-all duration-300 ease-out"
                style={{
                  transform: `scale(${style.scale})`,
                  opacity: style.opacity,
                  fontWeight: style.fontWeight,
                  color: style.color,
                  fontSize: '2rem',
                  lineHeight: '1.8',
                  textTransform: 'uppercase',
                  fontFamily: 'monospace',
                  letterSpacing: '0.1em',
                }}
              >
                {word}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

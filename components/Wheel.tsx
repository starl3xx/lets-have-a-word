import { useEffect, useRef } from 'react';
import type { InputState } from '../src/lib/input-state';
import type { WheelWord, WheelWordStatus } from '../src/types';

/**
 * Wheel Component with Global Word Wheel
 * Milestone 2.3 + 4.6 + 4.10: Displays all guessable words with status-based styling
 *
 * Props:
 * - words: Array of WheelWord objects with word and status
 * - currentGuess: The word currently being typed by the user (0-5 letters)
 * - inputState: Current input state (Milestone 4.6)
 *
 * Milestone 4.10: Enhanced with status-based rendering
 * - Shows ALL GUESS_WORDS from the start
 * - Words styled by status: unguessed (default), wrong (red), winner (gold)
 * - Real layout gap that words cannot occupy (scrolls to center)
 * - No more ghost rows - words are always present
 *
 * Note: Input boxes are rendered separately as fixed overlay, but the gap
 * ensures words structurally cannot appear in that vertical space
 */
interface WheelProps {
  words: WheelWord[];
  currentGuess: string;
  inputState?: InputState;
}

export default function Wheel({ words, currentGuess, inputState }: WheelProps) {
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

    // Normalize to lowercase for case-insensitive alphabetical comparison
    const normalizedGuess = currentGuess.toLowerCase();

    // Find first word >= currentGuess (case-insensitive)
    const targetIndex = words.findIndex((w) => w.word.toLowerCase() >= normalizedGuess);

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
   * - If typing: insert AFTER centerIndex (so centered word appears above gap)
   * - Special case: if last word, insert BEFORE it (so it appears below gap)
   * - If not typing: insert at middle of list (so words split above/below on load)
   */
  const getGapIndex = (): number => {
    if (centerIndex !== -1) {
      // Special case: if centering the last word, put gap before it (so word appears below)
      if (centerIndex === words.length - 1) {
        return centerIndex; // Insert BEFORE the last word
      }
      return centerIndex + 1; // Insert AFTER the centered word (normal case)
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
   * Get status-based styling for a word
   * Milestone 4.10: Uses status from backend instead of client-side derivation
   */
  const getStatusStyle = (status: WheelWordStatus) => {
    switch (status) {
      case 'winner':
        return {
          color: '#fbbf24', // Gold
          fontWeight: 'bold' as const,
          textShadow: '0 0 15px rgba(251, 191, 36, 0.5)',
        };
      case 'wrong':
        return {
          color: '#dc2626', // Red
          fontWeight: 'normal' as const,
        };
      case 'unguessed':
      default:
        return {
          color: '#999', // Gray
          fontWeight: '300' as const,
        };
    }
  };

  /**
   * Calculate distance-based styling for faux-3D effect
   * Milestone 4.10: Combines distance-based depth with status-based colors
   */
  const getWordStyle = (index: number, status: WheelWordStatus) => {
    const statusStyle = getStatusStyle(status);

    if (centerIndex === -1) {
      return {
        scale: 1.0,
        opacity: status === 'unguessed' ? 0.25 : 0.4,
        fontWeight: statusStyle.fontWeight,
        color: statusStyle.color,
        letterSpacing: '0.05em',
        textShadow: statusStyle.textShadow,
      };
    }

    const distance = Math.abs(index - centerIndex);
    const isExactMatch = words[index].word.toLowerCase() === currentGuess.toLowerCase();

    // Distance-based scale, opacity, letter spacing, and font weight for 3D effect
    let scale = 1.0;
    let opacity = 0.25;
    let fontWeight: 'bold' | 'normal' | '300' = 'normal';
    let letterSpacing = '0.05em';

    // Apply distance-based scaling
    switch (distance) {
      case 0:
        scale = 1.4;
        opacity = 1.0;
        fontWeight = 'bold';
        letterSpacing = '0.2em'; // Widest spacing at center
        break;
      case 1:
        scale = 1.2;
        opacity = 0.7;
        fontWeight = 'normal';
        letterSpacing = '0.15em';
        break;
      case 2:
        scale = 1.1;
        opacity = 0.5;
        fontWeight = 'normal';
        letterSpacing = '0.1em';
        break;
      case 3:
        scale = 1.05;
        opacity = 0.35;
        fontWeight = '300';
        letterSpacing = '0.07em';
        break;
      default:
        scale = 1.0;
        opacity = 0.25;
        fontWeight = '300';
        letterSpacing = '0.05em'; // Tightest spacing at edges
    }

    // Boost opacity for wrong/winner words so they're always visible
    if (status === 'wrong' || status === 'winner') {
      opacity = Math.max(opacity, 0.5);
    }

    // Get base status color, then adjust based on distance for depth effect
    let color = statusStyle.color;

    // For unguessed words, use distance-based color gradation (darker at center, lighter at edges)
    if (status === 'unguessed') {
      switch (distance) {
        case 0:
          color = isExactMatch ? '#dc2626' : '#000'; // Red if exact match, black otherwise
          break;
        case 1:
          color = '#666';
          break;
        case 2:
          color = '#999';
          break;
        case 3:
          color = '#aaa';
          break;
        default:
          color = '#bbb';
      }
    }
    // For wrong/winner words, keep status color but vary opacity for depth

    return {
      scale,
      opacity,
      fontWeight,
      color,
      letterSpacing,
      textShadow: statusStyle.textShadow,
    };
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
            Loading words...
          </p>
        </div>
      ) : (
        <div className="flex flex-col">
          {/* Top padding spacer - ensures gap can center even at list start */}
          <div style={{ minHeight: '40vh' }} />

          {words.map((wheelWord, index) => {
            const style = getWordStyle(index, wheelWord.status);

            // Insert spacer at gap index to create physical gap for input boxes
            // Always insert (even when not typing) to prevent words appearing behind boxes
            const shouldInsertSpacer = index === gapIndex;

            return (
              <div key={`${wheelWord.word}-${index}`}>
                {shouldInsertSpacer && (
                  <div
                    ref={gapRef}
                    style={{
                      minHeight: '12vh', // Fixed gap height for input boxes
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      alignItems: 'center',
                      paddingTop: '0.8rem',
                      paddingBottom: '0.8rem',
                      marginTop: '-0.4rem',
                      pointerEvents: 'none', // Transparent to clicks - input boxes handle interaction
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
                    textShadow: style.textShadow,
                  }}
                >
                  {wheelWord.word}
                </div>
              </div>
            );
          })}

          {/* Gap after last word (when gapIndex >= words.length) */}
          {gapIndex >= words.length && (
            <div
              ref={gapRef}
              style={{
                minHeight: '12vh',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                paddingTop: '0.8rem',
                paddingBottom: '0.8rem',
                marginTop: '-0.4rem',
                pointerEvents: 'none',
              }}
            />
          )}

          {/* Bottom padding spacer - ensures gap can center even at list end */}
          <div style={{ minHeight: '40vh' }} />
        </div>
      )}
    </div>
  );
}

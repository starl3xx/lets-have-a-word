import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import type { InputState } from '../src/lib/input-state';
import type { WheelWord, WheelWordStatus } from '../src/types';

/**
 * Wheel Component with Virtualized Global Word Wheel
 * Milestone 2.3 + 4.6 + 4.10 + 4.11: High-performance virtualized rendering
 *
 * Props:
 * - words: Array of WheelWord objects with word and status
 * - currentGuess: The word currently being typed by the user (0-5 letters)
 * - inputState: Current input state (Milestone 4.6)
 *
 * Milestone 4.11 Performance Optimizations:
 * - Virtual scrolling: Only renders ~60-100 visible words (not all 10,516)
 * - Binary search for O(log n) center index lookup
 * - Memoized calculations prevent unnecessary re-renders
 * - Direct scroll manipulation for instant, smooth jumping
 * - Smart windowing with gap-aware calculations
 *
 * Original features preserved:
 * - Status-based rendering: unguessed (gray), wrong (red), winner (gold)
 * - 3D effect with distance-based scaling and opacity
 * - Real layout gap that words cannot occupy
 * - Auto-scrolling to center user input alphabetically
 * - Exact spacing matching original lineHeight: 1.6
 */
interface WheelProps {
  words: WheelWord[];
  currentGuess: string;
  inputState?: InputState;
}

// Configuration constants - precisely matched to original
const ITEM_HEIGHT = 33; // pixels per word (matches original lineHeight: 1.6 * fontSize: 1.3rem = 2.08rem ≈ 33px)
const GAP_HEIGHT = 120; // pixels for input box gap (12vh ≈ 120px)
const OVERSCAN_COUNT = 30; // Number of items to render above/below viewport
const VIEWPORT_PADDING = 400; // Top/bottom padding in pixels

export default function Wheel({ words, currentGuess, inputState }: WheelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gapRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const [isInitialized, setIsInitialized] = useState(false);

  /**
   * Binary search to find alphabetical center index
   * O(log n) instead of O(n) linear search
   */
  const getCenterIndex = useCallback((): number => {
    if (!currentGuess || currentGuess.length === 0 || words.length === 0) {
      return -1;
    }

    const normalizedGuess = currentGuess.toUpperCase();

    // Binary search for first word >= currentGuess
    let left = 0;
    let right = words.length - 1;
    let result = words.length - 1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      if (words[mid].word >= normalizedGuess) {
        result = mid;
        right = mid - 1;
      } else {
        left = mid + 1;
      }
    }

    return result;
  }, [currentGuess, words]);

  const centerIndex = getCenterIndex();

  /**
   * Calculate gap index (where input boxes should appear)
   */
  const gapIndex = useMemo(() => {
    if (centerIndex !== -1) {
      // Put gap before last word, or after centered word
      if (centerIndex === words.length - 1) {
        return centerIndex;
      }
      return centerIndex + 1;
    }
    // Default to middle when not typing
    return Math.floor(words.length / 2);
  }, [centerIndex, words.length]);

  /**
   * Calculate total content height for virtual scrolling
   */
  const totalHeight = useMemo(() => {
    return (
      VIEWPORT_PADDING + // Top padding
      words.length * ITEM_HEIGHT +
      GAP_HEIGHT + // Gap for input
      VIEWPORT_PADDING // Bottom padding
    );
  }, [words.length]);

  /**
   * Calculate gap position for visible range calculations
   */
  const gapTopOffset = useMemo(() => {
    return VIEWPORT_PADDING + gapIndex * ITEM_HEIGHT;
  }, [gapIndex]);

  const gapBottomOffset = useMemo(() => {
    return gapTopOffset + GAP_HEIGHT;
  }, [gapTopOffset]);

  /**
   * Calculate which items are currently visible
   * IMPORTANT: Accounts for gap offset in calculations
   */
  const visibleRange = useMemo(() => {
    if (containerHeight === 0 || words.length === 0) {
      // Show more items initially to ensure content is visible
      return { startIndex: 0, endIndex: Math.min(100, words.length) };
    }

    const scrollStart = Math.max(0, scrollTop - VIEWPORT_PADDING);
    const scrollEnd = scrollTop + containerHeight + VIEWPORT_PADDING;

    // Calculate start index accounting for gap
    let startIndex: number;
    if (scrollStart < gapTopOffset) {
      // Before gap: normal calculation
      startIndex = Math.floor((scrollStart - VIEWPORT_PADDING) / ITEM_HEIGHT);
    } else {
      // After gap: subtract gap height
      startIndex = Math.floor((scrollStart - VIEWPORT_PADDING - GAP_HEIGHT) / ITEM_HEIGHT);
    }

    // Calculate end index accounting for gap
    let endIndex: number;
    if (scrollEnd < gapTopOffset) {
      // Before gap: normal calculation
      endIndex = Math.ceil((scrollEnd - VIEWPORT_PADDING) / ITEM_HEIGHT);
    } else {
      // After gap: subtract gap height
      endIndex = Math.ceil((scrollEnd - VIEWPORT_PADDING - GAP_HEIGHT) / ITEM_HEIGHT);
    }

    // Add overscan and clamp to valid range
    startIndex = Math.max(0, startIndex - OVERSCAN_COUNT);
    endIndex = Math.min(words.length, endIndex + OVERSCAN_COUNT);

    return { startIndex, endIndex };
  }, [scrollTop, containerHeight, words.length, gapTopOffset]);

  /**
   * Calculate scroll position to center a specific word index
   */
  const getScrollTopForIndex = useCallback(
    (index: number): number => {
      if (!containerRef.current) return 0;

      const itemOffset = VIEWPORT_PADDING + index * ITEM_HEIGHT;

      // If gap is before this index, add gap height
      const gapOffset = index >= gapIndex ? GAP_HEIGHT : 0;

      const containerHeight = containerRef.current.clientHeight;
      const targetScrollTop = itemOffset + gapOffset - containerHeight / 2;

      return Math.max(0, targetScrollTop);
    },
    [gapIndex]
  );

  /**
   * Track scroll position for virtual windowing
   */
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  /**
   * Track container height for virtual windowing
   */
  useEffect(() => {
    if (!containerRef.current) return;

    const updateHeight = () => {
      if (containerRef.current) {
        setContainerHeight(containerRef.current.clientHeight);
      }
    };

    updateHeight();
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, []);

  /**
   * Initialize scroll position on first load
   */
  useEffect(() => {
    if (!containerRef.current || words.length === 0 || isInitialized) return;

    // Center the gap on initial load
    const targetScroll = getScrollTopForIndex(gapIndex);
    containerRef.current.scrollTop = targetScroll;
    setScrollTop(targetScroll);
    setIsInitialized(true);
  }, [words.length, gapIndex, isInitialized, getScrollTopForIndex]);

  /**
   * Auto-scroll to center when user types
   * Uses direct scroll manipulation for instant, smooth jumping
   */
  useEffect(() => {
    if (!containerRef.current || words.length === 0 || !isInitialized) return;

    // When user clears input (centerIndex = -1), keep current position
    if (centerIndex === -1) {
      return;
    }

    // When typing, smoothly scroll to center the input position
    const targetScroll = getScrollTopForIndex(centerIndex);

    containerRef.current.scrollTo({
      top: targetScroll,
      behavior: 'smooth',
    });
  }, [centerIndex, words.length, isInitialized, getScrollTopForIndex]);

  /**
   * Get status-based styling for a word
   */
  const getStatusStyle = useCallback((status: WheelWordStatus) => {
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
  }, []);

  /**
   * Calculate distance-based styling for 3D effect
   * Memoized to prevent recalculation on every render
   */
  const getWordStyle = useCallback(
    (index: number, status: WheelWordStatus) => {
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
      const isExactMatch =
        words[index].word.toUpperCase() === currentGuess.toUpperCase();

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
          letterSpacing = '0.2em';
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
          letterSpacing = '0.05em';
      }

      // Boost opacity for wrong/winner words so they're always visible
      if (status === 'wrong' || status === 'winner') {
        opacity = Math.max(opacity, 0.5);
      }

      // Get base status color, then adjust based on distance for depth effect
      let color = statusStyle.color;

      // For unguessed words, use distance-based color gradation
      if (status === 'unguessed') {
        switch (distance) {
          case 0:
            color = isExactMatch ? '#dc2626' : '#000';
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

      return {
        scale,
        opacity,
        fontWeight,
        color,
        letterSpacing,
        textShadow: statusStyle.textShadow,
      };
    },
    [centerIndex, currentGuess, words, getStatusStyle]
  );

  /**
   * Render only visible words (virtualization)
   */
  const visibleWords = useMemo(() => {
    const items: JSX.Element[] = [];
    const { startIndex, endIndex } = visibleRange;

    for (let i = startIndex; i < endIndex; i++) {
      if (i >= words.length) break;

      const wheelWord = words[i];
      const style = getWordStyle(i, wheelWord.status);

      // Calculate absolute position for this item
      const topOffset = VIEWPORT_PADDING + i * ITEM_HEIGHT;
      const gapOffset = i >= gapIndex ? GAP_HEIGHT : 0;

      items.push(
        <div
          key={`${wheelWord.word}-${i}`}
          className="absolute w-full text-center transition-all duration-300 ease-out"
          style={{
            top: `${topOffset + gapOffset}px`,
            transform: `scale(${style.scale})`,
            opacity: style.opacity,
            fontWeight: style.fontWeight,
            color: style.color,
            fontSize: '1.3rem',
            lineHeight: '1.6',
            textTransform: 'uppercase',
            letterSpacing: style.letterSpacing,
            textShadow: style.textShadow,
            pointerEvents: 'none',
          }}
        >
          {wheelWord.word}
        </div>
      );
    }

    return items;
  }, [visibleRange, words, gapIndex, getWordStyle]);

  /**
   * Render the gap (input box area)
   * This creates a physical space where words cannot appear
   */
  const gapElement = useMemo(() => {
    return (
      <div
        ref={gapRef}
        className="absolute w-full"
        style={{
          top: `${gapTopOffset}px`,
          height: `${GAP_HEIGHT}px`,
          pointerEvents: 'none',
          // Create a visual barrier with a subtle background for debugging
          // backgroundColor: 'rgba(255, 0, 0, 0.05)', // Uncomment to see gap
        }}
      />
    );
  }, [gapTopOffset]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-y-auto overflow-x-hidden"
      onScroll={handleScroll}
      style={{
        pointerEvents: 'none',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        minHeight: '100%',
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
        <div
          className="relative"
          style={{
            height: `${totalHeight}px`,
            width: '100%',
          }}
        >
          {/* Gap for input boxes */}
          {gapElement}

          {/* Virtualized visible words */}
          {visibleWords}
        </div>
      )}
    </div>
  );
}

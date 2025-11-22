import { useEffect, useRef, useState, useMemo, useCallback, useDeferredValue } from 'react';
import type { InputState } from '../src/lib/input-state';
import type { WheelWord, WheelWordStatus } from '../src/types';

/**
 * Wheel Component - Milestone 4.11 with 4.5 animation behavior restored
 *
 * Animation behavior: Exact match to milestone 4.5 (proven perfect)
 * Performance: Virtualization + binary search for 10,516 words
 *
 * Key behaviors from 4.5:
 * - Native smooth scrolling feel
 * - transition-all for smooth CSS property changes
 * - Direct distance calculation from centerIndex
 * - Gap inserted BEFORE centerIndex word
 * - Simple, predictable 3D effect
 *
 * Performance optimizations:
 * - Binary search O(log n) instead of findIndex O(n)
 * - Renders only ~100 visible words instead of all 10,516
 * - useDeferredValue to keep input responsive
 */
interface WheelProps {
  words: WheelWord[];
  currentGuess: string;
  inputState?: InputState;
}

// Constants
const ITEM_HEIGHT = 33; // pixels (lineHeight 1.6 * fontSize 1.3rem ≈ 33px)
const VIEWPORT_PADDING = 400; // Top/bottom padding (≈ 40vh at 1000px height)
const OVERSCAN_COUNT = 30; // Extra items to render above/below viewport

export default function Wheel({ words, currentGuess, inputState }: WheelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gapRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const [isInitialized, setIsInitialized] = useState(false);

  /**
   * Defer expensive wheel calculations to keep input responsive (Milestone 4.11)
   * This allows input boxes to render immediately while wheel updates catch up
   */
  const deferredGuess = useDeferredValue(currentGuess);

  // Calculate GAP_HEIGHT as 10vh dynamically
  const GAP_HEIGHT = useMemo(() => {
    if (typeof window !== 'undefined') {
      return Math.round(window.innerHeight * 0.10); // 10vh
    }
    return 100; // Fallback for SSR
  }, []);

  /**
   * Binary search to find alphabetical center index (Performance optimization for 10,516 words)
   * Milestone 4.5 used findIndex O(n), now O(log n)
   */
  const getCenterIndex = useCallback((): number => {
    if (!deferredGuess || deferredGuess.length === 0 || words.length === 0) {
      return -1;
    }

    // Normalize to lowercase for alphabetical comparison
    const normalizedGuess = deferredGuess.toLowerCase();

    // Binary search for first word >= deferredGuess
    let left = 0;
    let right = words.length - 1;
    let result = words.length - 1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      if (words[mid].word.toLowerCase() >= normalizedGuess) {
        result = mid;
        right = mid - 1;
      } else {
        left = mid + 1;
      }
    }

    return result;
  }, [deferredGuess, words]);

  const centerIndex = getCenterIndex();

  /**
   * Determine where to insert the gap
   * Milestone 4.5 logic: Gap at centerIndex (alphabetical position) or middle when not typing
   */
  const gapIndex = useMemo(() => {
    if (centerIndex !== -1) {
      return centerIndex;
    }
    // Default to middle of list when not typing
    return Math.floor(words.length / 2);
  }, [centerIndex, words.length]);

  /**
   * Calculate total height for virtual scrolling
   */
  const totalHeight = useMemo(() => {
    return VIEWPORT_PADDING * 2 + words.length * ITEM_HEIGHT + GAP_HEIGHT;
  }, [words.length, GAP_HEIGHT]);

  /**
   * Calculate gap position for virtualization
   */
  const gapTopOffset = useMemo(() => {
    return VIEWPORT_PADDING + gapIndex * ITEM_HEIGHT;
  }, [gapIndex]);

  /**
   * Calculate visible range for virtualization (Performance optimization)
   * Only render ~100 words instead of all 10,516
   */
  const visibleRange = useMemo(() => {
    if (containerHeight === 0 || words.length === 0) {
      return { startIndex: 0, endIndex: Math.min(100, words.length) };
    }

    const scrollStart = Math.max(0, scrollTop - VIEWPORT_PADDING);
    const scrollEnd = scrollTop + containerHeight + VIEWPORT_PADDING;

    // Calculate indices accounting for gap
    let startIndex: number;
    if (scrollStart < gapTopOffset) {
      startIndex = Math.floor(scrollStart / ITEM_HEIGHT);
    } else {
      startIndex = Math.floor((scrollStart - GAP_HEIGHT) / ITEM_HEIGHT);
    }

    let endIndex: number;
    if (scrollEnd < gapTopOffset) {
      endIndex = Math.ceil(scrollEnd / ITEM_HEIGHT);
    } else {
      endIndex = Math.ceil((scrollEnd - GAP_HEIGHT) / ITEM_HEIGHT);
    }

    // Add overscan and clamp
    startIndex = Math.max(0, startIndex - OVERSCAN_COUNT);
    endIndex = Math.min(words.length, endIndex + OVERSCAN_COUNT);

    return { startIndex, endIndex };
  }, [scrollTop, containerHeight, words.length, gapTopOffset, GAP_HEIGHT]);

  /**
   * Track scroll position for virtualization
   */
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  /**
   * Track container height for virtualization
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
   * Auto-scroll to center the gap (Milestone 4.5 behavior restored)
   * Uses native scrollIntoView for smooth, predictable animation
   */
  useEffect(() => {
    if (!gapRef.current || !isInitialized) return;

    // Use setTimeout to defer scroll to next tick (Milestone 4.5 pattern)
    const timeoutId = setTimeout(() => {
      if (!gapRef.current) return;

      gapRef.current.scrollIntoView({
        behavior: centerIndex === -1 ? 'auto' : 'smooth', // Instant on load, smooth when typing
        block: 'center',
      });
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [centerIndex, gapIndex, words.length, isInitialized]);

  /**
   * Initialize on mount
   */
  useEffect(() => {
    if (!isInitialized && words.length > 0) {
      setIsInitialized(true);
    }
  }, [isInitialized, words.length]);

  /**
   * Get status-based styling (Milestone 4.10+)
   */
  const getStatusStyle = useCallback((status: WheelWordStatus) => {
    switch (status) {
      case 'winner':
        return {
          color: '#fbbf24',
          fontWeight: 'bold' as const,
          textShadow: '0 0 15px rgba(251, 191, 36, 0.5)',
        };
      case 'wrong':
        return {
          color: '#dc2626',
          fontWeight: 'normal' as const,
        };
      case 'unguessed':
      default:
        return {
          color: null, // Will be set by distance-based styling
          fontWeight: null,
        };
    }
  }, []);

  /**
   * Calculate distance-based styling for faux-3D effect
   * RESTORED from Milestone 4.5 - exact same logic
   */
  const getWordStyle = useCallback((index: number, status: WheelWordStatus) => {
    const statusStyle = getStatusStyle(status);

    // If word has status (wrong/winner), use status styling
    if (status === 'wrong' || status === 'winner') {
      return {
        scale: 1.0,
        opacity: status === 'winner' ? 1.0 : 0.5,
        fontWeight: statusStyle.fontWeight,
        color: statusStyle.color,
        letterSpacing: '0.05em',
        textShadow: statusStyle.textShadow,
      };
    }

    // Otherwise use distance-based 3D effect (Milestone 4.5 logic)
    if (centerIndex === -1) {
      return {
        scale: 1.0,
        opacity: 0.3,
        fontWeight: 'normal' as const,
        color: '#bbb',
        letterSpacing: '0.05em',
      };
    }

    const distance = Math.abs(index - centerIndex);
    const isExactMatch = words[index].word.toLowerCase() === currentGuess.toLowerCase();

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
        color = isExactMatch ? '#dc2626' : '#000';
        letterSpacing = '0.2em';
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
        letterSpacing = '0.05em';
    }

    return {
      scale,
      opacity,
      fontWeight,
      color,
      letterSpacing,
      textShadow: undefined,
    };
  }, [centerIndex, currentGuess, words, getStatusStyle]);

  /**
   * Render visible words with virtualization
   * Uses absolute positioning for performance
   */
  const visibleWords = useMemo(() => {
    const items: JSX.Element[] = [];
    const { startIndex, endIndex } = visibleRange;

    for (let i = startIndex; i < endIndex; i++) {
      if (i >= words.length) break;

      const wheelWord = words[i];
      const style = getWordStyle(i, wheelWord.status);

      // Calculate absolute position
      const topOffset = VIEWPORT_PADDING + i * ITEM_HEIGHT;
      const gapOffset = i >= gapIndex ? GAP_HEIGHT : 0;

      // Insert gap BEFORE word at gapIndex (Milestone 4.5 logic)
      const shouldInsertGap = i === gapIndex;

      items.push(
        <div key={`${wheelWord.word}-${i}`}>
          {shouldInsertGap && (
            <div
              ref={gapRef}
              style={{
                position: 'absolute',
                top: `${topOffset}px`,
                width: '100%',
                height: `${GAP_HEIGHT}px`,
                pointerEvents: 'none',
              }}
            />
          )}
          <div
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
        </div>
      );
    }

    return items;
  }, [visibleRange, words, gapIndex, getWordStyle, GAP_HEIGHT]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-y-auto overflow-x-hidden"
      onScroll={handleScroll}
      style={{
        pointerEvents: 'none',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
      }}
    >
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
          {visibleWords}
        </div>
      )}
    </div>
  );
}

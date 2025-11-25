import { useEffect, useRef, useState, useMemo, useCallback, useDeferredValue } from 'react';
import type { InputState } from '../src/lib/input-state';
import type { WheelWord, WheelWordStatus } from '../src/types';

/**
 * Wheel Component - Milestone 4.11 with 4.5 animation behavior restored + 6.4 performance tuning
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
 *
 * Milestone 6.4: Animation performance tuning
 * - Reduced transition duration: 200ms (was 300ms)
 * - Custom scroll animation with capped duration (100-250ms)
 * - will-change: transform for GPU acceleration
 * - Debug mode via WHEEL_ANIMATION_DEBUG_SLOW config
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

/**
 * Milestone 6.4: Animation timing constants
 * These can be overridden by env vars for debugging
 */
const ANIMATION_DURATION_MIN = 100; // Minimum animation duration (ms)
const ANIMATION_DURATION_MAX = 250; // Maximum animation duration (ms) - caps long jumps
const ANIMATION_DURATION_DEFAULT = 200; // Default for most operations
const CSS_TRANSITION_DURATION = 200; // CSS property transitions (ms)

// Debug mode: set NEXT_PUBLIC_WHEEL_ANIMATION_DEBUG_SLOW=true to slow animations
const DEBUG_SLOW_MODE = typeof window !== 'undefined' &&
  process.env.NEXT_PUBLIC_WHEEL_ANIMATION_DEBUG_SLOW === 'true';
const DEBUG_DURATION_MULTIPLIER = 3; // Slow down animations 3x in debug mode

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
   * Gap should appear AFTER centerIndex so focused word appears ABOVE gap
   * Special case: For last word, gap appears BEFORE it
   */
  const gapIndex = useMemo(() => {
    if (centerIndex !== -1) {
      // Special case: if centering last word, put gap BEFORE it
      if (centerIndex === words.length - 1) {
        return centerIndex;
      }
      // Normal case: gap AFTER centered word (so word appears above gap)
      return centerIndex + 1;
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
   * CRITICAL: Always include gapIndex to ensure gap can be scrolled to
   */
  const visibleRange = useMemo(() => {
    if (words.length === 0) {
      return { startIndex: 0, endIndex: 0 };
    }

    // On initial load (containerHeight = 0), render range around gap
    if (containerHeight === 0) {
      const start = Math.max(0, gapIndex - 50);
      const end = Math.min(words.length, gapIndex + 50);
      return { startIndex: start, endIndex: end };
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

    // CRITICAL: Always include gapIndex to ensure gap can be rendered and scrolled to
    if (gapIndex < startIndex || gapIndex > endIndex) {
      startIndex = Math.min(startIndex, gapIndex);
      endIndex = Math.max(endIndex, gapIndex + 1);
    }

    return { startIndex, endIndex };
  }, [scrollTop, containerHeight, words.length, gapTopOffset, GAP_HEIGHT, gapIndex]);

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
   * Milestone 6.4: Custom scroll animation with capped duration
   * Ensures animation completes within 100-250ms regardless of distance
   */
  const animateScrollTo = useCallback((targetScrollTop: number, immediate: boolean = false) => {
    const container = containerRef.current;
    if (!container) return;

    // Immediate scroll (initial load)
    if (immediate) {
      container.scrollTop = targetScrollTop;
      return;
    }

    const startScrollTop = container.scrollTop;
    const distance = Math.abs(targetScrollTop - startScrollTop);

    // Skip animation if already at target
    if (distance < 1) return;

    // Calculate duration based on distance, capped within min/max
    // Faster for short jumps, capped for long jumps (A->Z should feel same as C->D)
    let duration = Math.min(
      ANIMATION_DURATION_MAX,
      Math.max(ANIMATION_DURATION_MIN, distance * 0.5)
    );

    // Apply debug multiplier if in slow mode
    if (DEBUG_SLOW_MODE) {
      duration *= DEBUG_DURATION_MULTIPLIER;
    }

    const startTime = performance.now();

    // Easing function: easeOutCubic for natural deceleration
    const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(1, elapsed / duration);
      const easedProgress = easeOutCubic(progress);

      container.scrollTop = startScrollTop + (targetScrollTop - startScrollTop) * easedProgress;

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  }, []);

  /**
   * Auto-scroll to center the gap (Milestone 4.5 behavior restored + 6.4 performance)
   * Uses custom animation with capped duration for consistent feel
   */
  useEffect(() => {
    if (!gapRef.current || !containerRef.current) {
      return;
    }
    if (!isInitialized) {
      return;
    }

    // Calculate target scroll position to center the gap
    const container = containerRef.current;
    const gapTop = gapTopOffset;
    const containerMiddle = container.clientHeight / 2;
    const targetScrollTop = gapTop - containerMiddle + GAP_HEIGHT / 2;

    // Use setTimeout to defer scroll to next tick (allows DOM to update)
    const timeoutId = setTimeout(() => {
      // Instant on initial load (centerIndex === -1), animated when typing
      animateScrollTo(targetScrollTop, centerIndex === -1);
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [centerIndex, gapTopOffset, GAP_HEIGHT, isInitialized, animateScrollTo]);

  /**
   * Initialize on mount
   */
  useEffect(() => {
    if (!isInitialized && words.length > 0) {
      console.log('[Wheel] Initializing, words.length:', words.length, 'gapIndex:', gapIndex);
      setIsInitialized(true);
    }
  }, [isInitialized, words.length, gapIndex]);

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

    // Default values (for no typing / far away words)
    if (centerIndex === -1) {
      // No typing - show all words dimmed
      if (status === 'winner') {
        return {
          scale: 1.0,
          opacity: 1.0,
          fontWeight: statusStyle.fontWeight,
          color: statusStyle.color,
          letterSpacing: '0.05em',
          textShadow: statusStyle.textShadow,
        };
      } else if (status === 'wrong') {
        return {
          scale: 1.0,
          opacity: 0.5,
          fontWeight: 'normal' as const,
          color: statusStyle.color,
          letterSpacing: '0.05em',
        };
      } else {
        return {
          scale: 1.0,
          opacity: 0.3,
          fontWeight: 'normal' as const,
          color: '#bbb',
          letterSpacing: '0.05em',
        };
      }
    }

    // Calculate distance from focused word
    const distance = Math.abs(index - centerIndex);

    // Distance-based scale, opacity, fontWeight, letterSpacing
    let scale = 1.0;
    let opacity = 0.25;
    let fontWeight: 'bold' | 'normal' | '300' = 'normal';
    let color = '#bbb';
    let letterSpacing = '0.05em';
    let textShadow: string | undefined = undefined;

    switch (distance) {
      case 0:
        scale = 1.4;
        opacity = 1.0;
        fontWeight = 'bold';
        letterSpacing = '0.2em';
        // Color depends on status
        if (status === 'winner') {
          color = '#22c55e'; // Green for winner when focused
          textShadow = '0 0 15px rgba(34, 197, 94, 0.5)';
        } else if (status === 'wrong') {
          color = '#dc2626'; // Red for already guessed
        } else {
          color = '#000'; // Black for unguessed
        }
        break;
      case 1:
        scale = 1.2;
        opacity = status === 'wrong' ? 0.6 : 0.7;
        fontWeight = 'normal';
        letterSpacing = '0.15em';
        if (status === 'winner') {
          color = statusStyle.color;
          textShadow = statusStyle.textShadow;
        } else if (status === 'wrong') {
          color = statusStyle.color;
        } else {
          color = '#666';
        }
        break;
      case 2:
        scale = 1.1;
        opacity = status === 'wrong' ? 0.5 : 0.5;
        fontWeight = 'normal';
        letterSpacing = '0.1em';
        if (status === 'winner') {
          color = statusStyle.color;
          textShadow = statusStyle.textShadow;
        } else if (status === 'wrong') {
          color = statusStyle.color;
        } else {
          color = '#999';
        }
        break;
      case 3:
        scale = 1.05;
        opacity = status === 'wrong' ? 0.4 : 0.35;
        fontWeight = '300';
        letterSpacing = '0.07em';
        if (status === 'winner') {
          color = statusStyle.color;
          textShadow = statusStyle.textShadow;
        } else if (status === 'wrong') {
          color = statusStyle.color;
        } else {
          color = '#aaa';
        }
        break;
      default:
        scale = 1.0;
        opacity = status === 'wrong' ? 0.3 : 0.25;
        fontWeight = '300';
        letterSpacing = '0.05em';
        if (status === 'winner') {
          color = statusStyle.color;
          textShadow = statusStyle.textShadow;
        } else if (status === 'wrong') {
          color = statusStyle.color;
        } else {
          color = '#bbb';
        }
    }

    return {
      scale,
      opacity,
      fontWeight,
      color,
      letterSpacing,
      textShadow,
    };
  }, [centerIndex, getStatusStyle]);

  /**
   * Render visible words with virtualization
   * Uses absolute positioning for performance
   */
  const visibleWords = useMemo(() => {
    const items: JSX.Element[] = [];
    const { startIndex, endIndex } = visibleRange;

    console.log('[Wheel] Rendering range:', startIndex, '-', endIndex, 'gapIndex:', gapIndex, 'words.length:', words.length);

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
            className="absolute w-full text-center transition-all ease-out"
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
              // Milestone 6.4: Optimized animation settings
              transitionDuration: `${DEBUG_SLOW_MODE ? CSS_TRANSITION_DURATION * DEBUG_DURATION_MULTIPLIER : CSS_TRANSITION_DURATION}ms`,
              willChange: 'transform, opacity',
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

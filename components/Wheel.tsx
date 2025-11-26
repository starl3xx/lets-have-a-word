import { useEffect, useRef, useState, useMemo, useCallback, useDeferredValue, useLayoutEffect } from 'react';
import type { InputState } from '../src/lib/input-state';
import type { WheelWord, WheelWordStatus } from '../src/types';
import { devLog, perfLog, logWheelAnimationStart, logWheelAnimationEnd } from '../src/lib/perf-debug';

/**
 * Wheel Component - Milestone 4.11 with 4.5 animation behavior restored + 6.4.5 uniform jump UX + 6.4.8 alive animation
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
 *
 * Milestone 6.4.3: Performance audit improvements
 * - Console.log statements gated behind dev mode checks
 * - Performance debugging hooks for timing measurements
 * - All debug output uses devLog/perfLog utilities
 *
 * Milestone 6.4.5: Uniform Jump UX - Two-Mode Animation
 * =====================================================
 * Problem: Large letter jumps (e.g., D→R) felt slower than small jumps (D→E)
 * even with capped duration, because the wheel visibly scrolled through many rows.
 *
 * Solution: Two-mode animation based on row distance:
 *
 * 1. SMALL JUMPS (≤ JUMP_THRESHOLD rows):
 *    - Smooth scroll animation from current position to target
 *    - Fixed duration (ANIMATION_DURATION_UNIFORM) regardless of distance
 *    - User sees the wheel slide naturally to the new position
 *
 * 2. LARGE JUMPS (> JUMP_THRESHOLD rows):
 *    - "Teleport + Settle" approach:
 *      a) Instantly snap to a position SETTLE_ROWS before the target (no visible scroll)
 *      b) Animate the final SETTLE_ROWS with the same duration as small jumps
 *    - User never sees a long "train ride" scroll - just a quick snap + small settle
 *    - Feels equally fast and snappy as small jumps
 *
 * Milestone 6.4.8: Alive Wheel Animation
 * ======================================
 * Problem: Post-6.4.5, the wheel feels mechanical/dead due to pure teleport.
 *
 * Solution: Add "momentum micro-scroll" effect for physical feel:
 * - Large jumps show a brief directional motion before settling (3-6 frames)
 * - Enhanced 3D depth scaling for carousel feel
 * - Spring-like easing with subtle overshoot for "weight" sensation
 * - Keeps total animation under 180ms for speed
 *
 * Milestone 6.4.9: Polish Animation Feel
 * ======================================
 * - Reduced spring overshoot (c1: 1.70158 → 0.9) for gentler bounce
 * - Added subtle blur for distance 5+ words (0.3-0.8px) for depth perception
 *
 * Reduced Motion: If prefers-reduced-motion is enabled, all animations snap instantly.
 */
interface WheelProps {
  words: WheelWord[];
  currentGuess: string;
  inputState?: InputState;
  startIndex?: number | null; // Milestone 4.14: Initial wheel position (randomizes in dev mode)
}

// Constants
const ITEM_HEIGHT = 33; // pixels - FIXED CSS height for consistent layout regardless of font load
const VIEWPORT_PADDING = 400; // Top/bottom padding (≈ 40vh at 1000px height)
const OVERSCAN_COUNT = 30; // Extra items to render above/below viewport

/**
 * Milestone 6.4.5 + 6.4.8: Jump animation configuration
 * These control the two-mode jump behavior with "alive" momentum effect
 */
const JUMP_THRESHOLD = 10; // Rows: jumps larger than this use teleport + momentum + settle
const SETTLE_ROWS = 5; // Rows: how many rows to animate after teleport (increased for more visible motion)
const MOMENTUM_ROWS = 2; // Rows: brief "wind-up" motion in opposite direction for momentum feel
const ANIMATION_DURATION_UNIFORM = 160; // ms: fixed duration for ALL visible animations
const MOMENTUM_DURATION = 50; // ms: brief momentum micro-scroll before settle
const CSS_TRANSITION_DURATION = 160; // CSS property transitions (ms) - matched to scroll animation

// Debug mode: set NEXT_PUBLIC_WHEEL_ANIMATION_DEBUG_SLOW=true to slow animations
const DEBUG_SLOW_MODE = typeof window !== 'undefined' &&
  process.env.NEXT_PUBLIC_WHEEL_ANIMATION_DEBUG_SLOW === 'true';
const DEBUG_DURATION_MULTIPLIER = 3; // Slow down animations 3x in debug mode

/**
 * Check if user prefers reduced motion
 */
const prefersReducedMotion = (): boolean => {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
};

export default function Wheel({ words, currentGuess, inputState, startIndex }: WheelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gapRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const [isInitialized, setIsInitialized] = useState(false);
  const [fontsReady, setFontsReady] = useState(false);

  // Track previous gapIndex to calculate jump distance
  const prevGapIndexRef = useRef<number | null>(null);

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
   * Milestone 4.14: Uses startIndex for initial position (randomizes in dev mode)
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
    // Use startIndex if provided, otherwise default to middle of list
    if (startIndex !== null && startIndex !== undefined && startIndex >= 0 && startIndex < words.length) {
      return startIndex;
    }
    // Fallback to middle of list when not typing and no startIndex
    return Math.floor(words.length / 2);
  }, [centerIndex, words.length, startIndex]);

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
   * Wait for fonts to load before initializing wheel
   * This prevents misalignment caused by font metric changes
   */
  useLayoutEffect(() => {
    const waitForFonts = async () => {
      if (typeof document !== 'undefined' && 'fonts' in document) {
        try {
          await document.fonts.ready;
          devLog('Wheel', 'Fonts loaded, ready to center');
        } catch (err) {
          devLog('Wheel', 'Font load detection failed:', err);
        }
      }
      setFontsReady(true);
    };

    waitForFonts();
  }, []);

  /**
   * Track container height for virtualization
   * Uses useLayoutEffect for synchronous measurement after font load
   */
  useLayoutEffect(() => {
    if (!containerRef.current) return;

    const updateHeight = () => {
      if (containerRef.current) {
        const newHeight = containerRef.current.clientHeight;
        setContainerHeight(newHeight);
        devLog('Wheel', 'Container height updated:', newHeight);
      }
    };

    // Initial measurement
    updateHeight();

    // Re-measure on resize and orientation change
    window.addEventListener('resize', updateHeight);
    window.addEventListener('orientationchange', updateHeight);

    // Re-measure on font load events
    if ('fonts' in document) {
      document.fonts.addEventListener('loadingdone', updateHeight);
    }

    return () => {
      window.removeEventListener('resize', updateHeight);
      window.removeEventListener('orientationchange', updateHeight);
      if ('fonts' in document) {
        document.fonts.removeEventListener('loadingdone', updateHeight);
      }
    };
  }, []);

  /**
   * Milestone 6.4.5 + 6.4.8: Two-mode scroll animation with "alive" momentum effect
   *
   * Small jumps: Smooth scroll with fixed duration
   * Large jumps: Teleport + momentum micro-scroll + settle animation
   *              Creates a physical, tactile feel without long scroll durations
   *
   * @param targetScrollTop - Final scroll position
   * @param rowDelta - Number of rows being jumped (used to determine animation mode)
   * @param immediate - If true, skip all animation (used for initial load)
   */
  const animateScrollTo = useCallback((
    targetScrollTop: number,
    rowDelta: number,
    immediate: boolean = false
  ) => {
    const container = containerRef.current;
    if (!container) return;

    // Immediate scroll (initial load or reduced motion preference)
    if (immediate || prefersReducedMotion()) {
      container.scrollTop = targetScrollTop;
      devLog('Wheel', 'Instant scroll (immediate or reduced-motion)');
      return;
    }

    const startScrollTop = container.scrollTop;
    const pixelDistance = Math.abs(targetScrollTop - startScrollTop);

    // Skip animation if already at target
    if (pixelDistance < 1) return;

    // Determine animation mode based on row delta
    const isLargeJump = Math.abs(rowDelta) > JUMP_THRESHOLD;
    const direction = targetScrollTop > startScrollTop ? 1 : -1;

    // Milestone 6.4.3: Log animation start for performance debugging
    logWheelAnimationStart();

    // Easing functions
    // easeOutCubic: Natural deceleration for main animation
    const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
    // easeOutBack: Subtle overshoot for spring-like physical feel (6.4.8, tuned 6.4.9)
    const easeOutBack = (t: number): number => {
      const c1 = 0.9; // Reduced from 1.70158 for gentler overshoot
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    };

    if (isLargeJump) {
      // LARGE JUMP: Teleport + Momentum + Settle (Milestone 6.4.8 "alive" animation)
      // 1. Teleport to position BEFORE the settle zone
      // 2. Brief momentum micro-scroll in scroll direction (creates "arriving" feel)
      // 3. Settle to final position with slight spring overshoot

      const settleDistance = SETTLE_ROWS * ITEM_HEIGHT;
      const momentumDistance = MOMENTUM_ROWS * ITEM_HEIGHT;

      // Teleport position: before the momentum start
      const teleportPos = targetScrollTop - (direction * (settleDistance + momentumDistance));

      // Momentum start: where the visible animation begins
      const momentumStartPos = teleportPos;
      const momentumEndPos = targetScrollTop - (direction * settleDistance);

      // Settle: final phase
      const settleStartPos = momentumEndPos;
      const settleEndPos = targetScrollTop;

      devLog('Wheel', `Large jump (${rowDelta} rows): teleport=${teleportPos}, momentum=${momentumStartPos}→${momentumEndPos}, settle=${settleStartPos}→${settleEndPos}`);

      // Phase 1: Instant teleport
      container.scrollTop = teleportPos;

      // Apply debug multiplier if in slow mode
      const debugMultiplier = DEBUG_SLOW_MODE ? DEBUG_DURATION_MULTIPLIER : 1;
      const momentumDuration = MOMENTUM_DURATION * debugMultiplier;
      const settleDuration = ANIMATION_DURATION_UNIFORM * debugMultiplier;

      const startTime = performance.now();
      const totalDistance = Math.abs(settleEndPos - momentumStartPos);

      // Phase 2 & 3: Momentum micro-scroll + Settle (combined for smoothness)
      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const totalDuration = momentumDuration + settleDuration;

        if (elapsed < momentumDuration) {
          // Phase 2: Momentum micro-scroll (quick, linear feel)
          const momentumProgress = elapsed / momentumDuration;
          const easedMomentum = momentumProgress; // Linear for quick snap feel
          container.scrollTop = momentumStartPos + (momentumEndPos - momentumStartPos) * easedMomentum;
          requestAnimationFrame(animate);
        } else if (elapsed < totalDuration) {
          // Phase 3: Settle with spring overshoot
          const settleElapsed = elapsed - momentumDuration;
          const settleProgress = Math.min(1, settleElapsed / settleDuration);
          const easedSettle = easeOutBack(settleProgress); // Spring overshoot for "weight"
          container.scrollTop = settleStartPos + (settleEndPos - settleStartPos) * easedSettle;
          requestAnimationFrame(animate);
        } else {
          // Animation complete - ensure we're exactly at target
          container.scrollTop = targetScrollTop;
          logWheelAnimationEnd(totalDistance, totalDuration);
        }
      };

      requestAnimationFrame(animate);
    } else {
      // SMALL JUMP: Normal smooth scroll with slight spring
      const animationStartPos = startScrollTop;
      const animationEndPos = targetScrollTop;

      devLog('Wheel', `Small jump (${rowDelta} rows): smooth scroll from ${startScrollTop} to ${targetScrollTop}`);

      // Fixed duration for uniform perceived speed
      let duration = ANIMATION_DURATION_UNIFORM;

      // Apply debug multiplier if in slow mode
      if (DEBUG_SLOW_MODE) {
        duration *= DEBUG_DURATION_MULTIPLIER;
      }

      const startTime = performance.now();
      const animationDistance = Math.abs(animationEndPos - animationStartPos);

      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(1, elapsed / duration);
        // Use easeOutCubic for small jumps (natural, no overshoot needed)
        const easedProgress = easeOutCubic(progress);

        container.scrollTop = animationStartPos + (animationEndPos - animationStartPos) * easedProgress;

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          // Milestone 6.4.3: Log animation end for performance debugging
          logWheelAnimationEnd(animationDistance, duration);
        }
      };

      requestAnimationFrame(animate);
    }
  }, []);

  /**
   * Auto-scroll to center the gap (Milestone 4.5 behavior restored + 6.4.5 + 6.4.8 alive animation)
   * Uses two-mode animation:
   * - Small jumps: smooth scroll
   * - Large jumps: teleport + momentum micro-scroll + spring settle
   *
   * Milestone 6.4.2: Uses useLayoutEffect and waits for fonts to prevent misalignment
   * Milestone 6.4.5: Calculates row delta for uniform perceived speed
   * Milestone 6.4.8: Adds momentum micro-scroll for "alive" physical feel
   */
  useLayoutEffect(() => {
    if (!gapRef.current || !containerRef.current) {
      return;
    }
    if (!isInitialized || !fontsReady) {
      return;
    }

    // Calculate target scroll position to center the gap
    const container = containerRef.current;
    const gapTop = gapTopOffset;
    const containerMiddle = container.clientHeight / 2;
    const targetScrollTop = gapTop - containerMiddle + GAP_HEIGHT / 2;

    // Calculate row delta for animation mode selection
    const prevGapIndex = prevGapIndexRef.current;
    const rowDelta = prevGapIndex !== null ? gapIndex - prevGapIndex : 0;

    devLog('Wheel', 'Centering - gapIndex:', gapIndex, 'prevGapIndex:', prevGapIndex, 'rowDelta:', rowDelta, 'targetScrollTop:', targetScrollTop);

    // Update previous gapIndex for next calculation
    prevGapIndexRef.current = gapIndex;

    // Use setTimeout to defer scroll to next tick (allows DOM to update)
    const timeoutId = setTimeout(() => {
      // Instant on initial load (centerIndex === -1 and no previous position), animated when typing
      const isInitialPosition = centerIndex === -1 && prevGapIndex === null;
      animateScrollTo(targetScrollTop, rowDelta, isInitialPosition);

      // Dev-mode alignment validator
      if (process.env.NODE_ENV === 'development' && centerIndex === -1) {
        setTimeout(() => {
          validateAlignment(container, gapTop, containerMiddle);
        }, 100); // Wait for scroll to complete
      }
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [centerIndex, gapIndex, gapTopOffset, GAP_HEIGHT, isInitialized, fontsReady, animateScrollTo]);

  /**
   * Initialize on mount - only after fonts are ready
   */
  useEffect(() => {
    if (!isInitialized && words.length > 0 && fontsReady) {
      devLog('Wheel', 'Initializing, words.length:', words.length, 'gapIndex:', gapIndex);
      setIsInitialized(true);
    }
  }, [isInitialized, words.length, gapIndex, fontsReady]);

  /**
   * Dev-mode alignment validator
   * Checks if the wheel is properly centered and logs warnings if not
   */
  const validateAlignment = useCallback((
    container: HTMLDivElement,
    gapTop: number,
    containerMiddle: number
  ) => {
    if (process.env.NODE_ENV !== 'development') return;

    const currentScrollTop = container.scrollTop;
    const expectedScrollTop = gapTop - containerMiddle + GAP_HEIGHT / 2;
    const diff = Math.abs(currentScrollTop - expectedScrollTop);
    const tolerance = 5; // pixels

    if (diff > tolerance) {
      devLog('Wheel', 'MISALIGNED!', {
        expected: expectedScrollTop,
        actual: currentScrollTop,
        diff,
        gapTop,
        containerMiddle,
        containerHeight: container.clientHeight,
        itemHeight: ITEM_HEIGHT,
      });
    } else {
      devLog('Wheel', '✓ Properly centered (diff:', diff.toFixed(1), 'px)');
    }
  }, [GAP_HEIGHT]);

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
   * Calculate distance-based styling for faux-3D carousel effect
   * Milestone 4.5 logic ENHANCED in 6.4.8 for more pronounced depth
   *
   * Creates a "physical wheel" feel with:
   * - Dramatic scale gradient (1.5x at center → 0.9x at edges)
   * - Smooth opacity falloff
   * - Subtle blur hint for depth (via opacity)
   * - Letter-spacing that "spreads" as words come into focus
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
          translateY: 0,
        };
      } else if (status === 'wrong') {
        return {
          scale: 1.0,
          opacity: 0.5,
          fontWeight: 'normal' as const,
          color: statusStyle.color,
          letterSpacing: '0.05em',
          translateY: 0,
        };
      } else {
        return {
          scale: 1.0,
          opacity: 0.3,
          fontWeight: 'normal' as const,
          color: '#bbb',
          letterSpacing: '0.05em',
          translateY: 0,
        };
      }
    }

    // Calculate distance from focused word
    const distance = Math.abs(index - centerIndex);

    // Distance-based scale, opacity, fontWeight, letterSpacing
    // Enhanced in 6.4.8 for more dramatic 3D carousel effect
    let scale = 1.0;
    let opacity = 0.2;
    let fontWeight: 'bold' | 'normal' | '300' = 'normal';
    let color = '#bbb';
    let letterSpacing = '0.05em';
    let textShadow: string | undefined = undefined;
    let translateY = 0; // Subtle Y offset for curved carousel feel

    switch (distance) {
      case 0:
        // CENTER: Maximum emphasis - "popping out" of the wheel
        scale = 1.5; // Increased from 1.4 for more dramatic effect
        opacity = 1.0;
        fontWeight = 'bold';
        letterSpacing = '0.22em'; // Slightly wider
        translateY = 0;
        // Color depends on status
        if (status === 'winner') {
          color = '#22c55e';
          textShadow = '0 0 20px rgba(34, 197, 94, 0.6)';
        } else if (status === 'wrong') {
          color = '#dc2626';
        } else {
          color = '#000';
        }
        break;
      case 1:
        // NEAR: Clearly visible, receding into wheel
        scale = 1.25; // Increased from 1.2
        opacity = status === 'wrong' ? 0.65 : 0.75;
        fontWeight = 'normal';
        letterSpacing = '0.15em';
        translateY = 0;
        if (status === 'winner') {
          color = statusStyle.color;
          textShadow = statusStyle.textShadow;
        } else if (status === 'wrong') {
          color = statusStyle.color;
        } else {
          color = '#555';
        }
        break;
      case 2:
        // MEDIUM: Fading into background
        scale = 1.1;
        opacity = status === 'wrong' ? 0.5 : 0.5;
        fontWeight = 'normal';
        letterSpacing = '0.1em';
        translateY = 0;
        if (status === 'winner') {
          color = statusStyle.color;
          textShadow = statusStyle.textShadow;
        } else if (status === 'wrong') {
          color = statusStyle.color;
        } else {
          color = '#888';
        }
        break;
      case 3:
        // FAR: Almost in the background
        scale = 1.0;
        opacity = status === 'wrong' ? 0.4 : 0.35;
        fontWeight = '300';
        letterSpacing = '0.07em';
        translateY = 0;
        if (status === 'winner') {
          color = statusStyle.color;
          textShadow = statusStyle.textShadow;
        } else if (status === 'wrong') {
          color = statusStyle.color;
        } else {
          color = '#aaa';
        }
        break;
      case 4:
        // VERY FAR: Receding edge
        scale = 0.95; // Slightly smaller for depth
        opacity = status === 'wrong' ? 0.3 : 0.25;
        fontWeight = '300';
        letterSpacing = '0.05em';
        translateY = 0;
        if (status === 'winner') {
          color = statusStyle.color;
          textShadow = statusStyle.textShadow;
        } else if (status === 'wrong') {
          color = statusStyle.color;
        } else {
          color = '#bbb';
        }
        break;
      case 5:
        // FAR EDGE: Subtle blur begins
        scale = 0.9;
        opacity = status === 'wrong' ? 0.25 : 0.2;
        fontWeight = '300';
        letterSpacing = '0.03em';
        if (status === 'winner') {
          color = statusStyle.color;
          textShadow = statusStyle.textShadow;
        } else if (status === 'wrong') {
          color = statusStyle.color;
        } else {
          color = '#ccc';
        }
        break;
      default:
        // EDGE: Far background with subtle blur for depth
        scale = 0.9; // Even smaller for carousel curve effect
        opacity = status === 'wrong' ? 0.25 : 0.2;
        fontWeight = '300';
        letterSpacing = '0.03em';
        if (status === 'winner') {
          color = statusStyle.color;
          textShadow = statusStyle.textShadow;
        } else if (status === 'wrong') {
          color = statusStyle.color;
        } else {
          color = '#ccc';
        }
    }

    // Calculate subtle blur for depth effect (6.4.9)
    // Blur starts at distance 5 and increases slightly for further words
    let filter: string | undefined = undefined;
    if (centerIndex !== -1 && distance >= 5) {
      const blurAmount = Math.min(0.8, (distance - 4) * 0.3); // 0.3px at 5, 0.6px at 6, capped at 0.8px
      filter = `blur(${blurAmount}px)`;
    }

    return {
      scale,
      opacity,
      fontWeight,
      color,
      letterSpacing,
      textShadow,
      translateY,
      filter,
    };
  }, [centerIndex, getStatusStyle]);

  /**
   * Render visible words with virtualization
   * Uses absolute positioning for performance
   */
  const visibleWords = useMemo(() => {
    const items: JSX.Element[] = [];
    const { startIndex, endIndex } = visibleRange;

    perfLog('Wheel', 'Rendering range:', startIndex, '-', endIndex, 'gapIndex:', gapIndex, 'words.length:', words.length);

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
            className="absolute w-full text-center transition-all ease-out flex items-center justify-center"
            style={{
              top: `${topOffset + gapOffset}px`,
              height: `${ITEM_HEIGHT}px`, // FIXED height to prevent font-load misalignment
              transform: `scale(${style.scale})`,
              opacity: style.opacity,
              fontWeight: style.fontWeight,
              color: style.color,
              fontSize: '1.3rem',
              textTransform: 'uppercase',
              letterSpacing: style.letterSpacing,
              textShadow: style.textShadow,
              filter: style.filter,
              pointerEvents: 'none',
              // Milestone 6.4: Optimized animation settings
              transitionDuration: `${DEBUG_SLOW_MODE ? CSS_TRANSITION_DURATION * DEBUG_DURATION_MULTIPLIER : CSS_TRANSITION_DURATION}ms`,
              willChange: 'transform, opacity, filter',
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

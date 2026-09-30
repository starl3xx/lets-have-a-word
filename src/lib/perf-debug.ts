/**
 * Performance Debugging Utilities
 * Milestone 6.4.3 — Input & Word Wheel Performance Audit
 *
 * Dev-only utilities for inspecting performance metrics:
 * - Time between keydown and first paint
 * - Time between keydown and wheel animation start
 * - Extreme wheel jump simulations
 *
 * Enable via: NEXT_PUBLIC_PERF_DEBUG=true
 */

/**
 * Check if performance debugging is enabled
 */
export function isPerfDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return process.env.NEXT_PUBLIC_PERF_DEBUG === 'true';
}

/**
 * Performance marker names
 */
export const PerfMarkers = {
  KEYDOWN: 'perf:keydown',
  INPUT_PAINTED: 'perf:input-painted',
  WHEEL_ANIMATION_START: 'perf:wheel-animation-start',
  WHEEL_ANIMATION_END: 'perf:wheel-animation-end',
} as const;

/**
 * Mark a performance event
 * Only runs in development with NEXT_PUBLIC_PERF_DEBUG=true
 */
export function perfMark(name: string): void {
  if (!isPerfDebugEnabled()) return;
  if (typeof performance === 'undefined') return;

  try {
    performance.mark(name);
  } catch (e) {
    // Ignore - performance API not available
  }
}

/**
 * Measure time between two performance marks
 * Returns duration in milliseconds, or null if measurement fails
 */
export function perfMeasure(name: string, startMark: string, endMark: string): number | null {
  if (!isPerfDebugEnabled()) return null;
  if (typeof performance === 'undefined') return null;

  try {
    const measure = performance.measure(name, startMark, endMark);
    return measure.duration;
  } catch (e) {
    return null;
  }
}

/**
 * Clear all performance marks and measures
 */
export function perfClear(): void {
  if (!isPerfDebugEnabled()) return;
  if (typeof performance === 'undefined') return;

  try {
    performance.clearMarks();
    performance.clearMeasures();
  } catch (e) {
    // Ignore
  }
}

/**
 * Log input performance metrics
 * Called after input boxes render to measure keydown-to-paint time
 */
export function logInputPerformance(): void {
  if (!isPerfDebugEnabled()) return;

  const duration = perfMeasure(
    'input-paint-time',
    PerfMarkers.KEYDOWN,
    PerfMarkers.INPUT_PAINTED
  );

  if (duration !== null) {
    console.log(`[Perf] Input paint time: ${duration.toFixed(2)}ms`);
  }
}

/**
 * Log wheel animation performance metrics
 * Called when wheel animation starts
 */
export function logWheelAnimationStart(): void {
  if (!isPerfDebugEnabled()) return;

  perfMark(PerfMarkers.WHEEL_ANIMATION_START);

  const duration = perfMeasure(
    'keydown-to-wheel',
    PerfMarkers.KEYDOWN,
    PerfMarkers.WHEEL_ANIMATION_START
  );

  if (duration !== null) {
    console.log(`[Perf] Keydown to wheel animation: ${duration.toFixed(2)}ms`);
  }
}

/**
 * Log wheel animation completion
 */
export function logWheelAnimationEnd(scrollDistance: number, animationDuration: number): void {
  if (!isPerfDebugEnabled()) return;

  perfMark(PerfMarkers.WHEEL_ANIMATION_END);
  console.log(`[Perf] Wheel animation: ${animationDuration.toFixed(0)}ms for ${scrollDistance.toFixed(0)}px`);
}

/**
 * Mark keydown event for performance measurement
 * Should be called in the keydown handler
 */
export function markKeydown(): void {
  if (!isPerfDebugEnabled()) return;
  perfClear(); // Clear previous measurements
  perfMark(PerfMarkers.KEYDOWN);
}

/**
 * Mark input painted event
 * Should be called after input boxes re-render
 */
export function markInputPainted(): void {
  if (!isPerfDebugEnabled()) return;
  perfMark(PerfMarkers.INPUT_PAINTED);
  logInputPerformance();
}

/**
 * Log a dev mode debug message (only in development)
 */
export function devLog(category: string, ...args: unknown[]): void {
  if (process.env.NODE_ENV !== 'development') return;
  console.log(`[${category}]`, ...args);
}

/**
 * Log a dev mode debug message (only when PERF_DEBUG is enabled)
 */
export function perfLog(category: string, ...args: unknown[]): void {
  if (!isPerfDebugEnabled()) return;
  console.log(`[Perf:${category}]`, ...args);
}

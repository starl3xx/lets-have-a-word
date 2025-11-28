/**
 * GuessBar Component
 * Milestone 6.5: Unified Guess Bar UX
 * Milestone 6.8: Added pill styling and decrement pulse animation
 *
 * Single-line, intuitive, fully transparent guess-status bar that:
 * - Shows total guesses left in a subtle pill
 * - Shows all sources of guesses
 * - Shows which sources have been consumed
 * - Works for all user types
 * - Pulses briefly when guesses decrease
 *
 * Layout:
 * Left: "X guesses left" (pill)
 * Right: "1 free · +2 CLANKTON · +1 share · +3 paid"
 *
 * Rules:
 * - Order of appearance: Free, CLANKTON, Share, Paid
 * - CLANKTON only shows if user is a holder
 * - Paid only shows if user has purchased packs
 * - Consumed sources are visually faded (opacity 40%)
 */

import { useState, useEffect, useRef } from 'react';
import type { GuessSourceState } from '../src/types';

interface GuessBarProps {
  sourceState: GuessSourceState;
}

/**
 * Individual source segment component
 */
interface SourceSegmentProps {
  label: string;
  value: number;
  isConsumed: boolean;
  isFirst?: boolean;
  color?: string;
}

function SourceSegment({ label, value, isConsumed, isFirst, color }: SourceSegmentProps) {
  const prefix = isFirst ? '' : '+';
  const displayValue = isFirst ? value : value;

  return (
    <span
      className={`transition-opacity duration-200 ${isConsumed ? 'opacity-40' : 'opacity-100'}`}
      style={{ color: isConsumed ? undefined : color }}
    >
      {!isFirst && <span className="text-gray-400 mx-1">·</span>}
      <span className={isConsumed ? 'line-through' : ''}>
        {prefix}{displayValue} {label}
      </span>
    </span>
  );
}

/**
 * Check if user prefers reduced motion
 */
function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mediaQuery) return;

    setPrefersReducedMotion(mediaQuery.matches);

    const handler = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches);
    };

    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  return prefersReducedMotion;
}

export default function GuessBar({ sourceState }: GuessBarProps) {
  const { totalRemaining, free, clankton, share, paid } = sourceState;

  // Track decrement pulse animation
  const [justDecremented, setJustDecremented] = useState(false);
  const lastRemainingRef = useRef<number | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  // Pulse animation on decrement
  useEffect(() => {
    // Only trigger pulse when count decreases (not on initial render or increases)
    if (
      lastRemainingRef.current !== null &&
      totalRemaining < lastRemainingRef.current &&
      !prefersReducedMotion
    ) {
      setJustDecremented(true);

      const timeout = setTimeout(() => {
        setJustDecremented(false);
      }, 160); // pulse duration

      return () => clearTimeout(timeout);
    }

    // Always update ref to current value
    lastRemainingRef.current = totalRemaining;
  }, [totalRemaining, prefersReducedMotion]);

  // Determine which segments to show
  const showClankton = clankton.isHolder;
  const showPaid = paid.total > 0;

  // Determine which segments are consumed (remaining === 0)
  const freeConsumed = free.remaining === 0;
  const clanktonConsumed = clankton.remaining === 0;
  const shareConsumed = share.remaining === 0;
  const paidConsumed = paid.remaining === 0;

  return (
    <div
      className="text-center py-2 flex items-center justify-center gap-2 flex-wrap"
      style={{ minHeight: '2.5rem' }}
    >
      {/* Left side: Total guesses remaining in pill */}
      <span
        className="text-sm whitespace-nowrap inline-flex items-center rounded-full"
        style={{
          padding: '2px 8px 3px 6px',
          backgroundColor: justDecremented
            ? 'rgba(15, 23, 42, 0.08)'
            : 'rgba(15, 23, 42, 0.04)',
          color: '#111827',
          fontWeight: 600,
          lineHeight: 1.2,
          transition: 'background-color 150ms ease-out, transform 150ms ease-out',
          transform: justDecremented && !prefersReducedMotion ? 'scale(1.03)' : 'scale(1)',
        }}
      >
        <span style={{ fontWeight: 700 }}>{totalRemaining}</span>
        {' '}
        <span style={{ fontWeight: 500 }}>
          {totalRemaining === 1 ? 'guess' : 'guesses'} left
        </span>
      </span>

      {/* Separator */}
      <span className="text-gray-400">|</span>

      {/* Right side: Source breakdown */}
      <span
        className="text-sm whitespace-nowrap"
        style={{ color: '#4b5563', fontWeight: 500 }}
      >
        {/* Free guess (always shown) */}
        <SourceSegment
          label="free"
          value={free.total}
          isConsumed={freeConsumed}
          isFirst={true}
        />

        {/* CLANKTON bonus (only if holder) */}
        {showClankton && (
          <SourceSegment
            label="CLANKTON"
            value={clankton.total}
            isConsumed={clanktonConsumed}
            color="#7c3aed" // purple-600
          />
        )}

        {/* Share bonus (only if earned) */}
        {share.total > 0 && (
          <SourceSegment
            label="share"
            value={share.total}
            isConsumed={shareConsumed}
            color="#2563eb" // blue-600
          />
        )}

        {/* Paid guesses (only if purchased) */}
        {showPaid && (
          <SourceSegment
            label="paid"
            value={paid.total}
            isConsumed={paidConsumed}
            color="#2563eb" // blue-600
          />
        )}
      </span>
    </div>
  );
}

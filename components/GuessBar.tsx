/**
 * GuessBar Component
 * Milestone 6.5: Unified Guess Bar UX
 *
 * Single-line, intuitive, fully transparent guess-status bar that:
 * - Shows total guesses left
 * - Shows all sources of guesses
 * - Shows which sources have been consumed
 * - Works for all user types
 *
 * Layout:
 * Left: "X guesses left"
 * Right: "1 free · +2 CLANKTON · +1 share · +3 paid"
 *
 * Rules:
 * - Order of appearance: Free, CLANKTON, Share, Paid
 * - CLANKTON only shows if user is a holder
 * - Paid only shows if user has purchased packs
 * - Consumed sources are visually faded (opacity 40%)
 */

import type { GuessSourceState } from '../src/types';

interface GuessBarProps {
  sourceState: GuessSourceState;
  isDevMode?: boolean;
  personaActive?: boolean;
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

export default function GuessBar({ sourceState, isDevMode, personaActive }: GuessBarProps) {
  const { totalRemaining, free, clankton, share, paid } = sourceState;

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
      {/* Left side: Total guesses remaining */}
      <span className="text-sm text-gray-700 whitespace-nowrap">
        <span className="font-semibold text-gray-900">{totalRemaining}</span>
        {' '}
        {totalRemaining === 1 ? 'guess' : 'guesses'} left
      </span>

      {/* Separator */}
      <span className="text-gray-400">|</span>

      {/* Right side: Source breakdown */}
      <span className="text-sm text-gray-600 whitespace-nowrap">
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

      {/* Dev mode indicator */}
      {isDevMode && personaActive && (
        <span className="text-xs text-orange-500 font-medium">[PERSONA]</span>
      )}
    </div>
  );
}

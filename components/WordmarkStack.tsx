/**
 * WordmarkStack Component
 * Displays achievement wordmarks in a stacked/overlapping layout
 * when multiple are present (like Mastercard logo)
 *
 * Wordmarks are permanent achievements earned by playing Let's Have A Word
 */

import { useState } from 'react';

interface WordmarkStackProps {
  hasOgHunter?: boolean;
  hasClanktonHolder?: boolean;
  hasBonusWordFinder?: boolean;
  hasJackpotWinner?: boolean;
  hasDoubleW?: boolean;
  hasPatron?: boolean;
  hasQuickdraw?: boolean;
  size?: 'sm' | 'md';
}

const sizeConfig = {
  sm: {
    wordmark: 'w-4 h-4',
    overlap: '-ml-1.5',
    fontSize: 'text-[10px]',
  },
  md: {
    wordmark: 'w-5 h-5',
    overlap: '-ml-2',
    fontSize: 'text-xs',
  },
};

export default function WordmarkStack({
  hasOgHunter = false,
  hasClanktonHolder = false,
  hasBonusWordFinder = false,
  hasJackpotWinner = false,
  hasDoubleW = false,
  hasPatron = false,
  hasQuickdraw = false,
  size = 'sm',
}: WordmarkStackProps) {
  const [tooltipText, setTooltipText] = useState<string | null>(null);
  const config = sizeConfig[size];

  // If no wordmarks, render nothing
  const hasAnyWordmark = hasOgHunter || hasClanktonHolder || hasBonusWordFinder ||
    hasJackpotWinner || hasDoubleW || hasPatron || hasQuickdraw;

  if (!hasAnyWordmark) {
    return null;
  }

  // Helper to check if overlap should be applied (any previous wordmark is shown)
  const shouldOverlap = (position: number): boolean => {
    const orderedChecks = [hasOgHunter, hasBonusWordFinder, hasJackpotWinner, hasDoubleW, hasPatron, hasQuickdraw, hasClanktonHolder];
    return orderedChecks.slice(0, position).some(Boolean);
  };

  return (
    <div
      className="relative inline-flex items-center"
      onMouseLeave={() => setTooltipText(null)}
    >
      {/* OG Hunter (shown first/leftmost) */}
      {hasOgHunter && (
        <div
          className={`${config.wordmark} bg-purple-100 rounded-full flex items-center justify-center ${config.fontSize} relative z-10 ring-1 ring-amber-400`}
          onMouseEnter={() => setTooltipText('OG Hunter')}
          onTouchStart={() => setTooltipText('OG Hunter')}
        >
          <span role="img" aria-label="OG Hunter">🕵️‍♂️</span>
        </div>
      )}

      {/* Bonus Word Finder */}
      {hasBonusWordFinder && (
        <div
          className={`${config.wordmark} bg-cyan-100 rounded-full flex items-center justify-center ${config.fontSize} relative z-20 ${shouldOverlap(1) ? config.overlap : ''}`}
          style={{ boxShadow: '0 0 0 1px #67e8f9' }}
          onMouseEnter={() => setTooltipText('Bonus Word Finder')}
          onTouchStart={() => setTooltipText('Bonus Word Finder')}
        >
          <span role="img" aria-label="Bonus Word Finder">🎣</span>
        </div>
      )}

      {/* Jackpot Winner */}
      {hasJackpotWinner && (
        <div
          className={`${config.wordmark} bg-amber-100 rounded-full flex items-center justify-center ${config.fontSize} relative z-25 ${shouldOverlap(2) ? config.overlap : ''}`}
          style={{ boxShadow: '0 0 0 1px #fcd34d' }}
          onMouseEnter={() => setTooltipText('Jackpot Winner')}
          onTouchStart={() => setTooltipText('Jackpot Winner')}
        >
          <span role="img" aria-label="Jackpot Winner">🏆</span>
        </div>
      )}

      {/* Double W - hit two bonus words OR bonus word + secret word in same round */}
      {hasDoubleW && (
        <div
          className={`${config.wordmark} bg-indigo-100 rounded-full flex items-center justify-center ${config.fontSize} relative z-26 ${shouldOverlap(3) ? config.overlap : ''}`}
          style={{ boxShadow: '0 0 0 1px #a5b4fc' }}
          onMouseEnter={() => setTooltipText('Double W')}
          onTouchStart={() => setTooltipText('Double W')}
        >
          <span role="img" aria-label="Double W">✌️</span>
        </div>
      )}

      {/* Patron - referred a jackpot winner */}
      {hasPatron && (
        <div
          className={`${config.wordmark} bg-rose-100 rounded-full flex items-center justify-center ${config.fontSize} relative z-27 ${shouldOverlap(4) ? config.overlap : ''}`}
          style={{ boxShadow: '0 0 0 1px #fda4af' }}
          onMouseEnter={() => setTooltipText('Patron')}
          onTouchStart={() => setTooltipText('Patron')}
        >
          <span role="img" aria-label="Patron">🤝</span>
        </div>
      )}

      {/* Quickdraw - placed in Top 10 Early Guessers */}
      {hasQuickdraw && (
        <div
          className={`${config.wordmark} bg-emerald-100 rounded-full flex items-center justify-center ${config.fontSize} relative z-28 ${shouldOverlap(5) ? config.overlap : ''}`}
          style={{ boxShadow: '0 0 0 1px #6ee7b7' }}
          onMouseEnter={() => setTooltipText('Quickdraw')}
          onTouchStart={() => setTooltipText('Quickdraw')}
        >
          <span role="img" aria-label="Quickdraw">⚡</span>
        </div>
      )}

      {/* CLANKTON Holder (shown last/rightmost) */}
      {hasClanktonHolder && (
        <div
          className={`${config.wordmark} rounded-full overflow-hidden flex items-center justify-center relative z-30 ${shouldOverlap(6) ? config.overlap : ''}`}
          style={{ boxShadow: '0 0 0 1px #C4B5FD' }}
          onMouseEnter={() => setTooltipText('CLANKTON Holder')}
          onTouchStart={() => setTooltipText('CLANKTON Holder')}
        >
          <img
            src="/clankton-logo-light.png"
            alt="CLANKTON Holder"
            className="w-full h-full object-cover"
          />
        </div>
      )}

      {/* Tooltip - positioned below to avoid cutoff */}
      {tooltipText && (
        <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-1 px-2 py-1 bg-gray-900 text-white text-xs rounded whitespace-nowrap z-[100] pointer-events-none">
          {tooltipText}
          <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-b-gray-900" />
        </div>
      )}
    </div>
  );
}

/**
 * Legacy BadgeStack alias for backwards compatibility
 * Maps old prop names to new WordmarkStack props
 */
export function BadgeStack({
  hasOgHunterBadge = false,
  hasClanktonBadge = false,
  hasBonusWordBadge = false,
  hasJackpotWinnerBadge = false,
  hasDoubleWBadge = false,
  hasPatronBadge = false,
  hasQuickdrawBadge = false,
  size = 'sm',
}: {
  hasOgHunterBadge?: boolean;
  hasClanktonBadge?: boolean;
  hasBonusWordBadge?: boolean;
  hasJackpotWinnerBadge?: boolean;
  hasDoubleWBadge?: boolean;
  hasPatronBadge?: boolean;
  hasQuickdrawBadge?: boolean;
  size?: 'sm' | 'md';
}) {
  return (
    <WordmarkStack
      hasOgHunter={hasOgHunterBadge}
      hasClanktonHolder={hasClanktonBadge}
      hasBonusWordFinder={hasBonusWordBadge}
      hasJackpotWinner={hasJackpotWinnerBadge}
      hasDoubleW={hasDoubleWBadge}
      hasPatron={hasPatronBadge}
      hasQuickdraw={hasQuickdrawBadge}
      size={size}
    />
  );
}

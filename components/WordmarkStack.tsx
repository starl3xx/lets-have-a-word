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
  hasWordTokenHolder?: boolean;
  hasBonusWordFinder?: boolean;
  hasBurnWordFinder?: boolean;
  hasJackpotWinner?: boolean;
  hasDoubleW?: boolean;
  hasPatron?: boolean;
  hasQuickdraw?: boolean;
  hasEncyclopedic?: boolean;
  hasBakersDozen?: boolean;
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
  hasWordTokenHolder = false,
  hasBonusWordFinder = false,
  hasBurnWordFinder = false,
  hasJackpotWinner = false,
  hasDoubleW = false,
  hasPatron = false,
  hasQuickdraw = false,
  hasEncyclopedic = false,
  hasBakersDozen = false,
  size = 'sm',
}: WordmarkStackProps) {
  const [tooltipText, setTooltipText] = useState<string | null>(null);
  const config = sizeConfig[size];

  // If no wordmarks, render nothing
  const hasAnyWordmark = hasOgHunter || hasWordTokenHolder || hasBonusWordFinder || hasBurnWordFinder ||
    hasJackpotWinner || hasDoubleW || hasPatron || hasQuickdraw || hasEncyclopedic || hasBakersDozen;

  if (!hasAnyWordmark) {
    return null;
  }

  // Helper to check if overlap should be applied (any previous wordmark is shown)
  // Order: OG Hunter, Patron, Baker's Dozen, Quickdraw, Encyclopedic, Side Quest, Arsonist, Double Dub, $WORD, Jackpot Winner
  // Jackpot Winner is rightmost/highest z-index as the most prestigious achievement
  const shouldOverlap = (position: number): boolean => {
    const orderedChecks = [hasOgHunter, hasPatron, hasBakersDozen, hasQuickdraw, hasEncyclopedic, hasBonusWordFinder, hasBurnWordFinder, hasDoubleW, hasWordTokenHolder, hasJackpotWinner];
    return orderedChecks.slice(0, position).some(Boolean);
  };

  return (
    <div
      className="relative inline-flex items-center"
      onMouseLeave={() => setTooltipText(null)}
    >
      {/* OG Hunter (position 1 - leftmost, lowest z-index) */}
      {hasOgHunter && (
        <div
          className={`${config.wordmark} bg-purple-100 rounded-full flex items-center justify-center ${config.fontSize} relative z-[10] ring-1 ring-amber-400`}
          onMouseEnter={() => setTooltipText('OG Hunter')}
          onTouchStart={() => setTooltipText('OG Hunter')}
        >
          <span role="img" aria-label="OG Hunter">🕵️‍♂️</span>
        </div>
      )}

      {/* Patron (position 2) */}
      {hasPatron && (
        <div
          className={`${config.wordmark} bg-rose-100 rounded-full flex items-center justify-center ${config.fontSize} relative z-[20] ${shouldOverlap(1) ? config.overlap : ''}`}
          style={{ boxShadow: '0 0 0 1px #fda4af' }}
          onMouseEnter={() => setTooltipText('Patron')}
          onTouchStart={() => setTooltipText('Patron')}
        >
          <span role="img" aria-label="Patron">🤝</span>
        </div>
      )}

      {/* Baker's Dozen (position 3) */}
      {hasBakersDozen && (
        <div
          className={`${config.wordmark} bg-orange-100 rounded-full flex items-center justify-center ${config.fontSize} relative z-[30] ${shouldOverlap(2) ? config.overlap : ''}`}
          style={{ boxShadow: '0 0 0 1px #fdba74' }}
          onMouseEnter={() => setTooltipText('Baker\'s Dozen')}
          onTouchStart={() => setTooltipText('Baker\'s Dozen')}
        >
          <span role="img" aria-label="Baker's Dozen">🍩</span>
        </div>
      )}

      {/* Quickdraw (position 4) */}
      {hasQuickdraw && (
        <div
          className={`${config.wordmark} bg-emerald-100 rounded-full flex items-center justify-center ${config.fontSize} relative z-[40] ${shouldOverlap(3) ? config.overlap : ''}`}
          style={{ boxShadow: '0 0 0 1px #6ee7b7' }}
          onMouseEnter={() => setTooltipText('Quickdraw')}
          onTouchStart={() => setTooltipText('Quickdraw')}
        >
          <span role="img" aria-label="Quickdraw">⚡</span>
        </div>
      )}

      {/* Encyclopedic (position 5) */}
      {hasEncyclopedic && (
        <div
          className={`${config.wordmark} bg-sky-100 rounded-full flex items-center justify-center ${config.fontSize} relative z-[45] ${shouldOverlap(4) ? config.overlap : ''}`}
          style={{ boxShadow: '0 0 0 1px #7dd3fc' }}
          onMouseEnter={() => setTooltipText('Encyclopedic')}
          onTouchStart={() => setTooltipText('Encyclopedic')}
        >
          <span role="img" aria-label="Encyclopedic">📚</span>
        </div>
      )}

      {/* Side Quest (position 6) */}
      {hasBonusWordFinder && (
        <div
          className={`${config.wordmark} bg-cyan-100 rounded-full flex items-center justify-center ${config.fontSize} relative z-[50] ${shouldOverlap(5) ? config.overlap : ''}`}
          style={{ boxShadow: '0 0 0 1px #67e8f9' }}
          onMouseEnter={() => setTooltipText('Side Quest')}
          onTouchStart={() => setTooltipText('Side Quest')}
        >
          <span role="img" aria-label="Side Quest">🎣</span>
        </div>
      )}

      {/* Arsonist (position 7) */}
      {hasBurnWordFinder && (
        <div
          className={`${config.wordmark} bg-red-100 rounded-full flex items-center justify-center ${config.fontSize} relative z-[55] ${shouldOverlap(6) ? config.overlap : ''}`}
          style={{ boxShadow: '0 0 0 1px #fca5a5' }}
          onMouseEnter={() => setTooltipText('Arsonist')}
          onTouchStart={() => setTooltipText('Arsonist')}
        >
          <span role="img" aria-label="Arsonist">🔥</span>
        </div>
      )}

      {/* Double Dub (position 8) */}
      {hasDoubleW && (
        <div
          className={`${config.wordmark} bg-indigo-100 rounded-full flex items-center justify-center ${config.fontSize} relative z-[60] ${shouldOverlap(7) ? config.overlap : ''}`}
          style={{ boxShadow: '0 0 0 1px #a5b4fc' }}
          onMouseEnter={() => setTooltipText('Double Dub')}
          onTouchStart={() => setTooltipText('Double Dub')}
        >
          <span role="img" aria-label="Double Dub">✌️</span>
        </div>
      )}

      {/* $WORD Holder (position 9) */}
      {hasWordTokenHolder && (
        <div
          className={`${config.wordmark} rounded-full overflow-hidden flex items-center justify-center relative z-[70] ${shouldOverlap(8) ? config.overlap : ''}`}
          style={{ boxShadow: '0 0 0 1px #C4B5FD' }}
          onMouseEnter={() => setTooltipText('$WORD Holder')}
          onTouchStart={() => setTooltipText('$WORD Holder')}
        >
          <img
            src="/word-token-logo-light.png"
            alt="$WORD Holder"
            className="w-full h-full object-cover"
          />
        </div>
      )}

      {/* Jackpot Winner (position 10 - rightmost, highest z-index as most prestigious) */}
      {hasJackpotWinner && (
        <div
          className={`${config.wordmark} bg-amber-100 rounded-full flex items-center justify-center ${config.fontSize} relative z-[80] ${shouldOverlap(9) ? config.overlap : ''}`}
          style={{ boxShadow: '0 0 0 1px #fcd34d' }}
          onMouseEnter={() => setTooltipText('Jackpot Winner')}
          onTouchStart={() => setTooltipText('Jackpot Winner')}
        >
          <span role="img" aria-label="Jackpot Winner">🏆</span>
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
  hasWordTokenBadge = false,
  hasBonusWordBadge = false,
  hasBurnWordBadge = false,
  hasJackpotWinnerBadge = false,
  hasDoubleWBadge = false,
  hasPatronBadge = false,
  hasQuickdrawBadge = false,
  hasEncyclopedicBadge = false,
  hasBakersDozenBadge = false,
  size = 'sm',
}: {
  hasOgHunterBadge?: boolean;
  hasWordTokenBadge?: boolean;
  hasBonusWordBadge?: boolean;
  hasBurnWordBadge?: boolean;
  hasJackpotWinnerBadge?: boolean;
  hasDoubleWBadge?: boolean;
  hasPatronBadge?: boolean;
  hasQuickdrawBadge?: boolean;
  hasEncyclopedicBadge?: boolean;
  hasBakersDozenBadge?: boolean;
  size?: 'sm' | 'md';
}) {
  return (
    <WordmarkStack
      hasOgHunter={hasOgHunterBadge}
      hasWordTokenHolder={hasWordTokenBadge}
      hasBonusWordFinder={hasBonusWordBadge}
      hasBurnWordFinder={hasBurnWordBadge}
      hasJackpotWinner={hasJackpotWinnerBadge}
      hasDoubleW={hasDoubleWBadge}
      hasPatron={hasPatronBadge}
      hasQuickdraw={hasQuickdrawBadge}
      hasEncyclopedic={hasEncyclopedicBadge}
      hasBakersDozen={hasBakersDozenBadge}
      size={size}
    />
  );
}

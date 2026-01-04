/**
 * BadgeStack Component
 * Displays OG Hunter and CLANKTON badges in a stacked/overlapping layout
 * when both are present (like Mastercard logo)
 */

import { useState } from 'react';

interface BadgeStackProps {
  hasOgHunterBadge?: boolean;
  hasClanktonBadge?: boolean;
  size?: 'sm' | 'md';
}

const sizeConfig = {
  sm: {
    badge: 'w-4 h-4',
    overlap: '-ml-1.5',
    fontSize: 'text-[10px]',
  },
  md: {
    badge: 'w-5 h-5',
    overlap: '-ml-2',
    fontSize: 'text-xs',
  },
};

export default function BadgeStack({
  hasOgHunterBadge = false,
  hasClanktonBadge = false,
  size = 'sm',
}: BadgeStackProps) {
  const [tooltipText, setTooltipText] = useState<string | null>(null);
  const config = sizeConfig[size];

  // If neither badge, render nothing
  if (!hasOgHunterBadge && !hasClanktonBadge) {
    return null;
  }

  const hasBothBadges = hasOgHunterBadge && hasClanktonBadge;

  return (
    <div
      className="relative inline-flex items-center"
      onMouseLeave={() => setTooltipText(null)}
    >
      {/* OG Hunter Badge (shown first/behind) */}
      {hasOgHunterBadge && (
        <div
          className={`${config.badge} bg-purple-100 rounded-full flex items-center justify-center ${config.fontSize} relative z-10`}
          onMouseEnter={() => setTooltipText('OG Hunter')}
          onTouchStart={() => setTooltipText('OG Hunter')}
        >
          <span role="img" aria-label="OG Hunter">🕵️‍♂️</span>
        </div>
      )}

      {/* CLANKTON Badge (shown second/on top, overlapping if both present) */}
      {hasClanktonBadge && (
        <div
          className={`${config.badge} rounded-full overflow-hidden flex items-center justify-center bg-amber-100 relative z-20 ${hasBothBadges ? config.overlap : ''}`}
          onMouseEnter={() => setTooltipText('CLANKTON holder')}
          onTouchStart={() => setTooltipText('CLANKTON holder')}
        >
          <img
            src="/clankton-logo.png"
            alt="CLANKTON holder"
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

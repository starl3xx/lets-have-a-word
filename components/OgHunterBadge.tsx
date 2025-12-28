/**
 * OG Hunter Badge Component
 * Displays the OG Hunter badge indicator for users who earned it
 *
 * Usage:
 * <OgHunterBadge size="sm" /> - Small badge (16px)
 * <OgHunterBadge size="md" /> - Medium badge (20px)
 * <OgHunterBadge size="lg" /> - Large badge (24px)
 * <OgHunterBadge size="xl" /> - Extra large badge (32px)
 */

import { useState } from 'react';

interface OgHunterBadgeProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showTooltip?: boolean;
  className?: string;
}

const sizeClasses = {
  sm: 'w-4 h-4 text-[10px]',
  md: 'w-5 h-5 text-xs',
  lg: 'w-6 h-6 text-sm',
  xl: 'w-8 h-8 text-base',
};

export default function OgHunterBadge({
  size = 'sm',
  showTooltip = true,
  className = '',
}: OgHunterBadgeProps) {
  const [isTooltipVisible, setIsTooltipVisible] = useState(false);

  return (
    <div
      className={`relative inline-flex items-center justify-center ${className}`}
      onMouseEnter={() => showTooltip && setIsTooltipVisible(true)}
      onMouseLeave={() => setIsTooltipVisible(false)}
    >
      {/* Badge Icon */}
      <div
        className={`${sizeClasses[size]} bg-purple-100 rounded-full flex items-center justify-center`}
        title={showTooltip ? undefined : 'OG Hunter'}
      >
        <span role="img" aria-label="OG Hunter">🕵️‍♂️</span>
      </div>

      {/* Tooltip */}
      {showTooltip && isTooltipVisible && (
        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-1 px-2 py-1 bg-gray-900 text-white text-xs rounded whitespace-nowrap z-50">
          OG Hunter
          <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
        </div>
      )}
    </div>
  );
}

/**
 * Hook to check if a user has the OG Hunter badge
 * Uses the status endpoint to check badge status
 */
export function useOgHunterBadge(fid: number | null): {
  hasBadge: boolean;
  isLoading: boolean;
} {
  const [hasBadge, setHasBadge] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Effect to fetch badge status
  // Note: In a real implementation, you'd want to batch these requests
  // or cache the results to avoid excessive API calls
  useState(() => {
    if (!fid) {
      setIsLoading(false);
      return;
    }

    fetch(`/api/og-hunter/status?fid=${fid}`)
      .then(res => res.json())
      .then(data => {
        setHasBadge(data.isAwarded || false);
      })
      .catch(() => {
        setHasBadge(false);
      })
      .finally(() => {
        setIsLoading(false);
      });
  });

  return { hasBadge, isLoading };
}

/**
 * Badge types for future expansion
 */
export type BadgeType = 'OG_HUNTER';

/**
 * Badge configuration for rendering different badge types
 */
export const BADGE_CONFIG: Record<BadgeType, {
  icon: string;
  label: string;
  bgColor: string;
}> = {
  OG_HUNTER: {
    icon: '🕵️‍♂️',
    label: 'OG Hunter',
    bgColor: 'bg-purple-100',
  },
};

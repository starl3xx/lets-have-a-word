/**
 * $WORD Holder Badge Component
 * Displays a circular badge for users who hold 100M+ $WORD tokens
 *
 * Usage:
 * <WordHolderBadge size="sm" /> - Small badge (16px)
 * <WordHolderBadge size="md" /> - Medium badge (20px)
 * <WordHolderBadge size="lg" /> - Large badge (24px)
 * <WordHolderBadge size="xl" /> - Extra large badge (32px)
 */

import { useState } from 'react';

interface WordHolderBadgeProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showTooltip?: boolean;
  className?: string;
}

const sizeClasses = {
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
  lg: 'w-6 h-6',
  xl: 'w-8 h-8',
};

export default function WordHolderBadge({
  size = 'sm',
  showTooltip = true,
  className = '',
}: WordHolderBadgeProps) {
  const [isTooltipVisible, setIsTooltipVisible] = useState(false);

  return (
    <div
      className={`relative inline-flex items-center justify-center ${className}`}
      onMouseEnter={() => showTooltip && setIsTooltipVisible(true)}
      onMouseLeave={() => setIsTooltipVisible(false)}
      onTouchStart={() => showTooltip && setIsTooltipVisible(true)}
      onTouchEnd={() => setTimeout(() => setIsTooltipVisible(false), 1500)}
    >
      {/* Badge Icon - Circular image with purple outline */}
      <div
        className={`${sizeClasses[size]} rounded-full overflow-hidden flex items-center justify-center`}
        style={{ boxShadow: '0 0 0 1.5px #C4B5FD' }}
        title={showTooltip ? undefined : '$WORD holder'}
      >
        <img
          src="/word-token-logo-light.png"
          alt="$WORD holder"
          className="w-full h-full object-cover"
        />
      </div>

      {/* Tooltip */}
      {showTooltip && isTooltipVisible && (
        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-1 px-2 py-1 bg-gray-900 text-white text-xs rounded whitespace-nowrap z-50">
          $WORD holder
          <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
        </div>
      )}
    </div>
  );
}

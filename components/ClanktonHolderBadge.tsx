/**
 * CLANKTON Holder Badge Component
 * Displays a circular badge for users who hold 100M+ CLANKTON tokens
 *
 * Usage:
 * <ClanktonHolderBadge size="sm" /> - Small badge (16px)
 * <ClanktonHolderBadge size="md" /> - Medium badge (20px)
 * <ClanktonHolderBadge size="lg" /> - Large badge (24px)
 * <ClanktonHolderBadge size="xl" /> - Extra large badge (32px)
 */

import { useState } from 'react';

interface ClanktonHolderBadgeProps {
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

export default function ClanktonHolderBadge({
  size = 'sm',
  showTooltip = true,
  className = '',
}: ClanktonHolderBadgeProps) {
  const [isTooltipVisible, setIsTooltipVisible] = useState(false);

  return (
    <div
      className={`relative inline-flex items-center justify-center ${className}`}
      onMouseEnter={() => showTooltip && setIsTooltipVisible(true)}
      onMouseLeave={() => setIsTooltipVisible(false)}
      onTouchStart={() => showTooltip && setIsTooltipVisible(true)}
      onTouchEnd={() => setTimeout(() => setIsTooltipVisible(false), 1500)}
    >
      {/* Badge Icon - Circular image */}
      <div
        className={`${sizeClasses[size]} rounded-full overflow-hidden flex items-center justify-center bg-amber-100`}
        title={showTooltip ? undefined : 'CLANKTON holder'}
      >
        <img
          src="/clankton-logo.png"
          alt="CLANKTON holder"
          className="w-full h-full object-cover"
        />
      </div>

      {/* Tooltip */}
      {showTooltip && isTooltipVisible && (
        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-1 px-2 py-1 bg-gray-900 text-white text-xs rounded whitespace-nowrap z-50">
          CLANKTON holder
          <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
        </div>
      )}
    </div>
  );
}

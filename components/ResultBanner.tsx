/**
 * ResultBanner Component
 * Unified result banner system for Let's Have A Word
 *
 * Provides consistent layout, typography, and theming for:
 * - Error states (incorrect guess, invalid word)
 * - Warning states (already guessed this round)
 * - Success states (winner)
 *
 * Milestone 6.7.1 additions:
 * - Faded state for incorrect banners (gray, semi-transparent)
 * - Shows context of last guess while allowing new input
 *
 * Design principles:
 * - Consistent layout across all variants
 * - Theme-appropriate colors
 * - No emojis for error/warning, emoji allowed for success
 * - Matches LHAW visual language
 */

import { memo } from 'react';

export type ResultBannerVariant = 'error' | 'warning' | 'success';

export interface ResultBannerProps {
  variant: ResultBannerVariant;
  message: React.ReactNode;
  /** Optional: override the default icon */
  icon?: React.ReactNode;
  /** Optional: control visibility with opacity transition */
  visible?: boolean;
  /**
   * Milestone 6.7.1: Faded state for incorrect banners
   * When true, displays as gray/semi-transparent instead of red
   * Used to show context of last guess while allowing new input
   */
  faded?: boolean;
}

/**
 * Default icons for each variant
 * Error: X icon (no emoji)
 * Warning: Info/exclamation icon (no emoji)
 * Success: Party emoji or checkmark
 */
const ErrorIcon = () => (
  <svg
    className="w-5 h-5 text-red-600 flex-shrink-0"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2.5}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const WarningIcon = () => (
  <svg
    className="w-5 h-5 text-amber-600 flex-shrink-0"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
    />
  </svg>
);

const SuccessIcon = () => (
  <span className="text-lg flex-shrink-0" role="img" aria-label="celebration">
    🎉
  </span>
);

/**
 * Milestone 6.7.1: Faded icon for gray state
 * Used when banner transitions from active to faded
 */
const FadedIcon = () => (
  <svg
    className="w-5 h-5 text-gray-400 flex-shrink-0"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

/**
 * Get variant-specific styling classes
 * Milestone 6.7.1: Added faded parameter for gray state
 */
function getVariantStyles(variant: ResultBannerVariant, faded: boolean = false): {
  container: string;
  text: string;
} {
  // Milestone 6.7.1: Faded state overrides normal error styling
  if (faded) {
    return {
      container: 'bg-gray-50 border-gray-400',
      text: 'text-gray-500',
    };
  }

  switch (variant) {
    case 'error':
      return {
        container: 'bg-red-50 border-red-300',
        text: 'text-red-700',
      };
    case 'warning':
      return {
        container: 'bg-amber-50 border-amber-300',
        text: 'text-amber-700',
      };
    case 'success':
      return {
        container: 'bg-green-50 border-green-300',
        text: 'text-green-700',
      };
    default:
      return {
        container: 'bg-gray-50 border-gray-300',
        text: 'text-gray-700',
      };
  }
}

/**
 * Get default icon for a variant
 */
function getDefaultIcon(variant: ResultBannerVariant): React.ReactNode {
  switch (variant) {
    case 'error':
      return <ErrorIcon />;
    case 'warning':
      return <WarningIcon />;
    case 'success':
      return <SuccessIcon />;
    default:
      return null;
  }
}

/**
 * ResultBanner - Unified result banner component
 *
 * Features:
 * - Consistent layout across all variants
 * - Left-aligned icon with centered text
 * - Smooth opacity transitions
 * - Responsive design (wraps gracefully on mobile)
 *
 * Milestone 6.7.1:
 * - Added faded prop for gray/semi-transparent state
 * - Used for incorrect banners after active period ends
 */
const ResultBanner = memo(function ResultBanner({
  variant,
  message,
  icon,
  visible = true,
  faded = false,
}: ResultBannerProps) {
  const styles = getVariantStyles(variant, faded);

  // Milestone 6.7.1: No icon when in faded state, otherwise use provided or default
  const displayIcon = faded
    ? null
    : (icon !== undefined ? icon : getDefaultIcon(variant));

  return (
    <div
      className={`
        ${styles.container}
        border-2 rounded-lg p-3 shadow-sm
        transition-all duration-300
        flex items-center justify-center gap-2
      `}
      style={{
        opacity: visible ? (faded ? 0.7 : 1) : 0,
        filter: faded ? 'blur(4px)' : 'none',
      }}
      role="status"
      aria-live="polite"
    >
      {displayIcon && <span className="flex-shrink-0">{displayIcon}</span>}
      <p className={`${styles.text} text-center text-sm font-medium`}>
        {message}
      </p>
    </div>
  );
});

export default ResultBanner;

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
 * Get variant-specific styling
 * Milestone 6.7.1: Added faded parameter for gray state
 * Updated: All colors now use inline styles for smooth transitions
 */
function getVariantStyles(variant: ResultBannerVariant, faded: boolean = false): {
  borderColor: string;
  textColor: string;
  bgColor: string; // Semi-transparent background for backdrop blur effect
  blurClass: string; // Blur class for backdrop effect
} {
  // Use 'faded' as effective variant when faded prop is true
  const effectiveVariant = faded ? 'faded' : variant;

  switch (effectiveVariant) {
    case 'error':
      return {
        borderColor: 'rgb(252, 165, 165)', // red-300
        textColor: 'rgb(185, 28, 28)', // red-700
        bgColor: 'rgba(254, 242, 242, 0.3)', // red-50 frosted glass
        blurClass: 'backdrop-blur-sm', // 4px blur
      };
    case 'warning':
      return {
        borderColor: 'rgb(252, 211, 77)', // amber-300
        textColor: 'rgb(180, 83, 9)', // amber-700
        bgColor: 'rgba(255, 251, 235, 0.3)', // amber-50 frosted glass
        blurClass: 'backdrop-blur-sm', // 4px blur
      };
    case 'success':
      return {
        borderColor: 'rgb(134, 239, 172)', // green-300
        textColor: 'rgb(21, 128, 61)', // green-700
        bgColor: 'rgba(240, 253, 244, 0.3)', // green-50 frosted glass
        blurClass: 'backdrop-blur-sm', // 4px blur
      };
    case 'faded':
      return {
        borderColor: 'rgb(156, 163, 175)', // gray-400
        textColor: 'rgb(107, 114, 128)', // gray-500
        bgColor: 'rgba(249, 250, 251, 0.3)', // gray-50 frosted glass (same opacity as others)
        blurClass: 'backdrop-blur', // 8px blur for faded
      };
    default:
      return {
        borderColor: 'rgb(209, 213, 219)', // gray-300
        textColor: 'rgb(55, 65, 81)', // gray-700
        bgColor: 'rgba(249, 250, 251, 0.3)', // gray-50 frosted glass
        blurClass: 'backdrop-blur-sm',
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

  // Get the appropriate icon (custom or default)
  // We'll always render it but fade it out when in faded state
  const iconElement = icon !== undefined ? icon : getDefaultIcon(variant);

  return (
    <div
      className={`
        border-2 rounded-lg p-3
        flex items-center justify-center gap-2
        ${styles.blurClass}
      `}
      style={{
        opacity: visible ? (faded ? 0.8 : 1) : 0,
        borderColor: styles.borderColor,
        backgroundColor: styles.bgColor,
        transition: 'opacity 1500ms ease-out, border-color 1500ms ease-out, background-color 1500ms ease-out',
      }}
      role="status"
      aria-live="polite"
    >
      {iconElement && (
        <span
          className="flex-shrink-0"
          style={{
            opacity: faded ? 0 : 1,
            transition: 'opacity 600ms ease-out',
          }}
        >
          {iconElement}
        </span>
      )}
      <p
        className="text-center text-sm font-medium"
        style={{
          color: styles.textColor,
          transition: 'color 1500ms ease-out',
        }}
      >
        {message}
      </p>
    </div>
  );
});

export default ResultBanner;

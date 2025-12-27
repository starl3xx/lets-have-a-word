/**
 * ErrorBanner Component
 * Displays app errors with consistent styling and recovery actions
 *
 * Features:
 * - Maps AppError codes to user-friendly messages
 * - Provides single-CTA recovery actions
 * - Auto-dismisses after timeout (configurable)
 * - Doesn't shift layout significantly
 */

import { useState, useEffect, useCallback } from 'react';
import {
  AppError,
  AppErrorCode,
  ErrorDisplayConfig,
  ErrorCtaAction,
  getErrorDisplayConfig,
} from '../src/lib/appErrors';

// =============================================================================
// Props
// =============================================================================

interface ErrorBannerProps {
  /** The error to display (can be AppError or error code) */
  error: AppError | AppErrorCode | null;
  /** Custom title override */
  title?: string;
  /** Custom body override */
  body?: string;
  /** Custom CTA label override */
  ctaLabel?: string;
  /** Called when CTA is clicked */
  onAction?: (action: ErrorCtaAction) => void;
  /** Called when banner is dismissed */
  onDismiss?: () => void;
  /** Auto-dismiss after this many milliseconds (0 = never) */
  autoDismissMs?: number;
  /** Whether the banner is visible */
  visible?: boolean;
  /** Additional CSS classes */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

export default function ErrorBanner({
  error,
  title,
  body,
  ctaLabel,
  onAction,
  onDismiss,
  autoDismissMs = 0,
  visible = true,
  className = '',
}: ErrorBannerProps) {
  const [isVisible, setIsVisible] = useState(visible);

  // Get display config from error
  const config: ErrorDisplayConfig | null = error
    ? error instanceof AppError
      ? error.displayConfig
      : getErrorDisplayConfig(error)
    : null;

  // Handle visibility changes
  useEffect(() => {
    setIsVisible(visible && error !== null);
  }, [visible, error]);

  // Auto-dismiss
  useEffect(() => {
    if (!isVisible || autoDismissMs <= 0) return;

    const timer = setTimeout(() => {
      setIsVisible(false);
      onDismiss?.();
    }, autoDismissMs);

    return () => clearTimeout(timer);
  }, [isVisible, autoDismissMs, onDismiss]);

  // Handle CTA click
  const handleCtaClick = useCallback(() => {
    if (config) {
      onAction?.(config.primaryCtaAction);
    }
    if (config?.primaryCtaAction === 'dismiss') {
      setIsVisible(false);
      onDismiss?.();
    }
  }, [config, onAction, onDismiss]);

  // Handle dismiss
  const handleDismiss = useCallback(() => {
    setIsVisible(false);
    onDismiss?.();
  }, [onDismiss]);

  // Don't render if not visible or no error
  if (!isVisible || !config) {
    return null;
  }

  // Determine colors based on variant
  const variantStyles = {
    error: {
      bg: 'bg-red-50',
      border: 'border-red-200',
      text: 'text-red-800',
      bodyText: 'text-red-700',
      button: 'bg-red-600 hover:bg-red-700 text-white',
      dismissButton: 'text-red-500 hover:text-red-700',
    },
    warning: {
      bg: 'bg-amber-50',
      border: 'border-amber-200',
      text: 'text-amber-800',
      bodyText: 'text-amber-700',
      button: 'bg-amber-600 hover:bg-amber-700 text-white',
      dismissButton: 'text-amber-500 hover:text-amber-700',
    },
    info: {
      bg: 'bg-blue-50',
      border: 'border-blue-200',
      text: 'text-blue-800',
      bodyText: 'text-blue-700',
      button: 'bg-blue-600 hover:bg-blue-700 text-white',
      dismissButton: 'text-blue-500 hover:text-blue-700',
    },
  };

  const styles = variantStyles[config.bannerVariant];
  const displayTitle = title || config.userTitle;
  const displayBody = body || config.userBody;
  const displayCtaLabel = ctaLabel || config.primaryCtaLabel;

  return (
    <div
      className={`
        ${styles.bg} ${styles.border} border rounded-lg
        px-4 py-3 shadow-sm
        transition-all duration-300 ease-in-out
        ${className}
      `}
      role="alert"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Title */}
          <p className={`text-sm font-medium ${styles.text}`}>
            {displayTitle}
          </p>

          {/* Body */}
          {displayBody && (
            <p className={`text-xs mt-0.5 ${styles.bodyText}`}>
              {displayBody}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* CTA Button */}
          {config.primaryCtaAction !== 'none' && (
            <button
              onClick={handleCtaClick}
              className={`
                text-xs font-medium px-3 py-1.5 rounded-md
                transition-colors duration-150
                ${styles.button}
              `}
            >
              {displayCtaLabel}
            </button>
          )}

          {/* Dismiss Button (only if CTA is not dismiss) */}
          {config.primaryCtaAction !== 'dismiss' && (
            <button
              onClick={handleDismiss}
              className={`
                text-sm p-1 rounded
                transition-colors duration-150
                ${styles.dismissButton}
              `}
              aria-label="Dismiss"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Inline Error Message (For forms/inputs)
// =============================================================================

interface InlineErrorProps {
  error: AppError | AppErrorCode | string | null;
  className?: string;
}

export function InlineError({ error, className = '' }: InlineErrorProps) {
  if (!error) return null;

  const message =
    typeof error === 'string'
      ? error
      : error instanceof AppError
      ? error.displayConfig.userTitle
      : getErrorDisplayConfig(error).userTitle;

  return (
    <p className={`text-xs text-red-600 mt-1 ${className}`}>
      {message}
    </p>
  );
}

// =============================================================================
// Toast-style Error (Fixed position)
// =============================================================================

interface ErrorToastProps extends ErrorBannerProps {
  position?: 'top' | 'bottom';
}

export function ErrorToast({
  position = 'top',
  ...props
}: ErrorToastProps) {
  const positionClasses = {
    top: 'top-4',
    bottom: 'bottom-4',
  };

  return (
    <div
      className={`
        fixed left-4 right-4 ${positionClasses[position]}
        z-50 max-w-md mx-auto
        animate-slide-in
      `}
    >
      <ErrorBanner {...props} autoDismissMs={props.autoDismissMs || 5000} />
    </div>
  );
}

// =============================================================================
// USD Unavailable Label
// =============================================================================

interface UsdUnavailableLabelProps {
  className?: string;
}

export function UsdUnavailableLabel({ className = '' }: UsdUnavailableLabelProps) {
  return (
    <span className={`text-xs text-gray-400 italic ${className}`}>
      USD unavailable
    </span>
  );
}

// =============================================================================
// Loading Skeleton
// =============================================================================

interface SkeletonProps {
  width?: string;
  height?: string;
  className?: string;
}

export function Skeleton({
  width = 'w-20',
  height = 'h-4',
  className = '',
}: SkeletonProps) {
  return (
    <div
      className={`
        ${width} ${height}
        bg-gray-200 rounded
        animate-pulse
        ${className}
      `}
    />
  );
}

// =============================================================================
// Stale Round Banner
// =============================================================================

interface StaleRoundBannerProps {
  previousRoundId: number | null;
  currentRoundId: number;
  onRefresh: () => void;
  isRefreshing?: boolean;
}

export function StaleRoundBanner({
  previousRoundId,
  currentRoundId,
  onRefresh,
  isRefreshing = false,
}: StaleRoundBannerProps) {
  const message = previousRoundId
    ? `Round ${previousRoundId} ended. Round ${currentRoundId} is starting!`
    : `New round starting!`;

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-blue-600">🎯</span>
          <p className="text-sm font-medium text-blue-800">{message}</p>
        </div>
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className={`
            text-xs font-medium px-3 py-1.5 rounded-md
            transition-colors duration-150
            ${
              isRefreshing
                ? 'bg-blue-300 text-blue-100 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 text-white'
            }
          `}
        >
          {isRefreshing ? 'Loading...' : 'Refresh'}
        </button>
      </div>
    </div>
  );
}

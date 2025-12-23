/**
 * GamePausedBanner Component
 * Milestone 9.5: Kill Switch and Dead Day
 *
 * Shows a banner when the game is paused due to:
 * - Kill switch (emergency halt, refunds pending)
 * - Dead day / between rounds (waiting for next round)
 */

import { useState, useEffect } from 'react';

type OperationalStatus =
  | 'NORMAL'
  | 'KILL_SWITCH_ACTIVE'
  | 'DEAD_DAY_ACTIVE'
  | 'PAUSED_BETWEEN_ROUNDS';

interface Props {
  /** The error code from API response */
  errorCode?: string;
  /** The reason message from API response */
  reason?: string;
  /** Callback when banner is dismissed (optional) */
  onDismiss?: () => void;
}

/**
 * Map error code to display content
 */
function getDisplayContent(errorCode: string, reason?: string): {
  title: string;
  message: string;
  icon: string;
  bgColor: string;
  textColor: string;
} {
  switch (errorCode) {
    case 'GAME_PAUSED_KILL_SWITCH':
      return {
        title: 'Game Paused',
        message: reason || 'The game has been temporarily paused. All paid pack purchases will be refunded. We apologize for any inconvenience.',
        icon: '\u26A0', // Warning sign
        bgColor: 'bg-amber-50 border-amber-200',
        textColor: 'text-amber-900',
      };
    case 'GAME_PAUSED_BETWEEN_ROUNDS':
      return {
        title: 'Between Rounds',
        message: 'The current round has ended. Please wait for the next round to start.',
        icon: '\u23F3', // Hourglass
        bgColor: 'bg-blue-50 border-blue-200',
        textColor: 'text-blue-900',
      };
    default:
      return {
        title: 'Game Unavailable',
        message: 'The game is currently unavailable. Please try again later.',
        icon: '\u2139', // Info icon
        bgColor: 'bg-gray-50 border-gray-200',
        textColor: 'text-gray-900',
      };
  }
}

export default function GamePausedBanner({ errorCode, reason, onDismiss }: Props) {
  const [visible, setVisible] = useState(true);

  // Auto-dismiss after 10 seconds if onDismiss is provided
  useEffect(() => {
    if (onDismiss) {
      const timer = setTimeout(() => {
        setVisible(false);
        onDismiss();
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [onDismiss]);

  if (!errorCode || !visible) {
    return null;
  }

  const content = getDisplayContent(errorCode, reason);

  return (
    <div
      className={`fixed inset-x-0 top-0 z-50 p-4 ${content.bgColor} border-b-2 shadow-lg`}
      role="alert"
    >
      <div className="max-w-lg mx-auto flex items-start gap-3">
        <span className="text-2xl flex-shrink-0" aria-hidden="true">
          {content.icon}
        </span>
        <div className="flex-1">
          <h3 className={`font-bold ${content.textColor}`}>
            {content.title}
          </h3>
          <p className={`text-sm ${content.textColor} opacity-90 mt-1`}>
            {content.message}
          </p>
          {errorCode === 'GAME_PAUSED_KILL_SWITCH' && (
            <p className="text-xs text-amber-700 mt-2 font-medium">
              Refunds will be processed automatically.
            </p>
          )}
        </div>
        {onDismiss && (
          <button
            onClick={() => {
              setVisible(false);
              onDismiss();
            }}
            className={`flex-shrink-0 ${content.textColor} opacity-60 hover:opacity-100`}
            aria-label="Dismiss"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Helper to check if an error is an operational error
 */
export function isOperationalError(code?: string): boolean {
  return code === 'GAME_PAUSED_KILL_SWITCH' || code === 'GAME_PAUSED_BETWEEN_ROUNDS';
}

/**
 * Parse operational error from API response
 */
export function parseOperationalError(response: any): {
  isOperational: boolean;
  code?: string;
  reason?: string;
} {
  if (response?.code === 'GAME_PAUSED_KILL_SWITCH' || response?.code === 'GAME_PAUSED_BETWEEN_ROUNDS') {
    return {
      isOperational: true,
      code: response.code,
      reason: response.reason || response.error,
    };
  }
  return { isOperational: false };
}

/**
 * Stale Round Detector
 * Detects when the round has changed while user is idle and triggers recovery
 */

import { AppError, AppErrorCodes, ErrorAnalyticsEvents } from './appErrors';

// =============================================================================
// Types
// =============================================================================

export interface RoundState {
  roundId: number;
  lastUpdatedAt: string;
}

export interface StaleRoundResult {
  isStale: boolean;
  previousRoundId: number | null;
  currentRoundId: number;
  recoveryNeeded: boolean;
}

// =============================================================================
// State
// =============================================================================

let lastKnownRoundId: number | null = null;
let lastKnownTimestamp: number = 0;
let recoveryAttempts: number = 0;
const MAX_RECOVERY_ATTEMPTS = 3;

// =============================================================================
// Public API
// =============================================================================

/**
 * Update the known round state
 * Call this after successfully fetching round state
 */
export function updateKnownRoundState(roundId: number): void {
  lastKnownRoundId = roundId;
  lastKnownTimestamp = Date.now();
  recoveryAttempts = 0;
}

/**
 * Check if the round has changed (is stale)
 *
 * @param newRoundId - The round ID from a fresh API response
 * @returns Stale round result with recovery info
 */
export function checkForStaleRound(newRoundId: number): StaleRoundResult {
  // First load - not stale
  if (lastKnownRoundId === null) {
    updateKnownRoundState(newRoundId);
    return {
      isStale: false,
      previousRoundId: null,
      currentRoundId: newRoundId,
      recoveryNeeded: false,
    };
  }

  // Same round - not stale
  if (newRoundId === lastKnownRoundId) {
    return {
      isStale: false,
      previousRoundId: lastKnownRoundId,
      currentRoundId: newRoundId,
      recoveryNeeded: false,
    };
  }

  // Round changed - stale!
  const previousRoundId = lastKnownRoundId;
  updateKnownRoundState(newRoundId);

  return {
    isStale: true,
    previousRoundId,
    currentRoundId: newRoundId,
    recoveryNeeded: true,
  };
}

/**
 * Check if a guess result indicates a stale round
 *
 * @param status - The status from a guess result
 * @returns True if the status indicates round has closed
 */
export function isRoundClosedStatus(status: string): boolean {
  return status === 'round_closed';
}

/**
 * Get the last known round ID
 */
export function getLastKnownRoundId(): number | null {
  return lastKnownRoundId;
}

/**
 * Get time since last round state update
 */
export function getTimeSinceLastUpdate(): number {
  if (lastKnownTimestamp === 0) return Infinity;
  return Date.now() - lastKnownTimestamp;
}

/**
 * Check if round state is potentially stale based on time
 * (no API call - just time-based heuristic)
 *
 * @param maxAgeMs - Maximum acceptable age in milliseconds (default: 60 seconds)
 */
export function isRoundStatePotentiallyStale(maxAgeMs: number = 60000): boolean {
  return getTimeSinceLastUpdate() > maxAgeMs;
}

// =============================================================================
// Recovery Logic
// =============================================================================

/**
 * Record a recovery attempt
 * @returns True if more attempts are allowed
 */
export function recordRecoveryAttempt(): boolean {
  recoveryAttempts++;
  return recoveryAttempts < MAX_RECOVERY_ATTEMPTS;
}

/**
 * Check if recovery should be attempted
 */
export function canAttemptRecovery(): boolean {
  return recoveryAttempts < MAX_RECOVERY_ATTEMPTS;
}

/**
 * Reset recovery attempts (call after successful recovery)
 */
export function resetRecoveryAttempts(): void {
  recoveryAttempts = 0;
}

/**
 * Get recovery status
 */
export function getRecoveryStatus(): {
  attempts: number;
  maxAttempts: number;
  canRetry: boolean;
} {
  return {
    attempts: recoveryAttempts,
    maxAttempts: MAX_RECOVERY_ATTEMPTS,
    canRetry: recoveryAttempts < MAX_RECOVERY_ATTEMPTS,
  };
}

// =============================================================================
// Recovery Actions
// =============================================================================

export type RecoveryAction =
  | { type: 'auto_refresh'; message: string }
  | { type: 'manual_refresh'; message: string }
  | { type: 'hard_refresh'; message: string };

/**
 * Determine the appropriate recovery action based on current state
 */
export function getRecoveryAction(staleResult: StaleRoundResult): RecoveryAction {
  if (!canAttemptRecovery()) {
    return {
      type: 'hard_refresh',
      message: 'Unable to load new round. Please refresh the page.',
    };
  }

  if (staleResult.previousRoundId !== null) {
    return {
      type: 'auto_refresh',
      message: `Round ${staleResult.previousRoundId} ended. Loading Round ${staleResult.currentRoundId}...`,
    };
  }

  return {
    type: 'manual_refresh',
    message: 'New round available. Tap to refresh.',
  };
}

// =============================================================================
// Event Logging
// =============================================================================

/**
 * Log stale round detection event
 * (Fire-and-forget, does not throw)
 */
export function logStaleRoundEvent(
  eventType: 'detected' | 'recovery_success' | 'recovery_failed',
  metadata: {
    previousRoundId: number | null;
    currentRoundId: number;
    fid?: number;
    recoveryAttempt?: number;
  }
): void {
  const eventName = {
    detected: ErrorAnalyticsEvents.ROUND_STALE_DETECTED,
    recovery_success: ErrorAnalyticsEvents.ROUND_STALE_RECOVERY_SUCCESS,
    recovery_failed: ErrorAnalyticsEvents.ROUND_STALE_RECOVERY_FAILED,
  }[eventType];

  // Fire-and-forget analytics logging
  try {
    fetch('/api/analytics/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventType: eventName,
        data: metadata,
      }),
    }).catch(() => {
      // Silently ignore
    });
  } catch {
    // Silently ignore
  }
}

// =============================================================================
// Round Comparison Utilities
// =============================================================================

/**
 * Compare two round IDs to determine transition type
 */
export function compareRounds(
  previousId: number | null,
  currentId: number
): 'first_load' | 'same' | 'next_round' | 'skip_round' | 'earlier_round' {
  if (previousId === null) return 'first_load';
  if (previousId === currentId) return 'same';
  if (currentId === previousId + 1) return 'next_round';
  if (currentId > previousId + 1) return 'skip_round';
  return 'earlier_round'; // This would be unexpected
}

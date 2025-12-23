/**
 * Operational Guard
 * Milestone 9.5: Kill Switch and Dead Day endpoint protection
 *
 * Provides guards for write endpoints that should be blocked during:
 * - Kill switch (all gameplay mutations blocked)
 * - Paused between rounds (dead day, after round resolution)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  isKillSwitchEnabled,
  getGameOperationalStatus,
  getKillSwitchState,
  OPERATIONAL_ERROR_CODES,
  type GameOperationalStatus,
} from './operational';

/**
 * Response returned when an operation is blocked
 */
export interface OperationalBlockedResponse {
  error: string;
  code: string;
  reason?: string;
  status: GameOperationalStatus;
}

/**
 * Guard result type
 */
export type GuardResult =
  | { blocked: false }
  | { blocked: true; response: OperationalBlockedResponse; statusCode: number };

/**
 * Check if gameplay write operations should be blocked
 *
 * Use this guard for:
 * - guess submission
 * - pack purchase
 * - any other route that mutates round state
 *
 * Returns { blocked: false } if operation can proceed,
 * or { blocked: true, response, statusCode } if blocked.
 */
export async function checkGameplayGuard(): Promise<GuardResult> {
  const status = await getGameOperationalStatus();

  switch (status) {
    case 'KILL_SWITCH_ACTIVE': {
      const state = await getKillSwitchState();
      return {
        blocked: true,
        statusCode: 503, // Service Unavailable
        response: {
          error: 'Game is temporarily paused. All paid packs will be refunded.',
          code: OPERATIONAL_ERROR_CODES.GAME_PAUSED_KILL_SWITCH,
          reason: state.reason,
          status,
        },
      };
    }

    case 'PAUSED_BETWEEN_ROUNDS': {
      return {
        blocked: true,
        statusCode: 503,
        response: {
          error: 'Game is between rounds. Please wait for the next round to start.',
          code: OPERATIONAL_ERROR_CODES.GAME_PAUSED_BETWEEN_ROUNDS,
          status,
        },
      };
    }

    case 'DEAD_DAY_ACTIVE':
    case 'NORMAL':
    default:
      // Dead day active but round is still going - allow gameplay
      // Normal - allow gameplay
      return { blocked: false };
  }
}

/**
 * Check if new round creation should be blocked
 *
 * Used by round resolution logic to determine if a new round should be created.
 * Returns true if new round creation should be blocked.
 */
export async function shouldBlockNewRoundCreation(): Promise<boolean> {
  const status = await getGameOperationalStatus();

  // Block new round if:
  // - Kill switch is active (obviously)
  // - Dead day is enabled (current round can finish, but no new round)
  return status === 'KILL_SWITCH_ACTIVE' ||
         status === 'DEAD_DAY_ACTIVE' ||
         status === 'PAUSED_BETWEEN_ROUNDS';
}

/**
 * Helper to apply the guard in an API handler
 *
 * Usage:
 * ```typescript
 * export default async function handler(req, res) {
 *   const guardResult = await applyGameplayGuard(req, res);
 *   if (guardResult) return; // Response already sent
 *
 *   // ... rest of handler
 * }
 * ```
 */
export async function applyGameplayGuard(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<boolean> {
  const result = await checkGameplayGuard();

  if (result.blocked) {
    res.status(result.statusCode).json(result.response);
    return true; // Indicate that response was sent
  }

  return false; // Allow operation to proceed
}

/**
 * Quick check if kill switch is active (for logging/analytics)
 */
export async function isGameplayBlocked(): Promise<boolean> {
  const status = await getGameOperationalStatus();
  return status === 'KILL_SWITCH_ACTIVE' || status === 'PAUSED_BETWEEN_ROUNDS';
}

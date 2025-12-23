/**
 * Admin Operational Status API
 * Milestone 9.5: Kill Switch and Dead Day
 *
 * GET /api/admin/operational/status
 *
 * Returns the current operational status including:
 * - Game status (NORMAL, KILL_SWITCH_ACTIVE, DEAD_DAY_ACTIVE, PAUSED_BETWEEN_ROUNDS)
 * - Kill switch state
 * - Dead day state
 * - Refund status for any cancelled rounds
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
import { isAdminFid } from '../me';
import {
  getOperationalState,
  getKillSwitchState,
  getDeadDayState,
  isRefundProcessingRunning,
} from '../../../../src/lib/operational';
import { getRefundSummary } from '../../../../src/lib/refunds';
import { db } from '../../../../src/db';
import { rounds } from '../../../../src/db/schema';
import { eq, isNull, and, desc } from 'drizzle-orm';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Auth check (simplified for dev mode)
    const devFid = req.query.devFid ? parseInt(req.query.devFid as string, 10) : null;
    const fidFromCookie = req.cookies.siwn_fid ? parseInt(req.cookies.siwn_fid, 10) : null;
    const fid = devFid || fidFromCookie;

    if (!fid || !isAdminFid(fid)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Get operational state
    const operationalState = await getOperationalState();
    const killSwitchState = await getKillSwitchState();
    const deadDayState = await getDeadDayState();
    const refundsRunning = await isRefundProcessingRunning();

    // Get cancelled rounds with pending refunds
    const cancelledRounds = await db
      .select({
        id: rounds.id,
        cancelledAt: rounds.cancelledAt,
        cancelledReason: rounds.cancelledReason,
        cancelledBy: rounds.cancelledBy,
        refundsStartedAt: rounds.refundsStartedAt,
        refundsCompletedAt: rounds.refundsCompletedAt,
      })
      .from(rounds)
      .where(eq(rounds.status, 'cancelled'))
      .orderBy(desc(rounds.cancelledAt))
      .limit(10);

    // Get refund summaries for cancelled rounds
    const refundSummaries = await Promise.all(
      cancelledRounds.map(async (round) => ({
        roundId: round.id,
        cancelledAt: round.cancelledAt,
        cancelledReason: round.cancelledReason,
        cancelledBy: round.cancelledBy,
        refundsStartedAt: round.refundsStartedAt,
        refundsCompletedAt: round.refundsCompletedAt,
        refunds: await getRefundSummary(round.id),
      }))
    );

    return res.status(200).json({
      ok: true,
      status: operationalState.status,
      activeRoundId: operationalState.activeRoundId,
      killSwitch: {
        ...killSwitchState,
        refundsRunning,
      },
      deadDay: deadDayState,
      cancelledRounds: refundSummaries,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[admin/operational/status] Error:', error);
    Sentry.captureException(error, {
      tags: { endpoint: 'admin-operational-status' },
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

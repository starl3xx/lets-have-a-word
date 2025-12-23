/**
 * Admin Refunds API
 * Milestone 9.5: Kill Switch and Dead Day
 *
 * GET /api/admin/operational/refunds?roundId=123
 *   - Get refund details for a specific round
 *
 * POST /api/admin/operational/refunds
 *   - action: 'retry-failed' - Retry failed refunds for a round
 *   - action: 'process' - Manually trigger refund processing
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
import { isAdminFid } from '../me';
import {
  getRefundPreview,
  getRoundRefunds,
  getRefundSummary,
  retryFailedRefunds,
  processRefunds,
} from '../../../../src/lib/refunds';
import { isRefundProcessingRunning } from '../../../../src/lib/operational';
import { db } from '../../../../src/db';
import { rounds } from '../../../../src/db/schema';
import { eq } from 'drizzle-orm';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    // Auth check (simplified for dev mode)
    let fid: number | null = null;

    if (req.method === 'GET') {
      const devFid = req.query.devFid ? parseInt(req.query.devFid as string, 10) : null;
      const fidFromCookie = req.cookies.siwn_fid ? parseInt(req.cookies.siwn_fid, 10) : null;
      fid = devFid || fidFromCookie;
    } else if (req.method === 'POST') {
      const devFid = req.body.devFid ? parseInt(req.body.devFid as string, 10) : null;
      const fidFromCookie = req.cookies.siwn_fid ? parseInt(req.cookies.siwn_fid, 10) : null;
      fid = devFid || fidFromCookie;
    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!fid || !isAdminFid(fid)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // GET: Retrieve refund details
    if (req.method === 'GET') {
      const roundId = req.query.roundId ? parseInt(req.query.roundId as string, 10) : null;

      if (!roundId) {
        return res.status(400).json({ error: 'roundId query parameter is required' });
      }

      // Verify round exists and is cancelled
      const [round] = await db
        .select({
          id: rounds.id,
          status: rounds.status,
          cancelledAt: rounds.cancelledAt,
          cancelledReason: rounds.cancelledReason,
          cancelledBy: rounds.cancelledBy,
          refundsStartedAt: rounds.refundsStartedAt,
          refundsCompletedAt: rounds.refundsCompletedAt,
        })
        .from(rounds)
        .where(eq(rounds.id, roundId))
        .limit(1);

      if (!round) {
        return res.status(404).json({ error: 'Round not found' });
      }

      if (round.status !== 'cancelled') {
        return res.status(400).json({
          error: 'Round is not cancelled',
          status: round.status,
        });
      }

      // Get refund data
      const [preview, allRefunds, summary] = await Promise.all([
        getRefundPreview(roundId),
        getRoundRefunds(roundId),
        getRefundSummary(roundId),
      ]);

      const refundsRunning = await isRefundProcessingRunning();

      return res.status(200).json({
        ok: true,
        round: {
          id: round.id,
          status: round.status,
          cancelledAt: round.cancelledAt,
          cancelledReason: round.cancelledReason,
          cancelledBy: round.cancelledBy,
          refundsStartedAt: round.refundsStartedAt,
          refundsCompletedAt: round.refundsCompletedAt,
        },
        preview,
        summary,
        refundsRunning,
        refunds: allRefunds.map(r => ({
          id: r.id,
          fid: r.fid,
          amountEth: r.amountEth,
          status: r.status,
          sentAt: r.sentAt,
          refundTxHash: r.refundTxHash,
          errorMessage: r.errorMessage,
          retryCount: r.retryCount,
        })),
      });
    }

    // POST: Perform refund actions
    if (req.method === 'POST') {
      const { action, roundId } = req.body;

      if (!roundId || typeof roundId !== 'number') {
        return res.status(400).json({ error: 'roundId is required' });
      }

      if (!action || !['retry-failed', 'process'].includes(action)) {
        return res.status(400).json({
          error: 'Invalid action. Use "retry-failed" or "process".',
        });
      }

      // Verify round is cancelled
      const [round] = await db
        .select({ status: rounds.status })
        .from(rounds)
        .where(eq(rounds.id, roundId))
        .limit(1);

      if (!round || round.status !== 'cancelled') {
        return res.status(400).json({
          error: 'Round is not cancelled',
          status: round?.status,
        });
      }

      if (action === 'retry-failed') {
        console.log(`[Refunds] Admin FID ${fid} retrying failed refunds for round ${roundId}`);

        const retried = await retryFailedRefunds(roundId);

        Sentry.captureMessage('Admin retried failed refunds', {
          level: 'info',
          tags: { type: 'admin-action', action: 'retry_refunds' },
          extra: { adminFid: fid, roundId, retried },
        });

        return res.status(200).json({
          ok: true,
          action: 'retry-failed',
          roundId,
          retriedCount: retried,
          message: `Reset ${retried} failed refund(s) to pending status.`,
        });
      }

      if (action === 'process') {
        console.log(`[Refunds] Admin FID ${fid} manually processing refunds for round ${roundId}`);

        const result = await processRefunds(roundId);

        Sentry.captureMessage('Admin manually processed refunds', {
          level: 'info',
          tags: { type: 'admin-action', action: 'process_refunds' },
          extra: { adminFid: fid, roundId, result },
        });

        return res.status(200).json({
          ok: result.success,
          action: 'process',
          roundId,
          result,
        });
      }
    }

    return res.status(400).json({ error: 'Invalid request' });
  } catch (error) {
    console.error('[admin/operational/refunds] Error:', error);
    Sentry.captureException(error, {
      tags: { endpoint: 'admin-refunds' },
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

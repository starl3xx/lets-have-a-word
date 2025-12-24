/**
 * Admin Dead Day API
 * Milestone 9.5: Kill Switch and Dead Day
 *
 * POST /api/admin/operational/dead-day
 *
 * Enable or disable dead day mode.
 *
 * Body:
 * - action: 'enable' | 'disable'
 * - reason: string (required for enable)
 * - reopenAt?: string (optional ISO timestamp for scheduled reopen)
 *
 * When enabled:
 * - Current round continues normally
 * - After round resolution, no new round is created
 * - Game enters PAUSED_BETWEEN_ROUNDS state
 * - If reopenAt is set, dead day will auto-disable at that time
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
import { isAdminFid } from '../me';
import {
  enableDeadDay,
  disableDeadDay,
  getDeadDayState,
  getGameOperationalStatus,
} from '../../../../src/lib/operational';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Auth check (simplified for dev mode)
    const devFid = req.body.devFid ? parseInt(req.body.devFid as string, 10) : null;
    const fidFromCookie = req.cookies.siwn_fid ? parseInt(req.cookies.siwn_fid, 10) : null;
    const fid = devFid || fidFromCookie;

    if (!fid || !isAdminFid(fid)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { action, reason, reopenAt } = req.body;

    if (!action || !['enable', 'disable'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action. Use "enable" or "disable".' });
    }

    if (action === 'enable') {
      if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
        return res.status(400).json({
          error: 'Reason is required (minimum 10 characters) when enabling dead day',
        });
      }

      // Validate reopenAt if provided
      let reopenAtDate: Date | undefined;
      if (reopenAt) {
        reopenAtDate = new Date(reopenAt);
        if (isNaN(reopenAtDate.getTime())) {
          return res.status(400).json({
            error: 'Invalid reopenAt timestamp. Use ISO 8601 format.',
          });
        }
        if (reopenAtDate <= new Date()) {
          return res.status(400).json({
            error: 'reopenAt must be in the future.',
          });
        }
      }

      console.log(`[DeadDay] Admin FID ${fid} enabling dead day: ${reason}`);

      // Enable dead day
      const result = await enableDeadDay({
        adminFid: fid,
        reason: reason.trim(),
        reopenAt: reopenAtDate?.toISOString(),
      });

      if (!result.success) {
        return res.status(400).json({
          ok: false,
          error: result.error,
        });
      }

      // Get current status
      const status = await getGameOperationalStatus();

      // Report to Sentry
      Sentry.captureMessage('Dead day enabled by admin', {
        level: 'info',
        tags: { type: 'admin-action', action: 'dead_day_enable' },
        extra: {
          adminFid: fid,
          reason,
          reopenAt: reopenAtDate?.toISOString(),
        },
      });

      return res.status(200).json({
        ok: true,
        action: 'enabled',
        status,
        reopenAt: reopenAtDate?.toISOString(),
        message: reopenAtDate
          ? `Dead day enabled. Current round will finish normally. Game will auto-resume at ${reopenAt}.`
          : 'Dead day enabled. Current round will finish normally. No new round will start until disabled.',
      });
    } else {
      // Disable dead day
      console.log(`[DeadDay] Admin FID ${fid} disabling dead day`);

      // Get state before disabling for response
      const previousState = await getDeadDayState();

      const result = await disableDeadDay({
        adminFid: fid,
      });

      if (!result.success) {
        return res.status(400).json({
          ok: false,
          error: result.error,
        });
      }

      // Get current status
      const status = await getGameOperationalStatus();

      // Report to Sentry
      Sentry.captureMessage('Dead day disabled by admin', {
        level: 'info',
        tags: { type: 'admin-action', action: 'dead_day_disable' },
        extra: {
          adminFid: fid,
        },
      });

      return res.status(200).json({
        ok: true,
        action: 'disabled',
        status,
        previousState: {
          reason: previousState.reason,
          reopenAt: previousState.reopenAt,
          appliesAfterRoundId: previousState.appliesAfterRoundId,
        },
        message: 'Dead day disabled. Normal round progression will resume.',
      });
    }
  } catch (error) {
    console.error('[admin/operational/dead-day] Error:', error);
    Sentry.captureException(error, {
      tags: { endpoint: 'admin-dead-day' },
      extra: { action: req.body?.action },
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

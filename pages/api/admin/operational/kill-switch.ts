/**
 * Admin Kill Switch API
 * Milestone 9.5: Kill Switch and Dead Day
 *
 * POST /api/admin/operational/kill-switch
 *
 * Enable or disable the kill switch.
 *
 * Body:
 * - action: 'enable' | 'disable'
 * - reason: string (required for enable)
 *
 * When enabled:
 * - Immediately blocks all gameplay mutations
 * - Cancels the active round
 * - Creates refund records for all pack purchases
 * - Triggers refund processing via cron
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
import { isAdminFid } from '../me';
import {
  enableKillSwitch,
  disableKillSwitch,
  getKillSwitchState,
} from '../../../../src/lib/operational';
import { createRefundsForRound, getRefundPreview } from '../../../../src/lib/refunds';

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

    const { action, reason } = req.body;

    if (!action || !['enable', 'disable'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action. Use "enable" or "disable".' });
    }

    if (action === 'enable') {
      if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
        return res.status(400).json({
          error: 'Reason is required (minimum 10 characters) when enabling kill switch',
        });
      }

      console.log(`[KillSwitch] Admin FID ${fid} enabling kill switch: ${reason}`);

      // Enable kill switch
      const result = await enableKillSwitch({
        adminFid: fid,
        reason: reason.trim(),
      });

      if (!result.success) {
        return res.status(400).json({
          ok: false,
          error: result.error,
        });
      }

      // Create refund records immediately
      let refundPreview = null;
      let refundsCreated = 0;

      if (result.roundId) {
        refundPreview = await getRefundPreview(result.roundId);
        const createResult = await createRefundsForRound(result.roundId, fid);
        refundsCreated = createResult.created;
      }

      // Report to Sentry
      Sentry.captureMessage('Kill switch enabled by admin', {
        level: 'warning',
        tags: { type: 'admin-action', action: 'kill_switch_enable' },
        extra: {
          adminFid: fid,
          roundId: result.roundId,
          reason,
          refundsCreated,
        },
      });

      return res.status(200).json({
        ok: true,
        action: 'enabled',
        roundId: result.roundId,
        refundsCreated,
        refundPreview: refundPreview ? {
          userCount: refundPreview.userCount,
          totalRefundEth: refundPreview.totalRefundEth,
        } : null,
        message: 'Kill switch enabled. Gameplay is now blocked. Refunds will be processed.',
      });
    } else {
      // Disable kill switch
      console.log(`[KillSwitch] Admin FID ${fid} disabling kill switch`);

      // Get state before disabling for response
      const previousState = await getKillSwitchState();

      const result = await disableKillSwitch({
        adminFid: fid,
      });

      if (!result.success) {
        return res.status(400).json({
          ok: false,
          error: result.error,
        });
      }

      // Report to Sentry
      Sentry.captureMessage('Kill switch disabled by admin', {
        level: 'info',
        tags: { type: 'admin-action', action: 'kill_switch_disable' },
        extra: {
          adminFid: fid,
          previousRoundId: previousState.roundId,
        },
      });

      return res.status(200).json({
        ok: true,
        action: 'disabled',
        previousRoundId: previousState.roundId,
        message: 'Kill switch disabled. A new round can now be created.',
      });
    }
  } catch (error) {
    console.error('[admin/operational/kill-switch] Error:', error);
    Sentry.captureException(error, {
      tags: { endpoint: 'admin-kill-switch' },
      extra: { action: req.body?.action },
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

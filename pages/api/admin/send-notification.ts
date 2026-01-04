/**
 * Admin API to send push notifications
 *
 * POST /api/admin/send-notification
 * Body: { title: string, body: string, targetUrl?: string }
 *
 * Uses Neynar's Frame Notifications API to send push notifications
 * to users who have enabled notifications for the mini app.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from './me';
import { notifyCustom } from '../../../src/lib/notifications';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth check
  const devFid = req.query.devFid ? parseInt(req.query.devFid as string, 10) : null;
  const fidFromCookie = req.cookies.siwn_fid ? parseInt(req.cookies.siwn_fid, 10) : null;
  const fid = devFid || fidFromCookie;

  if (!fid || !isAdminFid(fid)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { title, body, targetUrl } = req.body;

  if (!title || typeof title !== 'string') {
    return res.status(400).json({ error: 'title is required and must be a string' });
  }

  if (!body || typeof body !== 'string') {
    return res.status(400).json({ error: 'body is required and must be a string' });
  }

  // Validate title length (Neynar limit is typically 50 chars for title)
  if (title.length > 50) {
    return res.status(400).json({ error: 'title must be 50 characters or less' });
  }

  // Validate body length (Neynar limit is typically 200 chars for body)
  if (body.length > 200) {
    return res.status(400).json({ error: 'body must be 200 characters or less' });
  }

  try {
    const result = await notifyCustom(title, body, targetUrl);

    if (result.success) {
      return res.status(200).json({
        success: true,
        notificationId: result.notificationId,
        recipientCount: result.recipientCount,
      });
    } else {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to send notification',
      });
    }
  } catch (error) {
    console.error('[send-notification] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to send notification',
    });
  }
}

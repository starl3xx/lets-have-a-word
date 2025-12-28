/**
 * Farcaster Mini App Webhook Handler
 * OG Hunter Campaign: Tracks mini app add/remove events
 *
 * Farcaster sends webhook events when users:
 * - Add the mini app (frame_added)
 * - Remove the mini app (frame_removed)
 * - Enable/disable notifications (notifications_enabled, notifications_disabled)
 *
 * We use frame_added to track when users add the mini app for OG Hunter eligibility.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../src/db';
import { users } from '../../src/db/schema';
import { eq } from 'drizzle-orm';

// Webhook event types from Farcaster
type WebhookEventType =
  | 'frame_added'
  | 'frame_removed'
  | 'notifications_enabled'
  | 'notifications_disabled';

interface WebhookEvent {
  event: WebhookEventType;
  notificationDetails?: {
    url: string;
    token: string;
  };
}

interface WebhookPayload {
  fid: number;
  event: WebhookEvent;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body as WebhookPayload;

    // Validate payload structure
    if (!payload || typeof payload.fid !== 'number' || !payload.event) {
      console.warn('[Webhook] Invalid payload structure:', JSON.stringify(req.body).slice(0, 200));
      return res.status(400).json({ error: 'Invalid payload' });
    }

    const { fid, event } = payload;
    const eventType = event.event;

    console.log(`[Webhook] Received ${eventType} event for FID ${fid}`);

    switch (eventType) {
      case 'frame_added': {
        // User added the mini app - record timestamp for OG Hunter eligibility
        await handleFrameAdded(fid);
        break;
      }

      case 'frame_removed': {
        // User removed the mini app - we keep the original add timestamp
        // (OG Hunter badge is permanent once earned)
        console.log(`[Webhook] FID ${fid} removed mini app (timestamp preserved)`);
        break;
      }

      case 'notifications_enabled': {
        // User enabled notifications - store notification details if needed
        if (event.notificationDetails) {
          console.log(`[Webhook] FID ${fid} enabled notifications`);
          // Could store notification token for future use
        }
        break;
      }

      case 'notifications_disabled': {
        console.log(`[Webhook] FID ${fid} disabled notifications`);
        break;
      }

      default: {
        console.warn(`[Webhook] Unknown event type: ${eventType}`);
      }
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('[Webhook] Error processing webhook:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Handle frame_added event - record when user added the mini app
 * Only sets addedMiniAppAt if not already set (preserve first add time)
 */
async function handleFrameAdded(fid: number): Promise<void> {
  try {
    // Check if user exists and already has addedMiniAppAt set
    const existingUser = await db.query.users.findFirst({
      where: eq(users.fid, fid),
      columns: { id: true, addedMiniAppAt: true },
    });

    if (existingUser) {
      // User exists - only update if addedMiniAppAt is not set
      if (!existingUser.addedMiniAppAt) {
        await db
          .update(users)
          .set({
            addedMiniAppAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(users.fid, fid));

        console.log(`[Webhook] Updated addedMiniAppAt for existing user FID ${fid}`);
      } else {
        console.log(`[Webhook] FID ${fid} already has addedMiniAppAt set, skipping`);
      }
    } else {
      // User doesn't exist yet - they'll need to interact with the app first
      // The addedMiniAppAt will be set when they're created via user-state endpoint
      console.log(`[Webhook] FID ${fid} not found in DB, will be tracked on first interaction`);

      // We can still create a minimal user record to capture the add event
      // This ensures we don't miss the add timestamp
      await db.insert(users).values({
        fid,
        addedMiniAppAt: new Date(),
        xp: 0,
        hasSeenIntro: false,
      }).onConflictDoUpdate({
        target: users.fid,
        set: {
          addedMiniAppAt: new Date(),
          updatedAt: new Date(),
        },
      });

      console.log(`[Webhook] Created new user record for FID ${fid} with addedMiniAppAt`);
    }
  } catch (error) {
    console.error(`[Webhook] Error handling frame_added for FID ${fid}:`, error);
    throw error;
  }
}

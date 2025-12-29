/**
 * Record Mini App Add API
 * Called by the client when sdk.actions.addMiniApp() succeeds
 *
 * This bypasses the webhook flow since Farcaster mini apps don't reliably
 * send webhook events for frame_added.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../src/db';
import { users } from '../../../src/db/schema';
import { eq } from 'drizzle-orm';

interface RecordAddRequest {
  fid: number;
}

interface RecordAddResponse {
  success: boolean;
  addedMiniAppAt?: string;
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<RecordAddResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { fid } = req.body as RecordAddRequest;

    if (!fid || typeof fid !== 'number') {
      return res.status(400).json({ success: false, error: 'Invalid FID' });
    }

    // Check if user exists
    const existingUser = await db.query.users.findFirst({
      where: eq(users.fid, fid),
      columns: { id: true, addedMiniAppAt: true },
    });

    const now = new Date();

    if (existingUser) {
      // Only update if not already set (preserve first add time)
      if (!existingUser.addedMiniAppAt) {
        await db
          .update(users)
          .set({
            addedMiniAppAt: now,
            updatedAt: now,
          })
          .where(eq(users.fid, fid));

        console.log(`[record-add] Set addedMiniAppAt for FID ${fid}`);
        return res.status(200).json({
          success: true,
          addedMiniAppAt: now.toISOString(),
        });
      } else {
        // Already recorded
        return res.status(200).json({
          success: true,
          addedMiniAppAt: existingUser.addedMiniAppAt.toISOString(),
        });
      }
    } else {
      // Create new user record with addedMiniAppAt
      await db.insert(users).values({
        fid,
        addedMiniAppAt: now,
        xp: 0,
        hasSeenIntro: false,
        hasSeenOgHunterThanks: false,
      });

      console.log(`[record-add] Created user FID ${fid} with addedMiniAppAt`);
      return res.status(200).json({
        success: true,
        addedMiniAppAt: now.toISOString(),
      });
    }
  } catch (error) {
    console.error('[record-add] Error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

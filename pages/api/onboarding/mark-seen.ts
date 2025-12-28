/**
 * Onboarding Mark Seen API
 * POST /api/onboarding/mark-seen
 *
 * Marks a specific onboarding modal as seen.
 *
 * Request body:
 * - fid: number
 * - key: 'intro' | 'ogHunterThanks'
 *
 * Used by OnboardingManager after user dismisses or completes a modal.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../src/db';
import { users } from '../../../src/db/schema';
import { eq } from 'drizzle-orm';

type OnboardingKey = 'intro' | 'ogHunterThanks';

interface MarkSeenRequest {
  fid: number;
  key: OnboardingKey;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ success: boolean } | { error: string }>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { fid, key } = req.body as MarkSeenRequest;

  // Validate FID
  if (!fid || typeof fid !== 'number' || fid <= 0) {
    return res.status(400).json({ error: 'Invalid fid' });
  }

  // Validate key
  if (!key || !['intro', 'ogHunterThanks'].includes(key)) {
    return res.status(400).json({ error: 'Invalid key. Must be "intro" or "ogHunterThanks"' });
  }

  try {
    // Map key to column name
    const columnUpdate = key === 'intro'
      ? { hasSeenIntro: true }
      : { hasSeenOgHunterThanks: true };

    // Update user record
    const result = await db
      .update(users)
      .set({
        ...columnUpdate,
        updatedAt: new Date(),
      })
      .where(eq(users.fid, fid))
      .returning({ fid: users.fid });

    if (result.length === 0) {
      // User doesn't exist - this is okay, they might not have been created yet
      console.log(`[onboarding/mark-seen] User ${fid} not found, skipping update`);
    } else {
      console.log(`[onboarding/mark-seen] Marked ${key} as seen for FID ${fid}`);
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('[onboarding/mark-seen] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

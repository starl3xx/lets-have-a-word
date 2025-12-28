/**
 * Onboarding Status API
 * GET /api/onboarding/status
 *
 * Returns the user's onboarding state including:
 * - hasSeenIntro: Whether user has seen the "How it works" tutorial
 * - hasSeenOgHunterThanks: Whether user has seen the OG Hunter thank-you modal
 * - isOgHunter: Whether user is eligible as an OG Hunter (added mini app + verified cast)
 * - ogHunterAwarded: Whether user has already claimed their OG Hunter badge
 *
 * Used by OnboardingManager to decide which modals to show post-launch.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../src/db';
import { users, ogHunterCastProofs, userBadges } from '../../../src/db/schema';
import { eq, and } from 'drizzle-orm';

export interface OnboardingStatusResponse {
  hasSeenIntro: boolean;
  hasSeenOgHunterThanks: boolean;
  isOgHunter: boolean;
  ogHunterAwarded: boolean;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<OnboardingStatusResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get FID from query params
  const fidParam = req.query.fid || req.query.devFid;
  if (!fidParam || typeof fidParam !== 'string') {
    return res.status(400).json({ error: 'Missing fid parameter' });
  }

  const fid = parseInt(fidParam, 10);
  if (isNaN(fid) || fid <= 0) {
    return res.status(400).json({ error: 'Invalid fid parameter' });
  }

  try {
    // Get user record
    const user = await db.query.users.findFirst({
      where: eq(users.fid, fid),
      columns: {
        hasSeenIntro: true,
        hasSeenOgHunterThanks: true,
        addedMiniAppAt: true,
      },
    });

    // If user doesn't exist, return defaults (not an error - user may be new)
    if (!user) {
      return res.status(200).json({
        hasSeenIntro: false,
        hasSeenOgHunterThanks: false,
        isOgHunter: false,
        ogHunterAwarded: false,
      });
    }

    // Check if user is an OG Hunter (added mini app + has verified cast proof)
    let isOgHunter = false;
    if (user.addedMiniAppAt) {
      const castProof = await db.query.ogHunterCastProofs.findFirst({
        where: eq(ogHunterCastProofs.fid, fid),
        columns: { id: true },
      });
      isOgHunter = !!castProof;
    }

    // Check if badge is already awarded
    const badge = await db.query.userBadges.findFirst({
      where: and(
        eq(userBadges.fid, fid),
        eq(userBadges.badgeType, 'OG_HUNTER')
      ),
      columns: { id: true },
    });
    const ogHunterAwarded = !!badge;

    return res.status(200).json({
      hasSeenIntro: user.hasSeenIntro,
      hasSeenOgHunterThanks: user.hasSeenOgHunterThanks,
      isOgHunter,
      ogHunterAwarded,
    });
  } catch (error) {
    console.error('[onboarding/status] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

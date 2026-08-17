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
import { getActiveRound } from '../../../src/lib/rounds';
import { REWARD_GATE_GRANDFATHER_LAST_ROUND } from '../../../config/economy';
import { EARLY_ADOPTER_LAST_ROUND } from '../../../src/lib/wordmarks';

export interface OnboardingStatusResponse {
  hasSeenIntro: boolean;
  hasSeenOgHunterThanks: boolean;
  hasSeenSuperguessAnnouncement: boolean;
  hasSeenRound34Announcement: boolean;
  /**
   * True only while the ACTIVE round pays $WORD. This is the leak guard: the
   * round-34 announcement is never offered before round 34 actually starts,
   * so opening the app early cannot reveal the update.
   */
  wordEraActive: boolean;
  /** First guess in rounds 1–27 — plays free under the reward gate */
  grandfathered: boolean;
  /**
   * First guess in rounds 1–18 (before round 19, the first botted round) —
   * holds the complimentary Early Adopter 💅 wordmark. A strict subset of
   * `grandfathered`: rounds 19–27 players are in free but do NOT get the mark.
   */
  earlyAdopter: boolean;
  isOgHunter: boolean;
  ogHunterAwarded: boolean;
  /** Whether user has installed the mini app (addedMiniAppAt is set) */
  hasMiniAppInstalled: boolean;
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
    // OPTIMIZATION: Run all queries in parallel instead of sequentially
    // This reduces total query time from ~150ms (3x50ms) to ~50ms
    const [user, castProof, badge, activeRound] = await Promise.all([
      // Get user record
      db.query.users.findFirst({
        where: eq(users.fid, fid),
        columns: {
          hasSeenIntro: true,
          hasSeenOgHunterThanks: true,
          hasSeenSuperguessAnnouncement: true,
          hasSeenRound34Announcement: true,
          firstGuessRound: true,
          addedMiniAppAt: true,
        },
      }),
      // Check for cast proof (OG Hunter eligibility)
      db.query.ogHunterCastProofs.findFirst({
        where: eq(ogHunterCastProofs.fid, fid),
        columns: { id: true },
      }),
      // Check if badge is already awarded
      db.query.userBadges.findFirst({
        where: and(
          eq(userBadges.fid, fid),
          eq(userBadges.badgeType, 'OG_HUNTER')
        ),
        columns: { id: true },
      }),
      // The era signal for the round-34 announcement. prize_currency is the
      // only truthful source (never a flag or a round number).
      getActiveRound().catch(() => null),
    ]);

    const wordEraActive = activeRound?.prizeCurrency === 'word';

    // If user doesn't exist, return defaults (not an error - user may be new)
    if (!user) {
      return res.status(200).json({
        hasSeenIntro: false,
        hasSeenOgHunterThanks: false,
        hasSeenSuperguessAnnouncement: false,
        hasSeenRound34Announcement: false,
        wordEraActive,
        grandfathered: false,
        earlyAdopter: false,
        isOgHunter: false,
        ogHunterAwarded: false,
        hasMiniAppInstalled: false,
      });
    }

    // OG Hunter = added mini app + has verified cast proof
    const isOgHunter = !!(user.addedMiniAppAt && castProof);
    const ogHunterAwarded = !!badge;

    return res.status(200).json({
      hasSeenIntro: user.hasSeenIntro,
      hasSeenOgHunterThanks: user.hasSeenOgHunterThanks,
      hasSeenSuperguessAnnouncement: user.hasSeenSuperguessAnnouncement,
      hasSeenRound34Announcement: user.hasSeenRound34Announcement,
      wordEraActive,
      grandfathered:
        user.firstGuessRound != null &&
        user.firstGuessRound <= REWARD_GATE_GRANDFATHER_LAST_ROUND,
      earlyAdopter:
        user.firstGuessRound != null &&
        user.firstGuessRound <= EARLY_ADOPTER_LAST_ROUND,
      isOgHunter,
      ogHunterAwarded,
      hasMiniAppInstalled: !!user.addedMiniAppAt,
    });
  } catch (error) {
    console.error('[onboarding/status] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

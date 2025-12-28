/**
 * OG Hunter Campaign Library
 * Prelaunch Campaign: Badge system for early adopters
 *
 * Eligibility Requirements:
 * 1. User added the mini app (users.addedMiniAppAt IS NOT NULL)
 * 2. User shared via cast (og_hunter_cast_proofs record exists)
 *
 * Rewards:
 * - OG Hunter badge (permanent)
 * - +500 XP
 */

import { db } from '../db';
import { users, userBadges, ogHunterCastProofs, xpEvents } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { XP_VALUES } from '../types';
import { verifyRecentShareCast } from './farcaster';

// Configuration
export const OG_HUNTER_XP_AMOUNT = XP_VALUES.OG_HUNTER_AWARD; // 500 XP
export const OG_HUNTER_SHARE_URL = 'letshaveaword.fun';
export const OG_HUNTER_CAST_LOOKBACK_MINUTES = 60 * 24 * 7; // 7 days for prelaunch

/**
 * Check if prelaunch mode is enabled
 */
export function isPrelaunchMode(): boolean {
  return process.env.NEXT_PUBLIC_PRELAUNCH_MODE === '1';
}

/**
 * OG Hunter Status Response
 */
export interface OgHunterStatus {
  prelaunchModeEnabled: boolean;
  addedMiniAppVerified: boolean;
  addedMiniAppAt: string | null;
  sharedCastVerified: boolean;
  sharedCastAt: string | null;
  castHash: string | null;
  isEligible: boolean;
  isAwarded: boolean;
  awardedAt: string | null;
  xpAwardAmount: number;
  shareUrl: string;
  shareText: string;
}

/**
 * Get canonical share URL for OG Hunter campaign
 */
export function getShareUrl(): string {
  return 'https://letshaveaword.fun';
}

/**
 * Get canonical share text for OG Hunter campaign
 */
export function getShareText(): string {
  return `I'm becoming an OG Hunter for @letshaveaword! 🕵️‍♂️

Add the mini app + share a cast before launch to earn a permanent badge and 500 XP 🏆

https://www.letshaveaword.fun`;
}

/**
 * Get OG Hunter status for a user
 */
export async function getOgHunterStatus(fid: number): Promise<OgHunterStatus> {
  // Get user record
  const user = await db.query.users.findFirst({
    where: eq(users.fid, fid),
    columns: {
      addedMiniAppAt: true,
    },
  });

  // Get cast proof
  const castProof = await db.query.ogHunterCastProofs.findFirst({
    where: eq(ogHunterCastProofs.fid, fid),
  });

  // Get badge
  const badge = await db.query.userBadges.findFirst({
    where: and(
      eq(userBadges.fid, fid),
      eq(userBadges.badgeType, 'OG_HUNTER')
    ),
  });

  const addedMiniAppVerified = !!user?.addedMiniAppAt;
  const sharedCastVerified = !!castProof;
  const isAwarded = !!badge;
  const isEligible = addedMiniAppVerified && sharedCastVerified && !isAwarded;

  return {
    prelaunchModeEnabled: isPrelaunchMode(),
    addedMiniAppVerified,
    addedMiniAppAt: user?.addedMiniAppAt?.toISOString() || null,
    sharedCastVerified,
    sharedCastAt: castProof?.verifiedAt?.toISOString() || null,
    castHash: castProof?.castHash || null,
    isEligible,
    isAwarded,
    awardedAt: badge?.awardedAt?.toISOString() || null,
    xpAwardAmount: OG_HUNTER_XP_AMOUNT,
    shareUrl: getShareUrl(),
    shareText: getShareText(),
  };
}

/**
 * Verify a user's cast for OG Hunter eligibility
 * Uses Neynar API to find recent casts containing the game URL
 *
 * @returns Updated status or error
 */
export async function verifyOgHunterCast(fid: number): Promise<{
  success: boolean;
  status?: OgHunterStatus;
  error?: string;
}> {
  // Check if prelaunch mode is enabled
  if (!isPrelaunchMode()) {
    return { success: false, error: 'OG Hunter campaign is not active' };
  }

  // Check if user already has verified cast
  const existingProof = await db.query.ogHunterCastProofs.findFirst({
    where: eq(ogHunterCastProofs.fid, fid),
  });

  if (existingProof) {
    const status = await getOgHunterStatus(fid);
    return { success: true, status };
  }

  // Verify recent cast via Neynar
  const castResult = await verifyRecentShareCast(
    fid,
    OG_HUNTER_SHARE_URL,
    OG_HUNTER_CAST_LOOKBACK_MINUTES
  );

  if (!castResult) {
    return {
      success: false,
      error: 'No valid cast found. Make sure your cast mentions letshaveaword.fun and was posted recently.',
    };
  }

  // Store the verified cast proof
  try {
    await db.insert(ogHunterCastProofs).values({
      fid,
      castHash: castResult.castHash,
      castText: castResult.text.slice(0, 1000), // Truncate to fit column
      castUrl: `https://warpcast.com/~/conversations/${castResult.castHash}`,
      verifiedAt: new Date(),
    }).onConflictDoNothing(); // Idempotent - ignore if already exists

    console.log(`[OgHunter] Verified cast for FID ${fid}: ${castResult.castHash}`);
  } catch (error) {
    console.error(`[OgHunter] Error storing cast proof for FID ${fid}:`, error);
    return { success: false, error: 'Failed to store verification proof' };
  }

  const status = await getOgHunterStatus(fid);
  return { success: true, status };
}

/**
 * Claim OG Hunter badge and XP reward
 * Idempotent - will not double-award
 *
 * @returns Updated status or error
 */
export async function claimOgHunterBadge(fid: number): Promise<{
  success: boolean;
  status?: OgHunterStatus;
  error?: string;
}> {
  // Check if prelaunch mode is enabled
  if (!isPrelaunchMode()) {
    return { success: false, error: 'OG Hunter campaign is not active' };
  }

  // Get current status
  const currentStatus = await getOgHunterStatus(fid);

  // Check if already awarded
  if (currentStatus.isAwarded) {
    return { success: true, status: currentStatus };
  }

  // Check eligibility
  if (!currentStatus.addedMiniAppVerified) {
    return { success: false, error: 'You must add the mini app first' };
  }

  if (!currentStatus.sharedCastVerified) {
    return { success: false, error: 'You must share via cast and verify it first' };
  }

  // Get cast proof for metadata
  const castProof = await db.query.ogHunterCastProofs.findFirst({
    where: eq(ogHunterCastProofs.fid, fid),
  });

  try {
    // Award badge + XP atomically in a single transaction
    // This ensures no partial awards (badge without XP or vice versa)
    await db.transaction(async (tx) => {
      // Award badge (idempotent via unique constraint)
      await tx.insert(userBadges).values({
        fid,
        badgeType: 'OG_HUNTER',
        metadata: {
          castHash: castProof?.castHash,
          castUrl: castProof?.castUrl,
          campaignVersion: 1,
        },
        awardedAt: new Date(),
      }).onConflictDoNothing();

      // Award XP (check for existing award first to ensure idempotency)
      const existingXpAward = await tx.query.xpEvents.findFirst({
        where: and(
          eq(xpEvents.fid, fid),
          eq(xpEvents.eventType, 'OG_HUNTER_AWARD')
        ),
      });

      if (!existingXpAward) {
        await tx.insert(xpEvents).values({
          fid,
          eventType: 'OG_HUNTER_AWARD',
          xpAmount: OG_HUNTER_XP_AMOUNT,
          metadata: {
            badgeType: 'OG_HUNTER',
            castHash: castProof?.castHash,
          },
          createdAt: new Date(),
        });

        console.log(`[OgHunter] Awarded ${OG_HUNTER_XP_AMOUNT} XP to FID ${fid}`);
      }

      console.log(`[OgHunter] Awarded OG_HUNTER badge to FID ${fid}`);
    });
  } catch (error) {
    console.error(`[OgHunter] Error awarding badge to FID ${fid}:`, error);
    return { success: false, error: 'Failed to award badge' };
  }

  const status = await getOgHunterStatus(fid);
  return { success: true, status };
}

/**
 * Check if a user has the OG Hunter badge
 */
export async function hasOgHunterBadge(fid: number): Promise<boolean> {
  const badge = await db.query.userBadges.findFirst({
    where: and(
      eq(userBadges.fid, fid),
      eq(userBadges.badgeType, 'OG_HUNTER')
    ),
    columns: { id: true },
  });

  return !!badge;
}

/**
 * Get all badges for a user
 */
export async function getUserBadges(fid: number): Promise<Array<{
  badgeType: string;
  awardedAt: Date;
  metadata: Record<string, unknown> | null;
}>> {
  const badges = await db.query.userBadges.findMany({
    where: eq(userBadges.fid, fid),
    columns: {
      badgeType: true,
      awardedAt: true,
      metadata: true,
    },
    orderBy: (badges, { desc }) => [desc(badges.awardedAt)],
  });

  return badges;
}

// NOTE: markMiniAppAdded was removed for security.
// The addedMiniAppAt timestamp can ONLY be set via verified webhook from Farcaster.
// This ensures the "add mini app" step cannot be spoofed by clients.

/**
 * User Quality Gating
 * Milestone 5.3: Neynar User Quality Score Anti-bot Protection
 *
 * Gates gameplay access based on Neynar's User Quality Score:
 * - Only users with user_score >= 0.6 may submit guesses or purchase guess packs
 * - Score is cached in DB with a last-checked timestamp (refreshed every 24h)
 * - Blocked attempts are logged for analytics/abuse reviews
 */

import { db } from '../db';
import { users } from '../db/schema';
import { eq, lt, isNull, or, sql } from 'drizzle-orm';
import { neynarClient } from './farcaster';
import { logAnalyticsEvent } from './analytics';

/**
 * Minimum user quality score required to play
 * As of 2025-11-24, ~307,775 Farcaster users meet this threshold
 */
export const MIN_USER_SCORE = 0.6;

/**
 * How long to cache user scores (24 hours in milliseconds)
 */
export const SCORE_CACHE_DURATION_MS = 24 * 60 * 60 * 1000;

/**
 * Error code for insufficient user score
 */
export const INSUFFICIENT_USER_SCORE_ERROR = 'INSUFFICIENT_USER_SCORE';

/**
 * Result of a user quality check
 */
export interface UserQualityCheckResult {
  eligible: boolean;
  score: number | null;
  reason?: string;
  errorCode?: string;
  helpUrl?: string;
}

/**
 * Check if a user is eligible to play based on their Neynar user quality score
 *
 * @param fid - Farcaster ID of the user
 * @param forceRefresh - Force a fresh fetch from Neynar API
 * @returns UserQualityCheckResult
 */
export async function checkUserQuality(
  fid: number,
  forceRefresh: boolean = false
): Promise<UserQualityCheckResult> {
  try {
    // Fetch user from database
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.fid, fid))
      .limit(1);

    // Check if we have a cached score that's still valid
    const now = new Date();
    const scoreStale = !user?.userScoreUpdatedAt ||
      (now.getTime() - user.userScoreUpdatedAt.getTime()) > SCORE_CACHE_DURATION_MS;

    if (!forceRefresh && user?.userScore !== null && !scoreStale) {
      // Use cached score
      const score = parseFloat(user.userScore);
      return evaluateScore(fid, score);
    }

    // Fetch fresh score from Neynar
    const freshScore = await fetchUserScoreFromNeynar(fid);

    if (freshScore === null) {
      // Could not fetch score - allow gameplay but log warning
      console.warn(`[UserQuality] Could not fetch score for FID ${fid}, allowing with warning`);
      return {
        eligible: true,
        score: null,
        reason: 'Score temporarily unavailable - allowing access',
      };
    }

    // Update cached score in database
    await updateCachedUserScore(fid, freshScore);

    return evaluateScore(fid, freshScore);

  } catch (error) {
    console.error(`[UserQuality] Error checking user quality for FID ${fid}:`, error);

    // On error, allow gameplay but log
    return {
      eligible: true,
      score: null,
      reason: 'Error checking user score - allowing access',
    };
  }
}

/**
 * Evaluate a user's score and return eligibility result
 */
function evaluateScore(fid: number, score: number): UserQualityCheckResult {
  if (score >= MIN_USER_SCORE) {
    return {
      eligible: true,
      score,
    };
  }

  // User is not eligible
  return {
    eligible: false,
    score,
    reason: `Your Farcaster reputation score (${score.toFixed(2)}) is below the minimum required (${MIN_USER_SCORE}). ` +
      `Build more onchain and Farcaster activity to increase your score.`,
    errorCode: INSUFFICIENT_USER_SCORE_ERROR,
    helpUrl: 'https://docs.neynar.com/docs/user-scores',
  };
}

/**
 * Fetch user quality score from Neynar API
 */
async function fetchUserScoreFromNeynar(fid: number): Promise<number | null> {
  try {
    // Check if Neynar API key is configured
    if (!process.env.NEYNAR_API_KEY) {
      console.warn('[UserQuality] NEYNAR_API_KEY not set, skipping score check');
      return null;
    }

    // Fetch user data from Neynar
    const userData = await neynarClient.fetchBulkUsers({ fids: [fid] });

    if (!userData.users || userData.users.length === 0) {
      console.warn(`[UserQuality] User FID ${fid} not found in Neynar`);
      return null;
    }

    const user = userData.users[0];

    // Neynar provides experimental_user_score or similar field
    // The exact field name may vary based on Neynar SDK version
    // Common fields: experimental_user_score, power_badge, follower_count
    let score: number | null = null;

    // Try to get the experimental user score (primary method)
    if ('experimental_user_score' in user && typeof user.experimental_user_score === 'number') {
      score = user.experimental_user_score;
    }
    // Fallback: Calculate a proxy score based on available metrics
    else if (user.follower_count !== undefined && user.following_count !== undefined) {
      // Proxy calculation: normalize follower ratio and activity
      // This is a fallback if the experimental_user_score is not available
      const followers = user.follower_count || 0;
      const following = user.following_count || 1; // Avoid division by zero

      // Simple proxy: higher followers with reasonable ratio = higher score
      // Normalized to 0-1 range
      const followerScore = Math.min(followers / 1000, 1); // Cap at 1000 followers
      const ratioScore = Math.min(followers / following, 2) / 2; // Cap at 2:1 ratio
      const powerBadgeBonus = (user as any).power_badge ? 0.3 : 0;

      score = Math.min((followerScore * 0.5 + ratioScore * 0.2 + powerBadgeBonus), 1);
    }

    if (score === null) {
      console.warn(`[UserQuality] Could not determine score for FID ${fid}`);
      return null;
    }

    console.log(`[UserQuality] FID ${fid} score: ${score.toFixed(3)}`);
    return score;

  } catch (error) {
    console.error(`[UserQuality] Error fetching score from Neynar for FID ${fid}:`, error);
    return null;
  }
}

/**
 * Update the cached user score in the database
 */
async function updateCachedUserScore(fid: number, score: number): Promise<void> {
  try {
    await db
      .update(users)
      .set({
        userScore: score.toFixed(3),
        userScoreUpdatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.fid, fid));

    console.log(`[UserQuality] Cached score ${score.toFixed(3)} for FID ${fid}`);
  } catch (error) {
    console.error(`[UserQuality] Error caching score for FID ${fid}:`, error);
    // Non-fatal - continue even if caching fails
  }
}

/**
 * Log a blocked gameplay attempt due to insufficient score
 */
export async function logBlockedAttempt(
  fid: number,
  score: number | null,
  action: string
): Promise<void> {
  await logAnalyticsEvent('USER_QUALITY_BLOCKED', {
    userId: fid,
    data: {
      score,
      action,
      minRequired: MIN_USER_SCORE,
      blockedAt: new Date().toISOString(),
    },
  });

  console.log(`🚫 [UserQuality] Blocked FID ${fid} (score: ${score}) from action: ${action}`);
}

/**
 * Get users with stale or missing scores that need refresh
 */
export async function getUsersNeedingScoreRefresh(limit: number = 100): Promise<number[]> {
  const staleThreshold = new Date(Date.now() - SCORE_CACHE_DURATION_MS);

  const staleUsers = await db
    .select({ fid: users.fid })
    .from(users)
    .where(
      or(
        isNull(users.userScore),
        isNull(users.userScoreUpdatedAt),
        lt(users.userScoreUpdatedAt, staleThreshold)
      )
    )
    .limit(limit);

  return staleUsers.map(u => u.fid);
}

/**
 * Batch refresh user scores (for cron job)
 */
export async function batchRefreshUserScores(fids: number[]): Promise<{
  refreshed: number;
  failed: number;
}> {
  let refreshed = 0;
  let failed = 0;

  for (const fid of fids) {
    try {
      const score = await fetchUserScoreFromNeynar(fid);
      if (score !== null) {
        await updateCachedUserScore(fid, score);
        refreshed++;
      } else {
        failed++;
      }

      // Rate limit: wait 100ms between requests
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`[UserQuality] Failed to refresh score for FID ${fid}:`, error);
      failed++;
    }
  }

  return { refreshed, failed };
}

/**
 * Get user quality statistics
 */
export async function getUserQualityStats(): Promise<{
  totalUsers: number;
  usersWithScore: number;
  eligibleUsers: number;
  ineligibleUsers: number;
  avgScore: number;
}> {
  const stats = await db
    .select({
      totalUsers: sql<number>`COUNT(*)`,
      usersWithScore: sql<number>`COUNT(${users.userScore})`,
      eligibleUsers: sql<number>`COUNT(CASE WHEN CAST(${users.userScore} AS DECIMAL) >= ${MIN_USER_SCORE} THEN 1 END)`,
      ineligibleUsers: sql<number>`COUNT(CASE WHEN CAST(${users.userScore} AS DECIMAL) < ${MIN_USER_SCORE} THEN 1 END)`,
      avgScore: sql<number>`COALESCE(AVG(CAST(${users.userScore} AS DECIMAL)), 0)`,
    })
    .from(users);

  return {
    totalUsers: stats[0]?.totalUsers || 0,
    usersWithScore: stats[0]?.usersWithScore || 0,
    eligibleUsers: stats[0]?.eligibleUsers || 0,
    ineligibleUsers: stats[0]?.ineligibleUsers || 0,
    avgScore: stats[0]?.avgScore || 0,
  };
}

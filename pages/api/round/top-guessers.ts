/**
 * Top Guessers API
 * Milestone 6.4.1
 *
 * Returns the top 10 guessers for the current active round
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../src/db';
import { guesses, rounds, users, userBadges } from '../../../src/db/schema';
import { eq, and, or, sql, desc, asc, lte, isNull, inArray } from 'drizzle-orm';
import { isDevModeEnabled } from '../../../src/lib/devGameState';
import { neynarClient } from '../../../src/lib/farcaster';
import { TOP10_LOCK_AFTER_GUESSES } from '../../../src/lib/top10-lock';
import { cacheAside, CacheKeys, CacheTTL } from '../../../src/lib/redis';
import { hasWordTokenBonus } from '../../../src/lib/word-token';

export interface TopGuesser {
  fid: number;
  username: string | null;
  guessCount: number;
  pfpUrl: string; // Farcaster profile picture URL
  hasOgHunterBadge: boolean;
  hasWordTokenBadge: boolean;
  hasBonusWordBadge: boolean;
  hasJackpotWinnerBadge: boolean;
  // New wordmarks
  hasDoubleWBadge: boolean;
  hasPatronBadge: boolean;
  hasQuickdrawBadge: boolean;
  hasEncyclopedicBadge: boolean;
  hasBakersDozenBadge: boolean;
}

export interface TopGuessersResponse {
  currentRoundId: number | null;
  topGuessers: TopGuesser[];
  uniqueGuessersCount: number;
}

// Cache for mock top guessers (refreshed on server restart)
let cachedMockGuessers: {
  guessers: TopGuesser[];
  uniqueCount: number;
  seed: number;
} | null = null;

/**
 * Simple seeded random number generator
 * Same seed always produces same sequence
 */
function seededRandom(seed: number): () => number {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

/**
 * Get a time-based seed that stays consistent within a 10-minute window
 */
function getTimeSeed(): number {
  return Math.floor(Date.now() / (10 * 60 * 1000));
}

/**
 * Clear the cached mock guessers
 * Call this to force new random values
 */
export function clearMockGuessersCache(): void {
  cachedMockGuessers = null;
  console.log('[top-guessers] Cleared mock guessers cache');
}

/**
 * Generate mock top guessers for dev mode
 * Fetches real Farcaster profiles via Neynar for realistic display
 * Uses seeded random for consistency across hot reloads
 */
async function generateMockTopGuessers(rng: () => number): Promise<TopGuesser[]> {
  // Generate 10 unique FIDs using seeded random
  const fids: number[] = [];
  const usedFids = new Set<number>();

  while (fids.length < 10) {
    const fid = Math.floor(rng() * 10000) + 1;
    if (!usedFids.has(fid)) {
      usedFids.add(fid);
      fids.push(fid);
    }
  }

  // Generate guess counts using seeded random (decreasing by rank with variance)
  // Total should be well under 750 since that's when top 10 locks
  // Realistic distribution: top guesser ~80-120, decreasing from there
  const guessCounts = fids.map((_, i) => {
    const baseGuesses = 100 - (i * 8); // 100, 92, 84, 76, 68, 60, 52, 44, 36, 28
    const variance = Math.floor(rng() * 15) - 7; // -7 to +7 variance
    return Math.max(15, baseGuesses + variance);
  });

  // Try to fetch real user data from Neynar
  let userDataMap: Map<number, { username: string; pfpUrl: string }> = new Map();

  try {
    const userData = await neynarClient.fetchBulkUsers({ fids });
    if (userData.users) {
      for (const user of userData.users) {
        userDataMap.set(user.fid, {
          username: user.username || `FID ${user.fid}`,
          pfpUrl: user.pfp_url || `https://avatar.vercel.sh/${user.fid}`,
        });
      }
    }
  } catch (error) {
    console.warn('[top-guessers] Could not fetch Neynar user data, using fallbacks:', error);
  }

  // Build the mock guessers list
  const mockGuessers: TopGuesser[] = fids.map((fid, i) => {
    const userData = userDataMap.get(fid);
    return {
      fid,
      username: userData?.username || `FID ${fid}`,
      guessCount: guessCounts[i],
      pfpUrl: userData?.pfpUrl || `https://avatar.vercel.sh/${fid}`,
      hasOgHunterBadge: false, // Dev mode: no badges
      hasWordTokenBadge: false, // Dev mode: no badges
      hasBonusWordBadge: false, // Dev mode: no badges
      hasJackpotWinnerBadge: false, // Dev mode: no badges
      hasDoubleWBadge: false, // Dev mode: no badges
      hasPatronBadge: false, // Dev mode: no badges
      hasQuickdrawBadge: false, // Dev mode: no badges
      hasEncyclopedicBadge: false, // Dev mode: no badges
      hasBakersDozenBadge: false, // Dev mode: no badges
    };
  });

  // Sort by guess count descending
  return mockGuessers.sort((a, b) => b.guessCount - a.guessCount);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<TopGuessersResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Dev mode: return mock data with real Neynar profiles
    if (isDevModeEnabled()) {
      const currentSeed = getTimeSeed();

      // Use cached mock data if available and seed hasn't changed
      if (cachedMockGuessers && cachedMockGuessers.seed === currentSeed) {
        return res.status(200).json({
          currentRoundId: 42,
          topGuessers: cachedMockGuessers.guessers,
          uniqueGuessersCount: cachedMockGuessers.uniqueCount,
        });
      }

      // Generate new mock data with seeded random
      console.log('[round/top-guessers] Dev mode: generating fresh mock top guessers');
      const rng = seededRandom(currentSeed * 7919); // Use prime multiplier for variety
      const mockGuessers = await generateMockTopGuessers(rng);
      const uniqueCount = Math.floor(100 + rng() * 200); // 100-300

      // Cache it with the seed
      cachedMockGuessers = {
        guessers: mockGuessers,
        uniqueCount,
        seed: currentSeed,
      };

      return res.status(200).json({
        currentRoundId: 42,
        topGuessers: mockGuessers,
        uniqueGuessersCount: uniqueCount,
      });
    }

    // Check for cache bypass
    const noCache = req.query.nocache === 'true';

    // Get current active round
    const [activeRound] = await db
      .select({ id: rounds.id })
      .from(rounds)
      .where(isNull(rounds.resolvedAt))
      .limit(1);

    const currentRoundId = activeRound?.id || null;

    if (!currentRoundId) {
      return res.status(200).json({
        currentRoundId: null,
        topGuessers: [],
        uniqueGuessersCount: 0,
      });
    }

    // Milestone 9.2: Cache top guessers data
    // Pass TTL of 0 to bypass cache when nocache=true
    const cacheKey = CacheKeys.topGuessers(currentRoundId);
    const cacheTTL = noCache ? 0 : CacheTTL.topGuessers;
    const cachedResponse = await cacheAside<TopGuessersResponse>(
      cacheKey,
      cacheTTL,
      async () => {
        // Get top 10 guessers for the current round
        // Group by FID, count guesses, join with users for username
        // Only count guesses from the first 750 (Top-10 eligible guesses)
        // This ensures the leaderboard shows accurate counts even after lock
        const [topGuessersData, uniqueCountResult] = await Promise.all([
          db
            .select({
              fid: guesses.fid,
              username: users.username,
              signerWalletAddress: users.signerWalletAddress,
              guessCount: sql<number>`cast(count(${guesses.id}) as int)`,
              // Track when player made their last guess (for tiebreaker)
              lastGuessIndex: sql<number>`cast(max(${guesses.guessIndexInRound}) as int)`,
            })
            .from(guesses)
            .leftJoin(users, eq(guesses.fid, users.fid))
            .where(
              and(
                eq(guesses.roundId, currentRoundId),
                // Include guesses where guessIndexInRound <= 750 OR is NULL
                // NULL values are treated as eligible (legacy data or edge cases)
                or(
                  lte(guesses.guessIndexInRound, TOP10_LOCK_AFTER_GUESSES),
                  isNull(guesses.guessIndexInRound)
                )
              )
            )
            .groupBy(guesses.fid, users.username, users.signerWalletAddress)
            // Primary: most guesses (desc), Secondary: who reached that count first (asc)
            .orderBy(desc(sql`count(${guesses.id})`), asc(sql`max(${guesses.guessIndexInRound})`))
            .limit(10),
          // Count total unique guessers
          db
            .select({
              count: sql<number>`cast(count(distinct ${guesses.fid}) as int)`,
            })
            .from(guesses)
            .where(eq(guesses.roundId, currentRoundId)),
        ]);

        const uniqueGuessersCount = uniqueCountResult[0]?.count || 0;

        // Get FIDs of top guessers to check for badges
        const topGuesserFids = topGuessersData.map((g) => g.fid);

        // OPTIMIZATION: Fetch ALL badges for these users in a single query
        // Instead of 8 separate queries (one per badge type), we fetch all badges
        // and filter in JavaScript - reduces DB round trips from 8 to 1
        const allBadges = topGuesserFids.length > 0
          ? await db
              .select({ fid: userBadges.fid, badgeType: userBadges.badgeType })
              .from(userBadges)
              .where(inArray(userBadges.fid, topGuesserFids))
          : [];

        // Build sets for O(1) lookup by badge type
        const ogHunterFids = new Set<number>();
        const bonusWordFids = new Set<number>();
        const jackpotWinnerFids = new Set<number>();
        const doubleWFids = new Set<number>();
        const patronFids = new Set<number>();
        const quickdrawFids = new Set<number>();
        const encyclopedicFids = new Set<number>();
        const bakersDozenFids = new Set<number>();

        for (const badge of allBadges) {
          switch (badge.badgeType) {
            case 'OG_HUNTER':
              ogHunterFids.add(badge.fid);
              break;
            case 'BONUS_WORD_FINDER':
              bonusWordFids.add(badge.fid);
              break;
            case 'JACKPOT_WINNER':
              jackpotWinnerFids.add(badge.fid);
              break;
            case 'DOUBLE_W':
              doubleWFids.add(badge.fid);
              break;
            case 'PATRON':
              patronFids.add(badge.fid);
              break;
            case 'QUICKDRAW':
              quickdrawFids.add(badge.fid);
              break;
            case 'ENCYCLOPEDIC':
              encyclopedicFids.add(badge.fid);
              break;
            case 'BAKERS_DOZEN':
              bakersDozenFids.add(badge.fid);
              break;
          }
        }

        // OPTIMIZATION: Run $WORD checks and Neynar profile fetch in parallel
        // These are independent external calls that were running sequentially
        const allFids = topGuessersData.map((g) => g.fid);
        const validFids = allFids.filter(fid => fid > 0 && Number.isInteger(fid));
        if (validFids.length !== allFids.length) {
          console.warn(`[top-guessers] Found ${allFids.length - validFids.length} invalid FIDs:`,
            allFids.filter(fid => !validFids.includes(fid)));
        }

        const walletsToCheck = topGuessersData
          .filter((g) => g.signerWalletAddress)
          .map((g) => ({ fid: g.fid, wallet: g.signerWalletAddress! }));

        // Run both external calls in parallel
        const [wordTokenResults, neynarResult] = await Promise.all([
          // $WORD balance checks (RPC calls)
          walletsToCheck.length > 0
            ? Promise.allSettled(
                walletsToCheck.map(async ({ fid, wallet }) => ({
                  fid,
                  hasWordToken: await hasWordTokenBonus(wallet),
                }))
              )
            : Promise.resolve([]),
          // Neynar profile fetch
          validFids.length > 0
            ? neynarClient.fetchBulkUsers({ fids: validFids }).catch((err) => {
                console.error('[top-guessers] Failed to fetch profiles from Neynar:', err);
                return { users: [] };
              })
            : Promise.resolve({ users: [] }),
        ]);

        // Process $WORD results
        const wordTokenHolders = new Set<number>();
        for (const result of wordTokenResults) {
          if (result.status === 'fulfilled' && result.value.hasWordToken) {
            wordTokenHolders.add(result.value.fid);
          }
        }

        // Process Neynar results
        const neynarProfiles = new Map<number, { username: string; pfpUrl: string }>();
        if (neynarResult.users && neynarResult.users.length > 0) {
          for (const user of neynarResult.users) {
            neynarProfiles.set(user.fid, {
              username: user.username || `fid:${user.fid}`,
              pfpUrl: user.pfp_url || `https://avatar.vercel.sh/${user.fid}`,
            });
          }
        }

        // Format response with profile picture URLs
        // Prefer Neynar data for both username and pfpUrl (more reliable)
        // IMPORTANT: Always use fid:XXX format as fallback, never "unknown"
        const topGuessers: TopGuesser[] = topGuessersData.map((g) => {
          const neynarProfile = neynarProfiles.get(g.fid);
          // Only use local DB username if it's a real username (not null, empty, or "unknown")
          const localUsername = g.username && g.username !== 'unknown' ? g.username : null;
          return {
            fid: g.fid,
            username: neynarProfile?.username || localUsername || `fid:${g.fid}`,
            guessCount: Number(g.guessCount),
            pfpUrl: neynarProfile?.pfpUrl || `https://avatar.vercel.sh/${g.fid}`,
            hasOgHunterBadge: ogHunterFids.has(g.fid),
            hasWordTokenBadge: wordTokenHolders.has(g.fid),
            hasBonusWordBadge: bonusWordFids.has(g.fid),
            hasJackpotWinnerBadge: jackpotWinnerFids.has(g.fid),
            hasDoubleWBadge: doubleWFids.has(g.fid),
            hasPatronBadge: patronFids.has(g.fid),
            hasQuickdrawBadge: quickdrawFids.has(g.fid),
            hasEncyclopedicBadge: encyclopedicFids.has(g.fid),
            hasBakersDozenBadge: bakersDozenFids.has(g.fid),
          };
        });

        return {
          currentRoundId,
          topGuessers,
          uniqueGuessersCount,
        };
      }
    );

    return res.status(200).json(cachedResponse);
  } catch (error) {
    console.error('[round/top-guessers] Error fetching top guessers:', error);
    return res.status(500).json({ error: 'Failed to fetch top guessers' });
  }
}

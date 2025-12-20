/**
 * Top Guessers API
 * Milestone 6.4.1
 *
 * Returns the top 10 guessers for the current active round
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../src/db';
import { guesses, rounds, users } from '../../../src/db/schema';
import { eq, and, sql, desc } from 'drizzle-orm';
import { isDevModeEnabled } from '../../../src/lib/devGameState';
import { neynarClient } from '../../../src/lib/farcaster';

export interface TopGuesser {
  fid: number;
  username: string | null;
  guessCount: number;
  pfpUrl: string; // Farcaster profile picture URL
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

    // Get current active round
    const [activeRound] = await db
      .select({ id: rounds.id })
      .from(rounds)
      .where(eq(rounds.resolvedAt, sql`null`))
      .limit(1);

    const currentRoundId = activeRound?.id || null;

    if (!currentRoundId) {
      return res.status(200).json({
        currentRoundId: null,
        topGuessers: [],
        uniqueGuessersCount: 0,
      });
    }

    // Get top 10 guessers for the current round
    // Group by FID, count guesses, join with users for username
    const [topGuessersData, uniqueCountResult] = await Promise.all([
      db
        .select({
          fid: guesses.fid,
          username: users.username,
          guessCount: sql<number>`cast(count(${guesses.id}) as int)`,
        })
        .from(guesses)
        .leftJoin(users, eq(guesses.fid, users.fid))
        .where(eq(guesses.roundId, currentRoundId))
        .groupBy(guesses.fid, users.username)
        .orderBy(desc(sql`count(${guesses.id})`))
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

    // Format response with profile picture URLs
    const topGuessers: TopGuesser[] = topGuessersData.map((g) => ({
      fid: g.fid,
      username: g.username || `FID ${g.fid}`,
      guessCount: Number(g.guessCount),
      // Using Warpcast's avatar endpoint
      pfpUrl: `https://warpcast.com/avatar/${g.fid}`,
    }));

    return res.status(200).json({
      currentRoundId,
      topGuessers,
      uniqueGuessersCount,
    });
  } catch (error) {
    console.error('[round/top-guessers] Error fetching top guessers:', error);
    return res.status(500).json({ error: 'Failed to fetch top guessers' });
  }
}

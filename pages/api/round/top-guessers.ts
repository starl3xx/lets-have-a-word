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
} | null = null;

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
 */
async function generateMockTopGuessers(): Promise<TopGuesser[]> {
  // Generate 10 unique random FIDs between 1 and 10,000
  const fids: number[] = [];
  const usedFids = new Set<number>();

  while (fids.length < 10) {
    const fid = Math.floor(Math.random() * 10000) + 1;
    if (!usedFids.has(fid)) {
      usedFids.add(fid);
      fids.push(fid);
    }
  }

  // Generate random guess counts (decreasing by rank with variance)
  const guessCounts = fids.map((_, i) => {
    const baseGuesses = 200 - (i * 15);
    const variance = Math.floor(Math.random() * 20) - 10;
    return Math.max(30, baseGuesses + variance);
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
      // Use cached mock data if available
      if (cachedMockGuessers) {
        return res.status(200).json({
          currentRoundId: 42,
          topGuessers: cachedMockGuessers.guessers,
          uniqueGuessersCount: cachedMockGuessers.uniqueCount,
        });
      }

      // Generate new mock data
      console.log('[round/top-guessers] Dev mode: generating fresh mock top guessers');
      const mockGuessers = await generateMockTopGuessers();
      const uniqueCount = Math.floor(100 + Math.random() * 200); // 100-300

      // Cache it
      cachedMockGuessers = {
        guessers: mockGuessers,
        uniqueCount,
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

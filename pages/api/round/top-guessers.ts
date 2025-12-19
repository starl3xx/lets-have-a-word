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

/**
 * Generate mock top guessers for dev mode
 * Uses seeded random for consistency during a session
 */
function generateMockTopGuessers(): TopGuesser[] {
  // Sample usernames for variety
  const sampleUsernames = [
    'dwr.eth', 'vitalik.eth', 'balajis', 'punk6529', 'cdixon',
    'jessepollak', 'linda', 'ace', 'coopahtroopa', 'gmoney.eth',
    'divine_economy', 'sassal.eth', 'hayden', 'nickcherry', 'horsefacts'
  ];

  const mockGuessers: TopGuesser[] = [];
  const usedFids = new Set<number>();

  for (let i = 0; i < 10; i++) {
    // Generate unique random FID between 1 and 10,000
    let fid: number;
    do {
      fid = Math.floor(Math.random() * 10000) + 1;
    } while (usedFids.has(fid));
    usedFids.add(fid);

    // Random guess count between 30 and 200, decreasing roughly by rank
    const baseGuesses = 200 - (i * 15);
    const variance = Math.floor(Math.random() * 20) - 10;
    const guessCount = Math.max(30, baseGuesses + variance);

    // Pick a username (some will have usernames, some won't)
    const hasUsername = Math.random() > 0.2;
    const username = hasUsername
      ? sampleUsernames[i % sampleUsernames.length]
      : null;

    mockGuessers.push({
      fid,
      username: username || `FID ${fid}`,
      guessCount,
      pfpUrl: `https://warpcast.com/avatar/${fid}`,
    });
  }

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
    // Dev mode: return mock data
    if (isDevModeEnabled()) {
      console.log('[round/top-guessers] Dev mode: returning mock top guessers');
      return res.status(200).json({
        currentRoundId: 42,
        topGuessers: generateMockTopGuessers(),
        uniqueGuessersCount: 156,
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

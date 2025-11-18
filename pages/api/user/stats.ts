/**
 * User Stats API
 * Milestone 4.3
 *
 * Returns per-user gameplay statistics
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../src/db';
import { guesses, rounds, roundPayouts, users } from '../../../src/db/schema';
import { eq, and, sql, count } from 'drizzle-orm';

export interface UserStatsResponse {
  guessesThisRound: number;
  guessesAllTime: number;
  paidGuessesThisRound: number;
  paidGuessesAllTime: number;
  jackpotsWon: number;
  totalEthWon: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<UserStatsResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let fid: number;

    // Get FID from query params
    if (req.query.devFid) {
      fid = parseInt(req.query.devFid as string, 10);
    } else if (req.query.fid) {
      fid = parseInt(req.query.fid as string, 10);
    } else {
      return res.status(400).json({ error: 'FID required' });
    }

    console.log(`[user/stats] Fetching stats for FID ${fid}`);

    // Get current active round
    const [activeRound] = await db
      .select({ id: rounds.id })
      .from(rounds)
      .where(eq(rounds.resolvedAt, sql`null`))
      .limit(1);

    const currentRoundId = activeRound?.id || null;

    // Get guesses this round
    let guessesThisRound = 0;
    let paidGuessesThisRound = 0;

    if (currentRoundId) {
      const roundGuesses = await db
        .select({
          total: count(),
          paid: sql<number>`count(*) filter (where ${guesses.isPaid} = true)`,
        })
        .from(guesses)
        .where(and(eq(guesses.fid, fid), eq(guesses.roundId, currentRoundId)));

      if (roundGuesses.length > 0) {
        guessesThisRound = Number(roundGuesses[0].total);
        paidGuessesThisRound = Number(roundGuesses[0].paid);
      }
    }

    // Get all-time guesses
    const allTimeGuesses = await db
      .select({
        total: count(),
        paid: sql<number>`count(*) filter (where ${guesses.isPaid} = true)`,
      })
      .from(guesses)
      .where(eq(guesses.fid, fid));

    const guessesAllTime = Number(allTimeGuesses[0]?.total || 0);
    const paidGuessesAllTime = Number(allTimeGuesses[0]?.paid || 0);

    // Get jackpots won (count of rounds where this user was the winner)
    const wonRounds = await db
      .select({ count: count() })
      .from(rounds)
      .where(eq(rounds.winnerFid, fid));

    const jackpotsWon = Number(wonRounds[0]?.count || 0);

    // Get total ETH won from payouts
    const payouts = await db
      .select({
        total: sql<string>`coalesce(sum(${roundPayouts.amountEth}), '0')`,
      })
      .from(roundPayouts)
      .where(eq(roundPayouts.fid, fid));

    const totalEthWon = payouts[0]?.total || '0';

    const response: UserStatsResponse = {
      guessesThisRound,
      guessesAllTime,
      paidGuessesThisRound,
      paidGuessesAllTime,
      jackpotsWon,
      totalEthWon,
    };

    console.log(`[user/stats] Stats for FID ${fid}:`, response);

    return res.status(200).json(response);
  } catch (error) {
    console.error('[user/stats] Error fetching user stats:', error);
    return res.status(500).json({ error: 'Failed to fetch user stats' });
  }
}

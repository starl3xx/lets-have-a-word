/**
 * User Stats API
 * Milestone 4.3
 *
 * Returns per-user gameplay statistics
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
import { db } from '../../../src/db';
import { guesses, rounds, roundPayouts, users, dailyGuessState } from '../../../src/db/schema';
import { eq, and, sql, count, isNull } from 'drizzle-orm';
import { cacheAside, CacheKeys, CacheTTL } from '../../../src/lib/redis';

export interface UserStatsResponse {
  guessesThisRound: number;
  guessesAllTime: number;
  paidGuessesThisRound: number;
  paidGuessesAllTime: number;
  jackpotsWon: number;
  totalEthWon: string;
  topGuesserPlacements: number;
  topGuesserEthWon: string;
  referralWins: number;
  referralEthWon: string;
  // Milestone 6.3: New stats
  freeGuessesAllTime: number;
  bonusGuessesAllTime: number; // CLANKTON + share bonus
  guessesPerRoundHistogram: { round: number; guesses: number }[];
  medianGuessesToSolve: number | null;
  referralsGeneratedThisRound: number;
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

    // Milestone 9.2: Cache user stats
    const cacheKey = CacheKeys.userStats(fid);
    const response = await cacheAside<UserStatsResponse>(
      cacheKey,
      CacheTTL.userStats,
      async () => {
        // Get current active round
        const [activeRound] = await db
          .select({ id: rounds.id })
          .from(rounds)
          .where(isNull(rounds.resolvedAt))
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

        // Get top guesser placements (count and ETH)
        const topGuesserStats = await db
          .select({
            count: count(),
            total: sql<string>`coalesce(sum(${roundPayouts.amountEth}), '0')`,
          })
          .from(roundPayouts)
          .where(and(eq(roundPayouts.fid, fid), eq(roundPayouts.role, 'top_guesser')));

        const topGuesserPlacements = Number(topGuesserStats[0]?.count || 0);
        const topGuesserEthWon = topGuesserStats[0]?.total || '0';

        // Get referral wins (count and ETH)
        const referralStats = await db
          .select({
            count: count(),
            total: sql<string>`coalesce(sum(${roundPayouts.amountEth}), '0')`,
          })
          .from(roundPayouts)
          .where(and(eq(roundPayouts.fid, fid), eq(roundPayouts.role, 'referrer')));

        const referralWins = Number(referralStats[0]?.count || 0);
        const referralEthWon = referralStats[0]?.total || '0';

        // Milestone 6.3: Calculate new stats

        // Calculate free vs bonus guesses PER DAY based on consumption order
        // Consumption order: free (base) → CLANKTON bonus → share bonus → paid
        // For each day: free_used_from_base = min(base_allocated, free_used)
        //               free_used_from_bonus = free_used - free_used_from_base
        const usageStats = await db
          .select({
            // Per-day: attribute min(base, used) to free, remainder to bonus
            freeFromBase: sql<number>`coalesce(sum(least(${dailyGuessState.freeAllocatedBase}, ${dailyGuessState.freeUsed})), 0)`,
            freeFromBonus: sql<number>`coalesce(sum(greatest(0, ${dailyGuessState.freeUsed} - ${dailyGuessState.freeAllocatedBase})), 0)`,
          })
          .from(dailyGuessState)
          .where(eq(dailyGuessState.fid, fid));

        const freeGuessesAllTime = Number(usageStats[0]?.freeFromBase || 0);
        const bonusGuessesAllTime = Number(usageStats[0]?.freeFromBonus || 0);

        // Guesses per round histogram (last 10 rounds for this user)
        const guessHistogram = await db
          .select({
            roundId: guesses.roundId,
            guessCount: count(),
          })
          .from(guesses)
          .where(eq(guesses.fid, fid))
          .groupBy(guesses.roundId)
          .orderBy(sql`${guesses.roundId} DESC`)
          .limit(10);

        const guessesPerRoundHistogram = guessHistogram.map((h) => ({
          round: h.roundId,
          guesses: Number(h.guessCount),
        }));

        // Median guesses to solve (for rounds this user won)
        let medianGuessesToSolve: number | null = null;
        if (jackpotsWon > 0) {
          // Get guess counts for rounds this user won
          const wonRoundGuesses = await db
            .select({
              roundId: rounds.id,
              guessCount: sql<number>`(
                SELECT count(*)
                FROM ${guesses}
                WHERE ${guesses.roundId} = ${rounds.id}
                AND ${guesses.fid} = ${fid}
              )`,
            })
            .from(rounds)
            .where(eq(rounds.winnerFid, fid))
            .orderBy(sql`(
              SELECT count(*)
              FROM ${guesses}
              WHERE ${guesses.roundId} = ${rounds.id}
              AND ${guesses.fid} = ${fid}
            ) ASC`);

          if (wonRoundGuesses.length > 0) {
            const counts = wonRoundGuesses.map((r) => Number(r.guessCount));
            const mid = Math.floor(counts.length / 2);
            medianGuessesToSolve =
              counts.length % 2 !== 0
                ? counts[mid]
                : Math.floor((counts[mid - 1] + counts[mid]) / 2);
          }
        }

        // Referrals generated this round
        let referralsGeneratedThisRound = 0;
        if (currentRoundId) {
          const referrals = await db
            .select({ count: count() })
            .from(users)
            .where(eq(users.referrerFid, fid));
          referralsGeneratedThisRound = Number(referrals[0]?.count || 0);
        }

        return {
          guessesThisRound,
          guessesAllTime,
          paidGuessesThisRound,
          paidGuessesAllTime,
          jackpotsWon,
          totalEthWon,
          topGuesserPlacements,
          topGuesserEthWon,
          referralWins,
          referralEthWon,
          // Milestone 6.3: New stats
          freeGuessesAllTime,
          bonusGuessesAllTime,
          guessesPerRoundHistogram,
          medianGuessesToSolve,
          referralsGeneratedThisRound,
        };
      }
    );

    console.log(`[user/stats] Stats for FID ${fid}:`, response);

    return res.status(200).json(response);
  } catch (error) {
    console.error('[user/stats] Error fetching user stats:', error);

    // Milestone 9.2: Report to Sentry with context
    Sentry.captureException(error, {
      tags: { endpoint: 'user-stats' },
      extra: {
        fid: req.query?.fid || req.query?.devFid,
      },
    });

    return res.status(500).json({ error: 'Failed to fetch user stats' });
  }
}

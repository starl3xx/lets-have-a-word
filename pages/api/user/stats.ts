/**
 * User Stats API
 * Milestone 4.3
 *
 * Returns per-user gameplay statistics
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
import { db } from '../../../src/db';
import { guesses, rounds, roundPayouts, users, dailyGuessState, roundBonusWords, roundBurnWords, wordRewards } from '../../../src/db/schema';
import { eq, and, sql, count, isNull, isNotNull, inArray } from 'drizzle-orm';
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
  bonusGuessesAllTime: number; // $WORD + share bonus
  guessesPerRoundHistogram: { round: number; guesses: number }[];
  medianGuessesToSolve: number | null;
  referralsGeneratedThisRound: number;
  // Milestone 14: $WORD stats
  bonusWordsFound: number;
  burnWordsFound: number;
  totalWordEarned: string; // Whole tokens (e.g., "15000000" for 15M)
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
        // OPTIMIZATION: Run all independent queries in parallel
        // Previously 10+ sequential queries, now batched into 2 parallel groups

        // First: Get active round (needed for some queries)
        const [activeRound] = await db
          .select({ id: rounds.id })
          .from(rounds)
          .where(isNull(rounds.resolvedAt))
          .limit(1);

        const currentRoundId = activeRound?.id || null;

        // Second: Run all independent queries in parallel
        const [
          allTimeGuessesResult,
          wonRoundsResult,
          payoutsResult,
          topGuesserStatsResult,
          referralStatsResult,
          usageStatsResult,
          guessHistogramResult,
          roundGuessesResult,
          referralsResult,
          bonusWordsResult,
          burnWordsResult,
          wordEarnedResult,
        ] = await Promise.all([
          // All-time guesses
          db
            .select({
              total: count(),
              paid: sql<number>`count(*) filter (where ${guesses.isPaid} = true)`,
            })
            .from(guesses)
            .where(eq(guesses.fid, fid)),

          // Jackpots won
          db
            .select({ count: count() })
            .from(rounds)
            .where(eq(rounds.winnerFid, fid)),

          // Total ETH won from payouts
          db
            .select({
              total: sql<string>`coalesce(sum(${roundPayouts.amountEth}), '0')`,
            })
            .from(roundPayouts)
            .where(eq(roundPayouts.fid, fid)),

          // Top guesser placements
          db
            .select({
              count: count(),
              total: sql<string>`coalesce(sum(${roundPayouts.amountEth}), '0')`,
            })
            .from(roundPayouts)
            .where(and(eq(roundPayouts.fid, fid), eq(roundPayouts.role, 'top_guesser'))),

          // Referral wins
          db
            .select({
              count: count(),
              total: sql<string>`coalesce(sum(${roundPayouts.amountEth}), '0')`,
            })
            .from(roundPayouts)
            .where(and(eq(roundPayouts.fid, fid), eq(roundPayouts.role, 'referrer'))),

          // Free vs bonus usage stats
          db
            .select({
              freeFromBase: sql<number>`coalesce(sum(least(${dailyGuessState.freeAllocatedBase}, ${dailyGuessState.freeUsed})), 0)`,
              freeFromBonus: sql<number>`coalesce(sum(greatest(0, ${dailyGuessState.freeUsed} - ${dailyGuessState.freeAllocatedBase})), 0)`,
            })
            .from(dailyGuessState)
            .where(and(
              eq(dailyGuessState.fid, fid),
              sql`${dailyGuessState.date} >= '2026-01-01'`
            )),

          // Guesses per round histogram
          db
            .select({
              roundId: guesses.roundId,
              guessCount: count(),
            })
            .from(guesses)
            .where(eq(guesses.fid, fid))
            .groupBy(guesses.roundId)
            .orderBy(sql`${guesses.roundId} DESC`)
            .limit(10),

          // This round guesses (conditional)
          currentRoundId
            ? db
                .select({
                  total: count(),
                  paid: sql<number>`count(*) filter (where ${guesses.isPaid} = true)`,
                })
                .from(guesses)
                .where(and(eq(guesses.fid, fid), eq(guesses.roundId, currentRoundId)))
            : Promise.resolve([{ total: 0, paid: 0 }]),

          // Referrals generated (all-time, not just this round)
          db
            .select({ count: count() })
            .from(users)
            .where(eq(users.referrerFid, fid)),

          // Bonus words found
          db
            .select({ count: count() })
            .from(roundBonusWords)
            .where(eq(roundBonusWords.claimedByFid, fid)),

          // Burn words found
          db
            .select({ count: count() })
            .from(roundBurnWords)
            .where(eq(roundBurnWords.finderFid, fid)),

          // Total $WORD earned (top10 + bonus_word + staking; excludes burn which destroys tokens)
          db
            .select({
              total: sql<string>`coalesce(sum(cast(${wordRewards.amount} as numeric)), 0)::text`,
            })
            .from(wordRewards)
            .where(and(
              eq(wordRewards.fid, fid),
              inArray(wordRewards.rewardType, ['bonus_word', 'top10', 'staking']),
            )),
        ]);

        // Extract results
        const guessesAllTime = Number(allTimeGuessesResult[0]?.total || 0);
        const paidGuessesAllTime = Number(allTimeGuessesResult[0]?.paid || 0);
        const jackpotsWon = Number(wonRoundsResult[0]?.count || 0);
        const totalEthWon = payoutsResult[0]?.total || '0';
        const topGuesserPlacements = Number(topGuesserStatsResult[0]?.count || 0);
        const topGuesserEthWon = topGuesserStatsResult[0]?.total || '0';
        const referralWins = Number(referralStatsResult[0]?.count || 0);
        const referralEthWon = referralStatsResult[0]?.total || '0';
        const guessesThisRound = Number(roundGuessesResult[0]?.total || 0);
        const paidGuessesThisRound = Number(roundGuessesResult[0]?.paid || 0);
        const referralsGeneratedThisRound = Number(referralsResult[0]?.count || 0);
        const bonusWordsFound = Number(bonusWordsResult[0]?.count || 0);
        const burnWordsFound = Number(burnWordsResult[0]?.count || 0);
        // Convert wei to whole tokens: divide by 10^18
        const wordEarnedWei = BigInt(wordEarnedResult[0]?.total || '0');
        const totalWordEarned = (wordEarnedWei / 10n ** 18n).toString();

        // Calculate free vs bonus guesses
        const nonPaidGuesses = guessesAllTime - paidGuessesAllTime;
        const rawFreeFromBase = Number(usageStatsResult[0]?.freeFromBase || 0);
        const rawFreeFromBonus = Number(usageStatsResult[0]?.freeFromBonus || 0);
        const freeGuessesAllTime = Math.min(rawFreeFromBase, nonPaidGuesses);
        const bonusGuessesAllTime = Math.min(rawFreeFromBonus, nonPaidGuesses - freeGuessesAllTime);

        const guessesPerRoundHistogram = guessHistogramResult.map((h) => ({
          round: h.roundId,
          guesses: Number(h.guessCount),
        }));

        // Median guesses to solve (only if user has won jackpots)
        let medianGuessesToSolve: number | null = null;
        if (jackpotsWon > 0) {
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
          freeGuessesAllTime,
          bonusGuessesAllTime,
          guessesPerRoundHistogram,
          medianGuessesToSolve,
          referralsGeneratedThisRound,
          bonusWordsFound,
          burnWordsFound,
          totalWordEarned,
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

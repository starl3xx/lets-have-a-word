/**
 * Backfill QUICKDRAW wordmarks for past Top 10 guessers
 *
 * POST: Award QUICKDRAW to all users who placed in Top 10 in past resolved rounds
 * GET: Preview how many users would be awarded
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from '../../me';
import { db, guesses, rounds, userBadges } from '../../../../src/db';
import { eq, isNotNull, sql, asc, desc, or, isNull, lte } from 'drizzle-orm';
import { getTop10LockForRound } from '../../../../src/lib/top10-lock';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Verify admin authentication
  const devFid = req.query.devFid as string;
  if (!devFid || !isAdminFid(parseInt(devFid, 10))) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    // Get all resolved rounds
    const resolvedRounds = await db
      .select({ id: rounds.id, winnerFid: rounds.winnerFid })
      .from(rounds)
      .where(isNotNull(rounds.resolvedAt))
      .orderBy(asc(rounds.id));

    console.log(`[backfill-quickdraw] Found ${resolvedRounds.length} resolved rounds`);

    const toAward: Array<{ fid: number; roundId: number; rank: number }> = [];

    // For each round, find the Top 10 early guessers
    for (const round of resolvedRounds) {
      const top10LockThreshold = getTop10LockForRound(round.id);

      // Get top guessers within the lock window, excluding winner
      const topGuessers = await db
        .select({
          fid: guesses.fid,
          guessCount: sql<number>`cast(count(${guesses.id}) as int)`,
          lastGuessIndex: sql<number>`cast(max(${guesses.guessIndexInRound}) as int)`,
        })
        .from(guesses)
        .where(
          sql`${guesses.roundId} = ${round.id}
              AND (${guesses.guessIndexInRound} <= ${top10LockThreshold} OR ${guesses.guessIndexInRound} IS NULL)`
        )
        .groupBy(guesses.fid)
        .orderBy(desc(sql`count(${guesses.id})`), asc(sql`max(${guesses.guessIndexInRound})`))
        .limit(11); // Get 11 to exclude winner

      // Filter out winner and take top 10
      const top10 = topGuessers
        .filter(g => g.fid !== round.winnerFid)
        .slice(0, 10);

      for (let i = 0; i < top10.length; i++) {
        toAward.push({
          fid: top10[i].fid,
          roundId: round.id,
          rank: i + 1,
        });
      }
    }

    // Deduplicate by FID (only need to award once per user)
    const uniqueFids = new Map<number, { roundId: number; rank: number }>();
    for (const entry of toAward) {
      if (!uniqueFids.has(entry.fid)) {
        uniqueFids.set(entry.fid, { roundId: entry.roundId, rank: entry.rank });
      }
    }

    if (req.method === 'GET') {
      // Preview mode
      return res.status(200).json({
        message: 'Preview - POST to execute backfill',
        resolvedRounds: resolvedRounds.length,
        totalTop10Entries: toAward.length,
        uniqueUsersToAward: uniqueFids.size,
        preview: Array.from(uniqueFids.entries()).slice(0, 20).map(([fid, data]) => ({
          fid,
          firstTop10Round: data.roundId,
          bestRank: data.rank,
        })),
      });
    }

    if (req.method === 'POST') {
      // Execute backfill
      let awarded = 0;
      let alreadyHad = 0;

      for (const [fid, data] of uniqueFids) {
        try {
          const result = await db
            .insert(userBadges)
            .values({
              fid,
              badgeType: 'QUICKDRAW',
              metadata: { roundId: data.roundId, rank: data.rank, backfilled: true },
            })
            .onConflictDoNothing()
            .returning();

          if (result.length > 0) {
            awarded++;
            console.log(`[backfill-quickdraw] ⚡ Awarded QUICKDRAW to FID ${fid} (Round ${data.roundId}, Rank ${data.rank})`);
          } else {
            alreadyHad++;
          }
        } catch (error) {
          console.error(`[backfill-quickdraw] Error awarding to FID ${fid}:`, error);
        }
      }

      console.log(`[backfill-quickdraw] ✅ Complete: ${awarded} awarded, ${alreadyHad} already had`);

      return res.status(200).json({
        success: true,
        resolvedRounds: resolvedRounds.length,
        awarded,
        alreadyHad,
        total: uniqueFids.size,
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('[backfill-quickdraw] Error:', error);
    return res.status(500).json({
      error: 'Failed to backfill QUICKDRAW wordmarks',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

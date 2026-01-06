/**
 * Generate Archive SQL API Endpoint
 *
 * GET /api/admin/generate-archive-sql?roundId=2
 *
 * Generates the raw SQL INSERT statement for manually archiving a round.
 * This is a workaround for Drizzle serialization issues.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from './me';
import { db } from '../../../src/db';
import { rounds, guesses, roundPayouts, users } from '../../../src/db/schema';
import { eq, sql, and, lte, asc, desc } from 'drizzle-orm';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Auth check
    let fid: number | null = null;
    if (req.query.devFid) {
      fid = parseInt(req.query.devFid as string, 10);
    } else if (req.cookies.siwn_fid) {
      fid = parseInt(req.cookies.siwn_fid, 10);
    }

    if (!fid || isNaN(fid)) {
      return res.status(401).json({ error: 'Not authenticated. Add ?devFid=YOUR_FID to the URL.' });
    }

    if (!isAdminFid(fid)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const roundId = parseInt(req.query.roundId as string, 10);
    if (!roundId || isNaN(roundId)) {
      return res.status(400).json({ error: 'roundId query parameter is required' });
    }

    // Get the round
    const [round] = await db.select().from(rounds).where(eq(rounds.id, roundId));
    if (!round) {
      return res.status(404).json({ error: `Round ${roundId} not found` });
    }

    // Get total guesses and unique players
    const [guessStats] = await db.select({
      totalGuesses: sql<number>`COUNT(*)::int`,
      uniquePlayers: sql<number>`COUNT(DISTINCT fid)::int`,
    }).from(guesses).where(eq(guesses.roundId, roundId));

    // Get the winning guess
    const [winningGuess] = await db.select({
      fid: guesses.fid,
      guessIndexInRound: guesses.guessIndexInRound,
    }).from(guesses)
      .where(and(eq(guesses.roundId, roundId), eq(guesses.isCorrect, true)))
      .limit(1);

    // Get payouts from round_payouts table
    const payouts = await db.select().from(roundPayouts).where(eq(roundPayouts.roundId, roundId));

    // Get winner payout
    const winnerPayout = payouts.find(p => p.payoutType === 'winner');

    // Get referrer payout
    const referrerPayout = payouts.find(p => p.payoutType === 'referrer');

    // Get seed payout (for next round)
    const seedPayout = payouts.find(p => p.payoutType === 'seed');

    // Get creator payout
    const creatorPayout = payouts.find(p => p.payoutType === 'creator');

    // Calculate Top 10 based on FIRST 750 guesses only
    // This is the Top 10 lock logic - rankings frozen at guess 750
    const TOP_10_LOCK_THRESHOLD = 750;

    const top10Query = await db.execute(sql`
      WITH first_750 AS (
        SELECT fid, guess_index_in_round, created_at
        FROM guesses
        WHERE round_id = ${roundId}
        ORDER BY COALESCE(guess_index_in_round, 999999) ASC, created_at ASC
        LIMIT ${TOP_10_LOCK_THRESHOLD}
      ),
      guesser_counts AS (
        SELECT
          fid,
          COUNT(*) as guess_count,
          MIN(created_at) as first_guess_at
        FROM first_750
        GROUP BY fid
      )
      SELECT
        fid,
        guess_count,
        first_guess_at
      FROM guesser_counts
      ORDER BY guess_count DESC, first_guess_at ASC
      LIMIT 11
    `);

    // Filter out winner from top 10
    const winnerFid = winningGuess?.fid || round.winnerFid;
    const top10WithoutWinner = (top10Query.rows as any[])
      .filter(row => row.fid !== winnerFid)
      .slice(0, 10);

    // Get top 10 payouts from round_payouts
    const top10Payouts = payouts
      .filter(p => p.payoutType === 'top10')
      .sort((a, b) => (a.rank || 999) - (b.rank || 999));

    // Build topGuessers array with ranks
    const topGuessers = top10WithoutWinner.map((row, index) => ({
      fid: row.fid,
      amountEth: top10Payouts[index]?.amountEth || '0',
      rank: index + 1,
      guessCount: Number(row.guess_count),
    }));

    // Build payouts JSON
    const payoutsJson: any = {
      topGuessers: topGuessers.map(t => ({ fid: t.fid, amountEth: t.amountEth, rank: t.rank })),
    };

    if (winnerPayout && winnerFid) {
      payoutsJson.winner = { fid: winnerFid, amountEth: winnerPayout.amountEth };
    }

    if (referrerPayout && referrerPayout.fid) {
      payoutsJson.referrer = { fid: referrerPayout.fid, amountEth: referrerPayout.amountEth };
    }

    if (seedPayout) {
      payoutsJson.seed = { amountEth: seedPayout.amountEth };
    }

    if (creatorPayout) {
      payoutsJson.creator = { amountEth: creatorPayout.amountEth };
    }

    // Need the target word - must be provided as query param for security
    const targetWord = req.query.targetWord as string;
    if (!targetWord) {
      return res.status(400).json({
        error: 'targetWord query parameter is required',
        note: 'For Round 2, the word is TUCKS'
      });
    }

    // Format timestamps for SQL
    const formatTimestamp = (date: Date | null | undefined): string => {
      if (!date) return 'NULL';
      return `'${date.toISOString()}'`;
    };

    // Build the SQL INSERT statement
    const sqlInsert = `
INSERT INTO round_archive (
  round_number,
  target_word,
  seed_eth,
  final_jackpot_eth,
  total_guesses,
  unique_players,
  winner_fid,
  winner_cast_hash,
  winner_guess_number,
  start_time,
  end_time,
  referrer_fid,
  payouts_json,
  salt,
  commit_hash
) VALUES (
  ${roundId},
  '${targetWord.toUpperCase()}',
  '${round.seedEth || '0'}',
  '${round.prizePoolEth || '0'}',
  ${guessStats.totalGuesses || 0},
  ${guessStats.uniquePlayers || 0},
  ${winnerFid || 'NULL'},
  ${round.announcementCastHash ? `'${round.announcementCastHash}'` : 'NULL'},
  ${winningGuess?.guessIndexInRound || 'NULL'},
  ${formatTimestamp(round.createdAt)},
  ${formatTimestamp(round.resolvedAt)},
  ${referrerPayout?.fid || 'NULL'},
  '${JSON.stringify(payoutsJson).replace(/'/g, "''")}',
  '${round.salt}',
  '${round.commitHash}'
);
    `.trim();

    return res.status(200).json({
      roundId,
      targetWord: targetWord.toUpperCase(),
      stats: {
        totalGuesses: guessStats.totalGuesses,
        uniquePlayers: guessStats.uniquePlayers,
        winnerFid,
        winnerGuessNumber: winningGuess?.guessIndexInRound,
      },
      top10: topGuessers,
      payoutsJson,
      sqlInsert,
      instructions: [
        '1. Review the data above to confirm it looks correct',
        '2. Copy the SQL INSERT statement',
        '3. Run it directly in Neon SQL Editor',
        '4. Verify the archive synced by checking /archive/2',
      ],
    });

  } catch (error) {
    console.error('[generate-archive-sql] Error:', error);
    return res.status(500).json({
      error: 'Failed to generate archive SQL',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

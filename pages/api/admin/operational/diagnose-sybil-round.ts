/**
 * Sybil Round Diagnostic API
 *
 * GET /api/admin/operational/diagnose-sybil-round?devFid=XXX&roundId=N
 * If roundId is omitted, uses the latest resolved round.
 *
 * Returns per-round signals useful for identifying coordinated sybil activity:
 *  - User-quality score distribution of guessers
 *  - Fresh-to-DB FIDs (users.createdAt within round window)
 *  - Winner + Top-10 details (score, first-seen, wallet, username)
 *  - Per-FID guess leaderboard
 *  - Payout recipient summary
 *  - .base.eth username share among guessers
 *  - Guess-rate timeline (per minute)
 *
 * Read-only. Safe to run at any time.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from '../me';
import { db } from '../../../../src/db';
import { rounds, guesses } from '../../../../src/db/schema';
import { desc, eq, isNotNull, sql } from 'drizzle-orm';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const devFid = parseInt(req.query.devFid as string, 10);
  if (!devFid || !isAdminFid(devFid)) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  try {
    // Resolve target round
    let roundId: number;
    if (req.query.roundId) {
      roundId = parseInt(req.query.roundId as string, 10);
      if (!roundId || isNaN(roundId)) {
        return res.status(400).json({ error: 'Invalid roundId' });
      }
    } else {
      const [latest] = await db
        .select({ id: rounds.id })
        .from(rounds)
        .where(isNotNull(rounds.resolvedAt))
        .orderBy(desc(rounds.resolvedAt))
        .limit(1);
      if (!latest) {
        return res.status(404).json({ error: 'No resolved rounds found' });
      }
      roundId = latest.id;
    }

    const [round] = await db.select().from(rounds).where(eq(rounds.id, roundId));
    if (!round) {
      return res.status(404).json({ error: `Round ${roundId} not found` });
    }

    const roundStart = round.startedAt;
    const roundEnd = round.resolvedAt ?? round.cancelledAt ?? new Date();

    // ---- Headline stats ----
    const [headline] = await db
      .select({
        totalGuesses: sql<number>`count(*)::int`,
        uniqueFids: sql<number>`count(distinct ${guesses.fid})::int`,
        paid: sql<number>`count(*) filter (where ${guesses.isPaid})::int`,
        correct: sql<number>`count(*) filter (where ${guesses.isCorrect})::int`,
      })
      .from(guesses)
      .where(eq(guesses.roundId, roundId));

    // ---- User-quality histogram ----
    const scoreBucketsRaw = await db.execute(sql`
      with bucketed as (
        select
          g.fid,
          u.user_score,
          case
            when u.user_score is null then 'null'
            when u.user_score < 0.3 then 'low_under_030'
            when u.user_score < 0.55 then 'below_gate_030_055'
            when u.user_score < 0.8 then 'medium_055_080'
            else 'high_080_plus'
          end as bucket
        from guesses g
        left join users u on u.fid = g.fid
        where g.round_id = ${roundId}
      )
      select
        bucket,
        count(*)::int as guess_count,
        count(distinct fid)::int as fid_count
      from bucketed
      group by bucket
      order by bucket
    `);

    // Drizzle's db.execute returns { rows } on neon/pg driver; normalize
    const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);
    const scoreBuckets = rowsOf(scoreBucketsRaw);

    // ---- Fresh-to-DB users (first-seen inside round window) ----
    const [freshStats] = rowsOf(
      await db.execute(sql`
        select
          count(distinct u.fid)::int as fresh_fids,
          count(g.id)::int as fresh_guesses
        from guesses g
        join users u on u.fid = g.fid
        where g.round_id = ${roundId}
          and u.created_at >= ${roundStart}
          and u.created_at <= ${roundEnd}
      `)
    );

    // ---- .base.eth username share among guessers ----
    const [baseEthStats] = rowsOf(
      await db.execute(sql`
        select
          count(distinct u.fid)::int as base_eth_fids,
          count(g.id)::int as base_eth_guesses
        from guesses g
        join users u on u.fid = g.fid
        where g.round_id = ${roundId}
          and u.username ilike '%.base.eth'
      `)
    );

    // ---- Winner details ----
    let winner: any = null;
    if (round.winnerFid) {
      const [w] = rowsOf(
        await db.execute(sql`
          select
            u.fid,
            u.username,
            u.user_score,
            u.spam_score,
            u.created_at as first_seen,
            u.signer_wallet_address as wallet,
            u.custody_address,
            (select count(*)::int from guesses g where g.round_id = ${roundId} and g.fid = u.fid) as guess_count,
            (select g2.guess_index_in_round from guesses g2
               where g2.round_id = ${roundId} and g2.fid = u.fid and g2.is_correct = true limit 1
            ) as winning_guess_index
          from users u
          where u.fid = ${round.winnerFid}
        `)
      );
      winner = w ?? { fid: round.winnerFid, note: 'User row not found' };
    }

    // ---- Top 10 (by guess_index_in_round) with user fields ----
    const topTen = rowsOf(
      await db.execute(sql`
        select
          g.fid,
          g.guess_index_in_round,
          u.username,
          u.user_score,
          u.spam_score,
          u.created_at as first_seen,
          u.signer_wallet_address as wallet
        from guesses g
        left join users u on u.fid = g.fid
        where g.round_id = ${roundId}
          and g.guess_index_in_round is not null
        order by g.guess_index_in_round asc
        limit 10
      `)
    );

    // ---- Most-active guessers (top 25 by guess count) ----
    // Group by g.fid (not u.fid) so unregistered sybil FIDs each get their own
    // row; grouping by u.fid would collapse all NULL-joined rows into one.
    const topGuessers = rowsOf(
      await db.execute(sql`
        select
          g.fid,
          max(u.username) as username,
          max(u.user_score) as user_score,
          max(u.created_at) as first_seen,
          max(u.signer_wallet_address) as wallet,
          count(g.id)::int as guesses
        from guesses g
        left join users u on u.fid = g.fid
        where g.round_id = ${roundId}
        group by g.fid
        order by guesses desc
        limit 25
      `)
    );

    // ---- Per-minute guess timeline ----
    const timeline = rowsOf(
      await db.execute(sql`
        select
          date_trunc('minute', g.created_at) as minute,
          count(*)::int as guesses,
          count(distinct g.fid)::int as unique_fids
        from guesses g
        where g.round_id = ${roundId}
        group by minute
        order by minute asc
      `)
    );

    // ---- Payout summary ----
    const payouts = rowsOf(
      await db.execute(sql`
        select
          p.role,
          p.fid,
          p.wallet_address,
          p.amount_eth,
          u.username,
          u.user_score,
          u.created_at as user_first_seen
        from round_payouts p
        left join users u on u.fid = p.fid
        where p.round_id = ${roundId}
        order by p.amount_eth desc
      `)
    );

    // ---- New-FID burst detection: clusters of users.createdAt within round ----
    const freshSignupBurstsRaw = rowsOf(
      await db.execute(sql`
        select
          date_trunc('minute', u.created_at) as minute,
          count(*)::int as new_users
        from users u
        where u.created_at >= ${roundStart}
          and u.created_at <= ${roundEnd}
          and exists (select 1 from guesses g where g.round_id = ${roundId} and g.fid = u.fid)
        group by minute
        order by new_users desc
        limit 20
      `)
    );

    return res.status(200).json({
      roundId,
      round: {
        status: round.status,
        startedAt: roundStart,
        resolvedAt: round.resolvedAt,
        cancelledAt: round.cancelledAt,
        winnerFid: round.winnerFid,
        referrerFid: round.referrerFid,
        prizePoolEth: round.prizePoolEth,
        durationSeconds: Math.max(0, Math.floor((roundEnd.getTime() - roundStart.getTime()) / 1000)),
      },
      headline,
      scoreBuckets,
      fresh: {
        ...freshStats,
        pctOfGuesses:
          headline.totalGuesses > 0
            ? +((100 * (freshStats?.fresh_guesses ?? 0)) / headline.totalGuesses).toFixed(1)
            : 0,
      },
      baseEth: {
        ...baseEthStats,
        pctOfGuesses:
          headline.totalGuesses > 0
            ? +((100 * (baseEthStats?.base_eth_guesses ?? 0)) / headline.totalGuesses).toFixed(1)
            : 0,
      },
      winner,
      topTen,
      topGuessers,
      payouts,
      timeline,
      freshSignupBursts: freshSignupBurstsRaw,
      thresholds: {
        minUserScoreGate: 0.55,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[diagnose-sybil-round] Error:', error);
    return res.status(500).json({
      error: 'Failed to diagnose round',
      details: error?.message ?? String(error),
    });
  }
}

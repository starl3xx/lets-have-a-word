/**
 * Farm Monitor API — farm-signature report for a round
 *
 * GET /api/admin/operational/farm-monitor?devFid=XXX[&roundId=N][&enrich=1][&enrichLimit=25]
 * If roundId is omitted, uses the latest round (active included — this is a
 * live monitor first, a backtest tool second).
 *
 * Adds the two signals the older sybil endpoints predate:
 *  - the new-guesser cohort on the MIN(guesses.round_id) basis — the same
 *    basis as the grandfather backfill, and the one that reproduces the
 *    recorded waves (28: 2,949 / 29: 913 / 32: 59 / 33: 1,591, verified
 *    against production 2026-08-15). diagnose-sybil-round's created_at
 *    window misses round 33 entirely (15 of 1,591);
 *  - reward-gate claim wallets and, with enrich=1, who funded them with
 *    $WORD (Blockscout, bounded, read-only).
 *
 * Read-only. Safe to run at any time. See src/lib/farm-monitor.ts for the
 * signature legs and threshold calibration.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from '../me';
import { db } from '../../../../src/db';
import { rounds } from '../../../../src/db/schema';
import { desc, eq, sql } from 'drizzle-orm';
import {
  computeAssessment,
  fetchWordFunders,
  FARM_MONITOR_THRESHOLDS,
} from '../../../../src/lib/farm-monitor';
import { REWARD_GATE_GRANDFATHER_LAST_ROUND } from '../../../../config/economy';

const NEW_GUESSER_LIST_CAP = 100;
const ENRICH_DEFAULT = 25;
const ENRICH_MAX = 50;
const FUNDER_LIST_CAP = 20;
/** A user row older than this at round start is "aged" — the round-32 farm
 * created rows in batches months ahead and activated them together. */
const AGED_ROW_DAYS = 7;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const devFid = parseInt(req.query.devFid as string, 10);
  if (!devFid || !isAdminFid(devFid)) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  try {
    // Resolve target round (latest by id when omitted; the live round matters most)
    const [latest] = await db
      .select({ id: rounds.id })
      .from(rounds)
      .orderBy(desc(rounds.id))
      .limit(1);
    if (!latest) {
      return res.status(404).json({ error: 'No rounds found' });
    }

    let roundId: number;
    if (req.query.roundId) {
      roundId = parseInt(req.query.roundId as string, 10);
      if (!roundId || isNaN(roundId)) {
        return res.status(400).json({ error: 'Invalid roundId' });
      }
    } else {
      roundId = latest.id;
    }

    const [round] = await db.select().from(rounds).where(eq(rounds.id, roundId));
    if (!round) {
      return res.status(404).json({ error: `Round ${roundId} not found` });
    }

    // postgres-js doesn't auto-serialize Date inside drizzle's sql`...`
    // template for db.execute — use ISO strings for raw SQL interpolation.
    const agedCutoffIso = new Date(
      round.startedAt.getTime() - AGED_ROW_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    // Drizzle's db.execute result shape varies by driver; normalize.
    const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);

    // ---- Cohorts ----
    // new guesser: first-ever guess is in this round (MIN(round_id) basis).
    // drive_by: guessed in no other round — reported, never in the verdict
    //   (trivially true for the latest round; false for the round-28 wave,
    //   which continued into 29).
    // aged_row: user row existed >7d before round start — the round-32
    //   activation pattern, visible in the list, not in the verdict.
    const [cohorts] = rowsOf(
      await db.execute(sql`
        with round_guessers as (
          select g.fid, min(g.round_id) as first_round, max(g.round_id) as last_round
          from guesses g
          where g.fid in (select distinct fid from guesses where round_id = ${roundId})
          group by g.fid
        ),
        e as (
          select
            rg.fid,
            u.username,
            (rg.first_round = ${roundId}) as new_guesser,
            (rg.first_round = ${roundId} and rg.last_round = ${roundId}) as drive_by,
            (u.first_guess_round is null
              or u.first_guess_round > ${REWARD_GATE_GRANDFATHER_LAST_ROUND}) as gated,
            (u.created_at < ${agedCutoffIso}::timestamptz) as aged_row,
            (u.username is null
              or u.username like '!%'
              or u.username ~ '^user-?[0-9]+$'
              or u.username ilike '%.base.eth') as suspicious_name
          from round_guessers rg
          left join users u on u.fid = rg.fid
        )
        select
          count(*)::int as guessers,
          count(*) filter (where new_guesser)::int as new_guessers,
          count(*) filter (where new_guesser and suspicious_name)::int as new_suspicious,
          count(*) filter (where new_guesser and drive_by)::int as drive_by,
          count(*) filter (where new_guesser and aged_row)::int as new_aged_rows,
          count(*) filter (where gated)::int as gated_guessers,
          count(*) filter (where not gated)::int as grandfathered_guessers,
          count(*) filter (where username ilike '%.base.eth')::int as base_eth,
          count(*) filter (where username like '!%'
            or username ~ '^user-?[0-9]+$')::int as placeholder,
          count(*) filter (where username is null)::int as no_username
        from e
      `)
    );

    // ---- New-guesser list (human review; batches show in created_at) ----
    const newGuesserList = rowsOf(
      await db.execute(sql`
        with span as (
          select g.fid, min(g.round_id) as first_round, max(g.round_id) as last_round,
                 count(*) filter (where g.round_id = ${roundId})::int as round_guesses
          from guesses g
          where g.fid in (select distinct fid from guesses where round_id = ${roundId})
          group by g.fid
        )
        select
          s.fid,
          u.username,
          u.user_score::float as user_score,
          u.created_at,
          s.round_guesses as guess_count,
          (s.last_round = ${roundId}) as only_this_round,
          (u.created_at < ${agedCutoffIso}::timestamptz) as aged_row
        from span s
        left join users u on u.fid = s.fid
        where s.first_round = ${roundId}
        order by u.created_at asc
        limit ${NEW_GUESSER_LIST_CAP}
      `)
    );

    // ---- Reward-gate claims for this round (empty for ETH-era rounds) ----
    const [claimStats] = rowsOf(
      await db.execute(sql`
        select
          count(*)::int as claims,
          count(distinct wallet)::int as distinct_wallets
        from reward_gate_claims
        where round_id = ${roundId}
      `)
    );
    const claimCount: number = claimStats?.claims ?? 0;

    // ---- Funding enrichment (opt-in: one Blockscout call per wallet) ----
    // Wallet set: claim wallets of gated guessers — the surface the reward
    // gate creates, and the only leg that sees the round-32 class.
    let funding: any = null;
    if (req.query.enrich === '1' && claimCount > 0) {
      const enrichLimit = Math.min(
        parseInt((req.query.enrichLimit as string) ?? '', 10) || ENRICH_DEFAULT,
        ENRICH_MAX
      );

      // One row per WALLET — a wallet claimed by different FIDs on
      // different game-days must count once toward fan-out, not once per FID.
      const walletRows: { wallet: string; fids: number[] }[] = rowsOf(
        await db.execute(sql`
          select c.wallet, array_agg(distinct c.fid) as fids
          from reward_gate_claims c
          join users u on u.fid = c.fid
          where c.round_id = ${roundId}
            and (u.first_guess_round is null
              or u.first_guess_round > ${REWARD_GATE_GRANDFATHER_LAST_ROUND})
          group by c.wallet
          order by c.wallet
          limit ${enrichLimit}
        `)
      ).map((r: any) => ({ wallet: r.wallet, fids: r.fids ?? [] }));

      const funderMap = new Map<string, { wallets: Set<string>; fids: Set<number> }>();
      let unverified = 0;
      // Sequential with a small gap — Blockscout throttles bursts.
      for (const { wallet, fids } of walletRows) {
        const result = await fetchWordFunders(wallet);
        if (!result.verified) unverified++;
        for (const sender of result.senders) {
          const entry = funderMap.get(sender) ?? { wallets: new Set(), fids: new Set() };
          entry.wallets.add(wallet);
          for (const f of fids) entry.fids.add(f);
          funderMap.set(sender, entry);
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      const funders = [...funderMap.entries()]
        .map(([sender, entry]) => ({
          sender,
          walletsFunded: entry.wallets.size,
          fids: [...entry.fids],
        }))
        .filter((f) => f.walletsFunded >= 2)
        .sort((a, b) => b.walletsFunded - a.walletsFunded)
        .slice(0, FUNDER_LIST_CAP);

      funding = {
        walletsChecked: walletRows.length,
        walletsUnverified: unverified,
        funders,
        note:
          'A DEX pool, a prize payout, or the staking contract fans out to ' +
          'organic wallets too. The farm signature is one plain wallet ' +
          'funding many claim wallets — check the sender before acting.',
      };
    }

    // Enrichment that ran but verified nothing is NOT a trace — every
    // Blockscout lookup failing must not read as "no shared funder".
    const enrichmentFailed =
      funding !== null &&
      funding.walletsChecked > 0 &&
      funding.walletsUnverified === funding.walletsChecked;
    if (funding !== null) {
      funding.traceFailed = enrichmentFailed;
    }
    const signals = {
      newGuessers: cohorts?.new_guessers ?? 0,
      newGuessersSuspicious: cohorts?.new_suspicious ?? 0,
      topFunderFanout: funding?.funders?.[0]?.walletsFunded ?? 0,
      fundingUntraced: funding === null && claimCount > 0,
      fundingTraceFailed: enrichmentFailed,
    };
    const assessment = computeAssessment(signals);

    return res.status(200).json({
      round: {
        id: round.id,
        status: round.status,
        prizeCurrency: round.prizeCurrency,
        startedAt: round.startedAt,
        resolvedAt: round.resolvedAt,
        winnerFid: round.winnerFid,
        isLatest: roundId === latest.id,
      },
      definitions: {
        newGuesser: 'first-ever guess is in this round (MIN(guesses.round_id) basis)',
        driveBy:
          'guessed in no other round — data only, not in the verdict ' +
          '(trivially true for the latest round)',
        suspiciousName:
          'no username, !-prefixed or user-<fid>/user<fid> placeholder, or .base.eth',
        agedRow: `user row created more than ${AGED_ROW_DAYS} days before round start`,
        gated: `first_guess_round NULL or > ${REWARD_GATE_GRANDFATHER_LAST_ROUND}`,
      },
      cohorts: {
        guessers: cohorts?.guessers ?? 0,
        newGuessers: cohorts?.new_guessers ?? 0,
        newGuessersSuspicious: cohorts?.new_suspicious ?? 0,
        driveBy: cohorts?.drive_by ?? 0,
        newAgedRows: cohorts?.new_aged_rows ?? 0,
        gatedGuessers: cohorts?.gated_guessers ?? 0,
        grandfatheredGuessers: cohorts?.grandfathered_guessers ?? 0,
        usernames: {
          baseEth: cohorts?.base_eth ?? 0,
          placeholder: cohorts?.placeholder ?? 0,
          none: cohorts?.no_username ?? 0,
        },
      },
      gate: {
        claims: claimCount,
        distinctClaimWallets: claimStats?.distinct_wallets ?? 0,
      },
      newGuesserList: newGuesserList.map((s: any) => ({
        fid: s.fid,
        username: s.username,
        userScore: s.user_score,
        createdAt: s.created_at,
        guessCount: s.guess_count,
        onlyThisRound: s.only_this_round,
        agedRow: s.aged_row,
      })),
      newGuesserListCap: NEW_GUESSER_LIST_CAP,
      funding,
      assessment: { ...assessment, signals, thresholds: FARM_MONITOR_THRESHOLDS },
      generatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[farm-monitor] Error:', error);
    return res
      .status(500)
      .json({ error: 'Failed to build farm monitor report', details: error?.message ?? String(error) });
  }
}

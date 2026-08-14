import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from '../me';
import { db } from '../../../../src/db';
import { sql } from 'drizzle-orm';

/**
 * Cohort Engagement Comparison (admin-only)
 *
 * GET /api/admin/operational/cohort-engagement?devFid=XXX
 *   ?minCohort=5        cluster size that defines "clustered" (default 5)
 *   ?scoreMax=0.70      score below which the gate would consider a user
 *
 * Settles the question the cluster gate cannot answer about itself: **is it
 * catching a farm, or is it catching ordinary players?**
 *
 * The dry run says the gate would block ~192 of 500 low-score clustered
 * accounts, and that only ~5% of them have ever shared or bought anything. On
 * its own that number means nothing. A 5% engagement rate is damning if the
 * rest of the player base sits at 60%, and meaningless if the rest sits at 5%
 * too — sharing might simply be rare.
 *
 * So this reports the same engagement measures for four cohorts side by side:
 *
 *   all          every account that has ever guessed — the baseline
 *   clustered    in a cluster of >= minCohort
 *   lowScore     score < scoreMax
 *   wouldBlock   both, i.e. roughly what the gate acts on
 *
 * If wouldBlock looks like `all` on engagement, the gate is picking up normal
 * players who happened to onboard in a busy hour. If it looks nothing like it,
 * the gate is finding something real and the 192 is closer to correct than my
 * earlier reading suggested.
 *
 * APPROXIMATION, stated plainly: cluster size here is a fixed hour-bucket
 * count, not the sliding ±1h window `checkWalletCluster` computes. Doing it
 * exactly needs a per-user correlated count over ~14k users, which is not
 * something to run against production for a cohort summary. Bucketing puts
 * users near a boundary in the wrong group, so treat these as cohort-level
 * proportions rather than per-user verdicts — for a verdict on one account,
 * use cluster-gate-dry-run, which calls the real gate.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const devFid = parseInt(req.query.devFid as string, 10);
  if (!devFid || !isAdminFid(devFid)) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const minCohort = Math.max(2, Math.min(1000, parseInt(req.query.minCohort as string, 10) || 5));
  const scoreMax = Math.max(0, Math.min(1, parseFloat(req.query.scoreMax as string) || 0.7));

  try {
    const result = await db.execute(sql`
      WITH bucketed AS (
        SELECT
          fid,
          user_score,
          floor(extract(epoch from wallet_first_tx_at) / 3600) AS bucket
        FROM users
        WHERE wallet_first_tx_at IS NOT NULL
      ),
      bucket_sizes AS (
        SELECT bucket, COUNT(*) AS cluster_size
        FROM bucketed
        GROUP BY bucket
      ),
      players AS (
        -- Only accounts that have actually played. Registered-but-never-guessed
        -- accounts would drag every engagement rate toward zero in all four
        -- cohorts and tell us nothing about the difference between them.
        SELECT DISTINCT fid FROM guesses
      ),
      enriched AS (
        SELECT
          p.fid,
          b.user_score,
          COALESCE(bs.cluster_size, 0) AS cluster_size,
          EXISTS (
            SELECT 1 FROM daily_guess_state d
            WHERE d.fid = p.fid AND d.has_shared_today IS TRUE
          ) AS ever_shared,
          EXISTS (
            SELECT 1 FROM pack_purchases pp WHERE pp.fid = p.fid
          ) AS ever_purchased,
          (SELECT COUNT(*) FROM guesses g WHERE g.fid = p.fid) AS guess_count,
          (SELECT COUNT(DISTINCT g.round_id) FROM guesses g WHERE g.fid = p.fid) AS rounds_played
        FROM players p
        LEFT JOIN bucketed b ON b.fid = p.fid
        LEFT JOIN bucket_sizes bs ON bs.bucket = b.bucket
      ),
      labelled AS (
        SELECT
          *,
          (cluster_size >= ${minCohort}) AS is_clustered,
          (user_score IS NOT NULL AND CAST(user_score AS DECIMAL) < ${scoreMax}) AS is_low_score
        FROM enriched
      )
      SELECT
        cohort,
        COUNT(*) AS players,
        ROUND(100.0 * AVG(CASE WHEN ever_shared THEN 1 ELSE 0 END), 1) AS pct_ever_shared,
        ROUND(100.0 * AVG(CASE WHEN ever_purchased THEN 1 ELSE 0 END), 1) AS pct_ever_purchased,
        ROUND(AVG(guess_count), 1) AS avg_guesses,
        ROUND(AVG(rounds_played), 2) AS avg_rounds,
        ROUND(AVG(CAST(user_score AS DECIMAL)), 3) AS avg_score
      FROM (
        SELECT 'all' AS cohort, * FROM labelled
        UNION ALL SELECT 'clustered', * FROM labelled WHERE is_clustered
        UNION ALL SELECT 'lowScore', * FROM labelled WHERE is_low_score
        UNION ALL SELECT 'wouldBlock', * FROM labelled WHERE is_clustered AND is_low_score
      ) x
      GROUP BY cohort
      ORDER BY cohort
    `);

    const rows = Array.isArray(result) ? result : (result as any)?.rows ?? [];

    const cohorts = rows.map((r: any) => ({
      cohort: r.cohort,
      players: Number(r.players),
      pctEverShared: Number(r.pct_ever_shared),
      pctEverPurchased: Number(r.pct_ever_purchased),
      avgGuesses: Number(r.avg_guesses),
      avgRounds: Number(r.avg_rounds),
      avgScore: r.avg_score === null ? null : Number(r.avg_score),
    }));

    const all = cohorts.find((c: any) => c.cohort === 'all');
    const blocked = cohorts.find((c: any) => c.cohort === 'wouldBlock');

    return res.status(200).json({
      params: { minCohort, scoreMax },
      cohorts,
      readMe:
        all && blocked
          ? `Baseline: ${all.pctEverShared}% of players have ever shared and ` +
            `${all.pctEverPurchased}% have ever purchased. The cohort the gate would ` +
            `block sits at ${blocked.pctEverShared}% and ${blocked.pctEverPurchased}%. ` +
            `If those are close, the gate is catching ordinary players. If the blocked ` +
            `cohort is far lower, it is finding something the rest of the base does not do.`
          : 'Not enough data to compare.',
      caveat:
        'Cluster size here is a fixed hour-bucket count, not the sliding ±1h window the ' +
        'gate computes, so users near a bucket boundary land in the wrong group. Cohort-level ' +
        'proportions are reliable; per-user verdicts are not. Use cluster-gate-dry-run for those.',
      generatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[cohort-engagement] Error:', error);
    return res.status(500).json({
      error: 'Failed to build cohort comparison',
      details: error?.message ?? String(error),
    });
  }
}

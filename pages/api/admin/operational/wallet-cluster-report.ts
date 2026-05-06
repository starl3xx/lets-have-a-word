/**
 * Wallet Cluster Report (admin-only)
 *
 * GET /api/admin/operational/wallet-cluster-report?devFid=XXX
 *   ?windowHours=1
 *   ?minSize=5
 *
 * Lists wallet first-tx clusters detected across the LHAW user base —
 * groups of users whose wallets first hit Base within ±windowHours of
 * each other, and contain at least minSize members.
 *
 * Read-only. Used to:
 * - Audit any active gating decisions (the 27 R28/R29 bots show up here)
 * - Surface earlier sybil waves (e.g. the 9-wallet 2025-09-14 cluster
 *   discovered in the broader sample analysis)
 * - Sanity-check that legit cohorts aren't accidentally clustering
 *
 * The report's purpose is operator-facing review only — it does NOT
 * trigger any automatic action. Pair with the existing diagnose-sybil-
 * round endpoint when investigating a specific round.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from '../me';
import { db } from '../../../../src/db';
import { sql } from 'drizzle-orm';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const devFid = parseInt(req.query.devFid as string, 10);
  if (!devFid || !isAdminFid(devFid)) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const windowHours = Math.max(0.25, Math.min(24, parseFloat(req.query.windowHours as string) || 1));
  const minSize = Math.max(2, Math.min(100, parseInt(req.query.minSize as string, 10) || 5));

  try {
    // Bucket users by floor(wallet_first_tx_at / windowHours). Two adjacent
    // buckets together cover the full ±windowHours window for any user inside
    // them, but for a quick "find dense windows" view, single-bucket grouping
    // is enough. Simplification: group by hour-aligned bucket of size
    // windowHours and list those with count >= minSize.
    //
    // The bucket math: floor(epoch / (windowHours * 3600)) gives a unique
    // integer per window. We GROUP BY that to get cluster candidates.
    const result = await db.execute(sql`
      WITH bucketed AS (
        SELECT
          fid,
          username,
          user_score,
          signer_wallet_address AS wallet,
          wallet_first_tx_at,
          floor(extract(epoch from wallet_first_tx_at) / (${windowHours} * 3600)) AS bucket
        FROM users
        WHERE wallet_first_tx_at IS NOT NULL
      ),
      clusters AS (
        SELECT
          bucket,
          MIN(wallet_first_tx_at) AS window_start,
          MAX(wallet_first_tx_at) AS window_end,
          COUNT(*) AS cluster_size,
          COUNT(*) FILTER (WHERE username ILIKE '%.base.eth') AS base_eth_count,
          COUNT(*) FILTER (WHERE username LIKE '!%') AS placeholder_count,
          ROUND(AVG(CAST(user_score AS DECIMAL)), 3) AS avg_score
        FROM bucketed
        GROUP BY bucket
        HAVING COUNT(*) >= ${minSize}
      )
      SELECT *
      FROM clusters
      ORDER BY cluster_size DESC, window_start ASC
      LIMIT 50
    `);
    const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);
    const clusters = rowsOf(result);

    // For the largest 5 clusters, fetch sample members for the response.
    const sampleClusters = await Promise.all(
      clusters.slice(0, 5).map(async (c: any) => {
        const members = await db.execute(sql`
          SELECT fid, username, user_score, signer_wallet_address AS wallet, wallet_first_tx_at
          FROM users
          WHERE wallet_first_tx_at IS NOT NULL
            AND floor(extract(epoch from wallet_first_tx_at) / (${windowHours} * 3600)) = ${c.bucket}
          ORDER BY wallet_first_tx_at ASC
          LIMIT 30
        `);
        return {
          window_start: c.window_start,
          window_end: c.window_end,
          cluster_size: Number(c.cluster_size),
          base_eth_count: Number(c.base_eth_count),
          placeholder_count: Number(c.placeholder_count),
          avg_score: c.avg_score,
          members: rowsOf(members),
        };
      })
    );

    return res.status(200).json({
      params: { windowHours, minSize },
      totalClustersDetected: clusters.length,
      clusters: clusters.map((c: any) => ({
        window_start: c.window_start,
        window_end: c.window_end,
        cluster_size: Number(c.cluster_size),
        base_eth_count: Number(c.base_eth_count),
        placeholder_count: Number(c.placeholder_count),
        avg_score: c.avg_score,
      })),
      sampleClusters,
      note: 'Read-only report. Clusters listed here are candidates for review — being in a cluster does not by itself imply sybil. The active gate uses .base.eth + cluster_size >= MIN_COHORT + score < SCORE_MAX as a compound signal.',
      generatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[wallet-cluster-report] Error:', error);
    return res.status(500).json({
      error: 'Failed to generate cluster report',
      details: error?.message ?? String(error),
    });
  }
}

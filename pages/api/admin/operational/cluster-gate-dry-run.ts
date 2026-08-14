/**
 * Wallet-Cluster Gate Dry Run (admin-only)
 *
 * GET /api/admin/operational/cluster-gate-dry-run?devFid=XXX
 *   ?limit=500          how many candidates to evaluate (default 200, max 2000)
 *
 * Answers the question you want answered before switching
 * WALLET_CLUSTER_GATING_ENABLED on: **who would this actually block?**
 *
 * The existing wallet-cluster-report shows clusters — groups of users whose
 * wallets first transacted around the same time. That is not the same thing.
 * The gate blocks on a compound condition (low score AND cluster size AND no
 * attestation), so a big cluster of high-score players is not a block, and a
 * cluster full of verified users is not a block either. Reading cluster sizes
 * and inferring the gate's behaviour from them overestimates the damage in one
 * direction and misses exemptions in the other.
 *
 * So this calls `checkWalletCluster` itself — the same function the guess path
 * calls — rather than reimplementing its rules. A dry run that can disagree
 * with the real gate is worse than no dry run, because it would be trusted.
 *
 * Read-only with respect to gating: nobody is blocked and no guess is
 * consumed. It does warm the same caches the gate warms (cluster size,
 * attestation result), which is a side effect worth having — the first real
 * player through the gate then pays no RPC cost.
 *
 * Candidates are narrowed to users who could plausibly be blocked (a wallet, a
 * resolved first-tx, and a score below the threshold), because every other
 * user fails open before any expensive check. That keeps a full sweep cheap
 * without changing any verdict.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from '../me';
import { db } from '../../../../src/db';
import { users } from '../../../../src/db/schema';
import { and, asc, isNotNull, lt, sql } from 'drizzle-orm';
import { checkWalletCluster } from '../../../../src/lib/wallet-cluster';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const devFid = parseInt(req.query.devFid as string, 10);
  if (!devFid || !isAdminFid(devFid)) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const limit = Math.max(1, Math.min(2000, parseInt(req.query.limit as string, 10) || 200));
  const scoreMax = parseFloat(process.env.WALLET_CLUSTER_SCORE_MAX || '0.70');

  try {
    // Only users who could possibly be blocked. Everyone else — no wallet, no
    // Base history, no score on file, or a score at or above the threshold —
    // exits the gate early and passes regardless of cluster size.
    const candidates = await db
      .select({
        fid: users.fid,
        username: users.username,
        score: users.userScore,
        clusterSize: users.walletClusterSize,
      })
      .from(users)
      .where(
        and(
          isNotNull(users.signerWalletAddress),
          isNotNull(users.walletFirstTxAt),
          isNotNull(users.userScore),
          lt(sql`cast(${users.userScore} as decimal)`, sql`${scoreMax}`)
        )
      )
      // Deterministic, so two runs compare the same population. Without it
      // Postgres may return a different `limit` rows each time and a
      // before/after reads as a change when it is just a different sample.
      .orderBy(asc(users.fid))
      .limit(limit);

    const wouldBlock: Array<Record<string, unknown>> = [];
    const exemptedByAttestation: Array<Record<string, unknown>> = [];
    const exemptedByPurchase: Array<Record<string, unknown>> = [];
    const exemptedByShare: Array<Record<string, unknown>> = [];
    let evaluated = 0;

    // Sequential on purpose. Each miss can cost a Blockscout page and an RPC
    // round trip, and hammering either from an admin report is how you get
    // rate-limited into misclassifying real users as having no history.
    for (const candidate of candidates) {
      const result = await checkWalletCluster(candidate.fid);
      evaluated++;

      const row = {
        fid: candidate.fid,
        username: candidate.username,
        score: candidate.score,
        clusterSize: result.clusterSize,
        reason: result.reason,
      };

      if (!result.eligible) {
        wouldBlock.push(row);
      } else if (result.bypassedByPurchase) {
        exemptedByPurchase.push(row);
      } else if (result.bypassedByShare) {
        exemptedByShare.push(row);
      } else if (result.bypassedByAttestation) {
        exemptedByAttestation.push(row);
      }
    }

    const gateEnabled = process.env.WALLET_CLUSTER_GATING_ENABLED === 'true';
    const bypassEnabled = process.env.WALLET_CLUSTER_ATTESTATION_BYPASS !== 'false';
    const purchaseBypassEnabled = process.env.WALLET_CLUSTER_PURCHASE_BYPASS !== 'false';
    const shareBypassEnabled = process.env.WALLET_CLUSTER_SHARE_BYPASS !== 'false';

    return res.status(200).json({
      config: {
        gateEnabled,
        attestationBypassEnabled: bypassEnabled,
        purchaseBypassEnabled,
        shareBypassEnabled,
        minCohort: parseInt(process.env.WALLET_CLUSTER_MIN_COHORT || '5', 10),
        windowHours: parseFloat(process.env.WALLET_CLUSTER_WINDOW_HOURS || '1'),
        scoreMax,
        requireBaseEth: process.env.WALLET_CLUSTER_REQUIRE_BASE_ETH === 'true',
      },
      summary: {
        candidatesEvaluated: evaluated,
        candidateLimit: limit,
        truncated: candidates.length === limit,
        wouldBlock: wouldBlock.length,
        exemptedByPurchase: exemptedByPurchase.length,
        exemptedByShare: exemptedByShare.length,
        exemptedByAttestation: exemptedByAttestation.length,
      },
      wouldBlock,
      exemptedByPurchase,
      exemptedByShare,
      exemptedByAttestation,
      note:
        gateEnabled
          ? 'The gate is ENABLED. Every user in wouldBlock is currently unable to guess.'
          : 'The gate is disabled, so this is a preview only — nobody is being blocked.',
      caveat:
        'Candidates are pre-filtered to users with a wallet, a resolved Base first-tx, and a ' +
        'score below scoreMax. Users outside that set exit the gate early and always pass, so ' +
        'they cannot appear here. Verdicts come from checkWalletCluster itself, not a copy of ' +
        'its rules.',
      generatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[cluster-gate-dry-run] Error:', error);
    return res.status(500).json({
      error: 'Failed to run dry run',
      details: error?.message ?? String(error),
    });
  }
}

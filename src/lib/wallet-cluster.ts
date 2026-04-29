/**
 * Wallet-Cluster Gating (post-Round-29 sybil defense, third layer)
 *
 * Catches the specific R28/R29 farm fingerprint: 22 `.base.eth` wallets
 * deployed within a 3-hour window on 2026-03-15, then 5 more on 2026-03-18.
 * Real LHAW player wallets sit alone or in pairs by deployment timestamp;
 * coordinated mint clusters of ≥5 are exclusively bot-shaped per the
 * empirical sample of 168 wallets across rounds 1–25.
 *
 * Why this signal works where simpler ones don't:
 * - tx_count: useless for Coinbase Smart Wallets (ERC-4337 hides activity)
 * - wallet age alone: bots aged their wallets 5+ weeks before attacking
 * - FID age alone: same reason
 *
 * The "co-mint cluster" is harder to forge — an attacker would have to
 * stagger wallet deployments over hours-to-days each, which 10x's the
 * operational cost of the farm. The .base.eth filter scopes the signal to
 * Coinbase Wallet flow users (who SHOULD have Base activity), so pure
 * Farcaster/Warpcast users with zero Base txs aren't affected.
 */
import * as Sentry from '@sentry/nextjs';
import { db } from '../db';
import { users } from '../db/schema';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { logAnalyticsEvent } from './analytics';

export const WALLET_IN_BOT_CLUSTER_ERROR = 'WALLET_IN_BOT_CLUSTER';

const DEFAULT_MIN_COHORT = 5;
const DEFAULT_WINDOW_HOURS = 1;
const DEFAULT_SCORE_MAX = 0.70;
const BLOCKSCOUT_TIMEOUT_MS = 5000;
const RETRY_COOLDOWN_MS = 6 * 60 * 60 * 1000;

function getMinCohort(): number {
  const raw = process.env.WALLET_CLUSTER_MIN_COHORT;
  if (!raw) return DEFAULT_MIN_COHORT;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MIN_COHORT;
}

function getWindowHours(): number {
  const raw = process.env.WALLET_CLUSTER_WINDOW_HOURS;
  if (!raw) return DEFAULT_WINDOW_HOURS;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_WINDOW_HOURS;
}

function getScoreMax(): number {
  const raw = process.env.WALLET_CLUSTER_SCORE_MAX;
  if (!raw) return DEFAULT_SCORE_MAX;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : DEFAULT_SCORE_MAX;
}

function getAllowlist(): Set<number> {
  const raw = process.env.WALLET_CLUSTER_ALLOWLIST || '';
  if (!raw.trim()) return new Set();
  return new Set(
    raw.split(',').map((f) => parseInt(f.trim(), 10)).filter((f) => !Number.isNaN(f))
  );
}

function getBlockscoutBase(): string {
  return (process.env.BASE_BLOCKSCOUT_URL || 'https://base.blockscout.com').replace(/\/$/, '');
}

export interface WalletClusterCheckResult {
  eligible: boolean;
  walletFirstTxAt: Date | null;
  clusterSize: number | null;
  reason?: string;
  errorCode?: string;
}

/**
 * Walk Blockscout pages descending to find the wallet's earliest tx.
 * Returns null on error or no-history. Caps pagination so a high-activity
 * wallet doesn't block the gate — for our purposes, "first tx is older
 * than what we can see in the first 5 pages" is well-aged enough.
 */
async function fetchWalletFirstTx(wallet: string, maxPages = 5): Promise<Date | null> {
  const baseUrl = getBlockscoutBase();
  let url = `${baseUrl}/api/v2/addresses/${wallet}/transactions`;
  let oldest: string | null = null;

  for (let i = 0; i < maxPages; i++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), BLOCKSCOUT_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) {
        Sentry.captureMessage('[WalletCluster] Blockscout non-200', {
          level: 'warning',
          tags: { component: 'wallet-cluster', failure: 'http_error' },
          extra: { wallet, status: response.status, page: i },
        });
        return oldest ? new Date(oldest) : null;
      }

      const body = (await response.json()) as {
        items?: Array<{ timestamp?: string }>;
        next_page_params?: Record<string, string | number> | null;
      };

      const items = body.items ?? [];
      if (items.length === 0) break;

      // Blockscout returns DESC; oldest in this page is at the end.
      const last = items[items.length - 1].timestamp;
      if (last) oldest = last;

      const npp = body.next_page_params;
      if (!npp) break;
      const qs = new URLSearchParams(
        Object.entries(npp).map(([k, v]) => [k, String(v)])
      ).toString();
      url = `${baseUrl}/api/v2/addresses/${wallet}/transactions?${qs}`;
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        Sentry.captureMessage('[WalletCluster] Blockscout timeout', {
          level: 'warning',
          tags: { component: 'wallet-cluster', failure: 'timeout' },
          extra: { wallet, page: i, timeoutMs: BLOCKSCOUT_TIMEOUT_MS },
        });
      } else {
        Sentry.captureException(err, {
          tags: { component: 'wallet-cluster', failure: 'exception' },
          extra: { wallet, page: i },
        });
      }
      return oldest ? new Date(oldest) : null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return oldest ? new Date(oldest) : null;
}

/**
 * Count how many other LHAW users have wallet_first_tx_at within ±windowHours
 * of the given timestamp. Indexed query, cheap.
 */
async function computeClusterSize(timestamp: Date, windowHours: number): Promise<number> {
  const windowMs = windowHours * 60 * 60 * 1000;
  const lo = new Date(timestamp.getTime() - windowMs);
  const hi = new Date(timestamp.getTime() + windowMs);

  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(
      and(
        isNotNull(users.walletFirstTxAt),
        sql`${users.walletFirstTxAt} >= ${lo.toISOString()}::timestamptz`,
        sql`${users.walletFirstTxAt} <= ${hi.toISOString()}::timestamptz`
      )
    );
  return Number(result[0]?.count ?? 0);
}

/**
 * Check whether a FID's wallet matches the bot-cluster fingerprint.
 *
 * Eligibility conditions (block ONLY if all are true):
 * 1. username matches `*.base.eth`
 * 2. user_score < scoreMax (default 0.70)
 * 3. wallet_first_tx_at clusters with ≥minCohort other LHAW wallets
 *
 * Anyone who fails ANY of those filters passes the gate. In particular:
 * - High-score users (≥ 0.70) pass automatically
 * - Non-`.base.eth` users (Warpcast, custom usernames) pass
 * - Solo wallets (cluster size 1–4) pass
 *
 * Fail-open on Blockscout errors with Sentry alert. RPC outages should
 * not lock users out.
 */
export async function checkWalletCluster(
  fid: number,
  forceRefresh = false
): Promise<WalletClusterCheckResult> {
  const allowlist = getAllowlist();
  if (allowlist.has(fid)) {
    return { eligible: true, walletFirstTxAt: null, clusterSize: null, reason: 'Allowlisted FID' };
  }

  const [user] = await db
    .select({
      wallet: users.signerWalletAddress,
      username: users.username,
      score: users.userScore,
      walletFirstTxAt: users.walletFirstTxAt,
      walletFirstTxCheckedAt: users.walletFirstTxCheckedAt,
      walletClusterSize: users.walletClusterSize,
    })
    .from(users)
    .where(eq(users.fid, fid))
    .limit(1);

  if (!user) {
    return { eligible: true, walletFirstTxAt: null, clusterSize: null, reason: 'No user record' };
  }

  // Filter 1: only Coinbase-flow users are subject to this gate.
  if (!user.username || !user.username.toLowerCase().endsWith('.base.eth')) {
    return { eligible: true, walletFirstTxAt: null, clusterSize: null, reason: 'Not a .base.eth user' };
  }

  // Filter 2: high-score users bypass.
  const score = user.score ? parseFloat(user.score) : null;
  const scoreMax = getScoreMax();
  if (score !== null && score >= scoreMax) {
    return {
      eligible: true,
      walletFirstTxAt: user.walletFirstTxAt ?? null,
      clusterSize: user.walletClusterSize ?? null,
      reason: `score ${score} >= ${scoreMax}`,
    };
  }

  // Need a wallet to look up cluster.
  if (!user.wallet) {
    return { eligible: true, walletFirstTxAt: null, clusterSize: null, reason: 'No wallet on file' };
  }

  // Resolve wallet_first_tx_at (immutable once resolved).
  let firstTx: Date | null = user.walletFirstTxAt ?? null;

  if (!firstTx) {
    const checkedAt = user.walletFirstTxCheckedAt;
    const cooledDown =
      !forceRefresh &&
      checkedAt &&
      Date.now() - checkedAt.getTime() < RETRY_COOLDOWN_MS;

    if (!cooledDown) {
      try {
        const fetched = await fetchWalletFirstTx(user.wallet);
        await db
          .update(users)
          .set({
            walletFirstTxAt: fetched ?? undefined,
            walletFirstTxCheckedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(users.fid, fid));
        firstTx = fetched;
      } catch (err) {
        Sentry.captureException(err, {
          tags: { component: 'wallet-cluster', operation: 'resolve_first_tx' },
          extra: { fid, wallet: user.wallet },
        });
        // Fail open
        return {
          eligible: true,
          walletFirstTxAt: null,
          clusterSize: null,
          reason: 'Blockscout error — allowing access',
        };
      }
    }
  }

  if (!firstTx) {
    // No Base activity at all → the wallet-cluster signal doesn't apply.
    // (A pure Farcaster/Warpcast user wouldn't reach here because they'd
    // fail the `.base.eth` filter; if a `.base.eth` user has zero Base
    // activity that's anomalous in itself, but blocking on absence is
    // unreliable — fail open and let other gates decide.)
    return { eligible: true, walletFirstTxAt: null, clusterSize: null, reason: 'No Base tx history' };
  }

  // Compute cluster size against current pool of LHAW users.
  const windowHours = getWindowHours();
  const minCohort = getMinCohort();
  const clusterSize = await computeClusterSize(firstTx, windowHours);

  // Cache the size for the operator-facing report (best-effort).
  await db
    .update(users)
    .set({ walletClusterSize: clusterSize, updatedAt: new Date() })
    .where(eq(users.fid, fid))
    .catch(() => {});

  if (clusterSize >= minCohort) {
    return {
      eligible: false,
      walletFirstTxAt: firstTx,
      clusterSize,
      reason: `Wallet co-deployed with ${clusterSize - 1} other LHAW players within ±${windowHours}h — bot-cluster fingerprint.`,
      errorCode: WALLET_IN_BOT_CLUSTER_ERROR,
    };
  }

  return { eligible: true, walletFirstTxAt: firstTx, clusterSize };
}

export async function logBlockedWalletClusterAttempt(
  fid: number,
  result: WalletClusterCheckResult,
  action: string
): Promise<void> {
  await logAnalyticsEvent('WALLET_CLUSTER_BLOCKED', {
    userId: fid,
    data: {
      action,
      walletFirstTxAt: result.walletFirstTxAt?.toISOString() ?? null,
      clusterSize: result.clusterSize,
      minCohort: getMinCohort(),
      windowHours: getWindowHours(),
      blockedAt: new Date().toISOString(),
    },
  });
  console.log(
    `🚫 [WalletCluster] Blocked FID ${fid} (cluster=${result.clusterSize}) from ${action}`
  );
}

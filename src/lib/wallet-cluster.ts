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
 * operational cost of the farm.
 *
 * SCOPE (June 2026): the gate evaluates ALL users by wallet co-mint
 * clustering. It originally fired only on `.base.eth` usernames, but the
 * farm adapted — Rounds 31/32 were won by placeholder-username accounts
 * (no basename) carrying the same co-mint + low-score fingerprint, which the
 * username scope waved through. Pure Farcaster/Warpcast users with zero Base
 * txs stay unaffected: they have no resolvable first-tx and fail open below.
 * Set WALLET_CLUSTER_REQUIRE_BASE_ETH=true to restore the original narrow
 * `.base.eth`-only scope if a legitimately batch-onboarded cohort ever trips it.
 */
import * as Sentry from '@sentry/nextjs';
import { db } from '../db';
import { users } from '../db/schema';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { logAnalyticsEvent } from './analytics';
import { hasCoinbaseVerifiedAccount } from './attestations';

export const WALLET_IN_BOT_CLUSTER_ERROR = 'WALLET_IN_BOT_CLUSTER';

const DEFAULT_MIN_COHORT = 5;
const DEFAULT_WINDOW_HOURS = 1;
const DEFAULT_SCORE_MAX = 0.70;
// Per-page Blockscout fetch timeout. High-activity wallets return a large
// first transactions page (~50 items / ~200KB) that can take ~6s to serve;
// a 5s budget aborted page 1 before any data was read, which returns
// `verified=false` and leaves the wallet PERMANENTLY unverified (every
// retry hits the same slow page). That misclassifies legitimate
// high-activity wallets as "no Base history" and stalls the backfill on
// them. 10s clears the observed ~6.3s worst case with margin. Latency is
// bounded: the gate caches the result and only re-fetches after
// RETRY_COOLDOWN_MS, and page-2+ timeouts still degrade to a verified
// partial result, so this only affects the rare uncached slow first page.
const BLOCKSCOUT_TIMEOUT_MS = 10000;
const RETRY_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/** See resolveCoinbaseAttestation for why these differ. */
const ATTESTATION_TRUE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ATTESTATION_FALSE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * The bypass is on whenever the gate itself is on. It only ever makes the gate
 * more permissive, and it is the reason the gate is safe to enable at all, so
 * defaulting it off would ship the risk without the mitigation. Set to "false"
 * to disable it — worth having if Coinbase verifications ever start showing up
 * in the farm's own wallets.
 */
function getAttestationBypassEnabled(): boolean {
  return process.env.WALLET_CLUSTER_ATTESTATION_BYPASS !== 'false';
}

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

/**
 * Whether to scope the cluster gate to `.base.eth` (Coinbase-flow) usernames only.
 * Default FALSE: evaluate EVERY user by wallet co-mint clustering. The R28/R29/R31/R32
 * farm evades a username-suffix scope by winning with placeholder (non-.base.eth)
 * handles, so keying the gate on the username is a free bypass. Flip this to 'true'
 * only as a rollback if a genuinely batch-onboarded real cohort starts tripping it.
 */
function getRequireBaseEth(): boolean {
  return process.env.WALLET_CLUSTER_REQUIRE_BASE_ETH === 'true';
}

export interface WalletClusterCheckResult {
  eligible: boolean;
  walletFirstTxAt: Date | null;
  clusterSize: number | null;
  reason?: string;
  errorCode?: string;
  /**
   * True when this user was in a blocking cluster and cleared only because of
   * their Coinbase attestation. Structured rather than inferred from `reason`,
   * so the dry-run report cannot silently stop counting exemptions the day
   * someone rewords a string.
   */
  bypassedByAttestation?: boolean;
}

/**
 * Result of a Blockscout first-tx lookup.
 *
 * `verified=true` means we successfully reached Blockscout and can trust
 * `firstTxAt` (which may be null if the wallet genuinely has no Base
 * activity). `verified=false` means we couldn't complete the lookup —
 * the caller should NOT cache the absence as ground truth.
 *
 * The two states must stay distinguishable. The earlier API returned
 * `Date | null` and conflated "no history" with "couldn't reach
 * Blockscout"; the backfill endpoint then marked users as permanently
 * checked during outages.
 */
export interface FirstTxResult {
  firstTxAt: Date | null;
  verified: boolean;
}

/**
 * Walk Blockscout pages descending to find the wallet's earliest tx.
 * Returns a {firstTxAt, verified} result. Caps pagination so a high-activity
 * wallet doesn't block the gate — for our purposes, "first tx is older
 * than what we can see in the first 5 pages" is well-aged enough; a
 * partial walk that found at least one tx is still `verified=true`.
 *
 * Exported so the admin backfill endpoint can reuse the same logic
 * (including timeout handling, pagination, Sentry alerts) instead of
 * forking it. Single source of truth for "ask Blockscout for a wallet's
 * first Base tx".
 */
export async function fetchWalletFirstTx(wallet: string, maxPages = 5): Promise<FirstTxResult> {
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
        // Partial result if we already found something on a prior page;
        // verified=true because the prior page completed cleanly. Otherwise
        // the lookup is unverified.
        return { firstTxAt: oldest ? new Date(oldest) : null, verified: oldest !== null };
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
      // Same partial-result logic as the non-200 branch.
      return { firstTxAt: oldest ? new Date(oldest) : null, verified: oldest !== null };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // Loop completed normally — every page we walked succeeded.
  return { firstTxAt: oldest ? new Date(oldest) : null, verified: true };
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
 * 1. user_score < scoreMax (default 0.70)
 * 2. wallet_first_tx_at clusters with ≥minCohort other LHAW wallets
 * (+ optional scope: if WALLET_CLUSTER_REQUIRE_BASE_ETH=true, username must be `*.base.eth`)
 *
 * Anyone who fails ANY of those filters passes the gate. In particular:
 * - High-score users (≥ 0.70) pass automatically
 * - Users with no resolvable Base first-tx pass (fail-open) — this is where
 *   pure Farcaster/Warpcast wallets with zero Base activity fall out
 * - Solo wallets (cluster size 1–4) pass
 *
 * SCOPE (June 2026): no longer `.base.eth`-only — the gate evaluates every
 * user by co-mint clustering, because the farm won Rounds 31/32 with
 * placeholder-username accounts that the old username scope exempted.
 *
 * Fail-open on Blockscout errors with Sentry alert. RPC outages should
 * not lock users out.
 */
/**
 * Cached read of the wallet's Coinbase Verified Account attestation.
 *
 * The two cache lifetimes are deliberately different. A positive is stable —
 * attestations are long-lived and revocation is rare — so it is held for a
 * month. A negative is held for only six hours, because the most likely reason
 * to see one is a player who has not verified *yet*: someone blocked by this
 * gate who then goes and verifies with Coinbase should get in the same day,
 * not four weeks later. Caching both for the same duration would optimise the
 * wrong direction.
 *
 * Throws if the lookup fails, so the caller can distinguish it from a
 * confirmed negative.
 */
async function resolveCoinbaseAttestation(
  fid: number,
  wallet: string,
  cached: boolean | null,
  checkedAt: Date | null,
  forceRefresh: boolean
): Promise<boolean> {
  const ttl = cached === true ? ATTESTATION_TRUE_TTL_MS : ATTESTATION_FALSE_TTL_MS;
  const fresh = !forceRefresh && checkedAt !== null && Date.now() - checkedAt.getTime() < ttl;

  if (fresh && cached !== null) {
    return cached;
  }

  const attested = await hasCoinbaseVerifiedAccount(wallet);

  // Best-effort cache write: failing to memoise is not a reason to fail the
  // lookup we already have an answer for.
  await db
    .update(users)
    .set({
      coinbaseAttested: attested,
      coinbaseAttestedCheckedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.fid, fid))
    .catch(() => {});

  return attested;
}

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
      coinbaseAttested: users.coinbaseAttested,
      coinbaseAttestedCheckedAt: users.coinbaseAttestedCheckedAt,
    })
    .from(users)
    .where(eq(users.fid, fid))
    .limit(1);

  if (!user) {
    return { eligible: true, walletFirstTxAt: null, clusterSize: null, reason: 'No user record' };
  }

  // Filter 1 (optional scope): the gate evaluates ALL users by default. The
  // farm evaded a `.base.eth`-only scope by winning with placeholder usernames
  // (Rounds 31/32), so username suffix is not a safe gating key. Pure
  // Farcaster/Warpcast users with no Base activity still pass — they fail open
  // at the "No Base tx history" check below. WALLET_CLUSTER_REQUIRE_BASE_ETH=true
  // restores the legacy narrow scope as a rollback lever.
  if (getRequireBaseEth() && (!user.username || !user.username.toLowerCase().endsWith('.base.eth'))) {
    return { eligible: true, walletFirstTxAt: null, clusterSize: null, reason: 'Not a .base.eth user (narrow scope)' };
  }

  // Filter 2: bypass unless we have a score AND it's below scoreMax.
  // A null score is NOT verifiably below threshold — fail open in that
  // case to match the rest of the gate's policy. Without this, a user
  // whose score was never fetched (e.g. USER_QUALITY_GATING_ENABLED is
  // off) would be evaluated on cluster size alone, turning the documented
  // compound gate into a 1-of-2 gate. The "ONLY when all" promise in the
  // docstring requires explicit confirmation of the low-score condition,
  // not just absence of evidence to the contrary.
  const score = user.score ? parseFloat(user.score) : null;
  const scoreMax = getScoreMax();
  if (score === null || score >= scoreMax) {
    return {
      eligible: true,
      walletFirstTxAt: user.walletFirstTxAt ?? null,
      clusterSize: user.walletClusterSize ?? null,
      reason:
        score === null
          ? 'No user score on file — failing open'
          : `score ${score} >= ${scoreMax}`,
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
        const result = await fetchWalletFirstTx(user.wallet);
        // Always stamp checked_at — the cooldown logic depends on it. The
        // gate uses cached negative result + cooldown to limit Blockscout
        // load during outages; lazy-fetch will retry every 6h.
        await db
          .update(users)
          .set({
            walletFirstTxAt: result.firstTxAt ?? undefined,
            walletFirstTxCheckedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(users.fid, fid));
        firstTx = result.firstTxAt;
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
    // Last chance to clear: a Coinbase Verified Account attestation on this
    // wallet overrides the heuristic.
    //
    // The co-mint signal is circumstantial — it says "your wallet was created
    // around the same time as some other players' wallets", which is also true
    // of anyone onboarded in a launch wave. That collateral damage is why this
    // gate has never been switched on. An onchain attestation from Coinbase is
    // evidence about *this* person that a farm cannot mass-produce, so a
    // verified player is exempt and the cohort threshold can be tightened at
    // the farm without taking honest players with it.
    //
    // Checked here rather than at the top of the function on purpose: every
    // earlier exit already fails open, so a verified user reaches the same
    // outcome either way, and this placement means the RPC round-trip is only
    // spent on the users actually facing a block.
    if (getAttestationBypassEnabled()) {
      try {
        const attested = await resolveCoinbaseAttestation(fid, user.wallet, user.coinbaseAttested, user.coinbaseAttestedCheckedAt, forceRefresh);
        if (attested) {
          return {
            eligible: true,
            walletFirstTxAt: firstTx,
            clusterSize,
            reason: `In a cluster of ${clusterSize}, but holds a Coinbase Verified Account attestation`,
            bypassedByAttestation: true,
          };
        }
      } catch (err) {
        // Could not check. Fall through to the block — an RPC outage must not
        // hand out bypasses, and this is exactly the behaviour the gate had
        // before attestations existed.
        Sentry.captureException(err, {
          tags: { component: 'wallet-cluster', operation: 'attestation_bypass' },
          extra: { fid, wallet: user.wallet },
        });
      }
    }

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

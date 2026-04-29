/**
 * Wallet-History Gating
 *
 * Post-Round-29 sybil defense. The Round 28/29 attacker minted thousands of
 * `.base.eth` FIDs whose payout wallets all sit at 8–12 outgoing txs and
 * ~$0.01 ETH balance — the exact footprint of a Coinbase Smart Wallet that
 * was deployed, registered a basename, added a Farcaster signer, and was
 * never used for anything else. A real player wallet sits in the hundreds
 * to tens of thousands of txs (sample legit wallet: 3,447 txs).
 *
 * Two-orders-of-magnitude separation, so a tx-count threshold is the cleanest
 * surgical filter we have without hurting real onboarding.
 *
 * Source of truth is Base mainnet via `eth_getTransactionCount` on the user's
 * signer wallet. Result is cached on `users.wallet_tx_count` because counts
 * only go up — a passed wallet stays passed.
 */
import * as Sentry from '@sentry/nextjs';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { logAnalyticsEvent } from './analytics';

export const WALLET_TOO_FRESH_ERROR = 'WALLET_TOO_FRESH';

const DEFAULT_MIN_TXS = 20;
const RPC_FETCH_TIMEOUT_MS = 3000;

/**
 * Once a wallet passes the gate, its tx count only goes up — never refetch.
 * If it fails, retry every 6h so a user can keep playing eventually if they
 * use the wallet for other things.
 */
const WALLET_RETRY_COOLDOWN_MS = 6 * 60 * 60 * 1000;

function getMinTxs(): number {
  const raw = process.env.WALLET_HISTORY_MIN_TXS;
  if (!raw) return DEFAULT_MIN_TXS;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MIN_TXS;
}

function getAllowlistedFids(): Set<number> {
  const raw = process.env.WALLET_HISTORY_ALLOWLIST || '';
  if (!raw.trim()) return new Set();
  return new Set(
    raw
      .split(',')
      .map((fid) => parseInt(fid.trim(), 10))
      .filter((fid) => !Number.isNaN(fid))
  );
}

function getBaseRpcUrl(): string {
  // BASE_RPC_URL is the project's primary Base RPC (per CLAUDE.md).
  // Fallback to the public mainnet endpoint, which is rate-limited but
  // safe for low-volume cached lookups.
  return (process.env.BASE_RPC_URL || 'https://mainnet.base.org').replace(/\/$/, '');
}

export interface WalletHistoryCheckResult {
  eligible: boolean;
  txCount: number | null;
  reason?: string;
  errorCode?: string;
}

async function fetchTxCount(wallet: string): Promise<number | null> {
  const url = getBaseRpcUrl();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), RPC_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getTransactionCount',
        params: [wallet, 'latest'],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(`[WalletHistory] RPC returned ${response.status} for ${wallet}`);
      Sentry.captureMessage('[WalletHistory] RPC non-200', {
        level: 'warning',
        tags: { component: 'wallet-history', failure: 'http_error' },
        extra: { wallet, status: response.status },
      });
      return null;
    }

    const body = (await response.json()) as { result?: string; error?: { message?: string } };
    if (body.error) {
      console.warn(`[WalletHistory] RPC error for ${wallet}: ${body.error.message}`);
      Sentry.captureMessage('[WalletHistory] RPC body error', {
        level: 'warning',
        tags: { component: 'wallet-history', failure: 'rpc_error' },
        extra: { wallet, error: body.error.message },
      });
      return null;
    }

    if (!body.result) {
      return null;
    }
    // parseInt("0x", 16) → NaN. NaN is a number so it passes the typeof
    // guard above and propagates through `fetched ?? undefined` /
    // `fetched ?? cached` (nullish-coalescing only catches null/undefined).
    // If we let NaN through it either crashes the DB integer write
    // (breaking cooldown so we re-RPC in a hot loop) or makes the gate
    // block users with a "NaN Base txs" message. Treat malformed responses
    // as RPC failure.
    const txCount = parseInt(body.result, 16);
    if (!Number.isFinite(txCount)) {
      console.warn(`[WalletHistory] RPC returned non-numeric result "${body.result}" for ${wallet}`);
      Sentry.captureMessage('[WalletHistory] RPC malformed result', {
        level: 'warning',
        tags: { component: 'wallet-history', failure: 'malformed_result' },
        extra: { wallet, result: body.result },
      });
      return null;
    }
    return txCount;
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      console.warn(`[WalletHistory] RPC timed out (${RPC_FETCH_TIMEOUT_MS}ms) for ${wallet}`);
      Sentry.captureMessage('[WalletHistory] RPC timeout', {
        level: 'warning',
        tags: { component: 'wallet-history', failure: 'timeout' },
        extra: { wallet, timeoutMs: RPC_FETCH_TIMEOUT_MS },
      });
    } else {
      console.error(`[WalletHistory] RPC failed for ${wallet}:`, error);
      Sentry.captureException(error, {
        tags: { component: 'wallet-history', failure: 'exception' },
        extra: { wallet },
      });
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Read user record for the gate: cached tx count, checked-at, and the wallet
 * address itself. Wallet is loaded from DB rather than passed in because the
 * QuickAuth code path doesn't have it locally (it's preserved across upserts).
 */
async function loadUserForGate(fid: number): Promise<{
  wallet: string | null;
  cached: number | null;
  checkedAt: Date | null;
}> {
  const [user] = await db
    .select({
      walletTxCount: users.walletTxCount,
      walletTxCountCheckedAt: users.walletTxCountCheckedAt,
      signerWallet: users.signerWalletAddress,
    })
    .from(users)
    .where(eq(users.fid, fid))
    .limit(1);

  return {
    wallet: user?.signerWallet ?? null,
    cached: user?.walletTxCount ?? null,
    checkedAt: user?.walletTxCountCheckedAt ?? null,
  };
}

async function resolveWalletTxCount(
  fid: number,
  wallet: string,
  cached: number | null,
  checkedAt: Date | null,
  forceRefresh: boolean
): Promise<number | null> {
  const minTxs = getMinTxs();

  // Fast path: already passed. Counts only go up — they stay passed.
  if (!forceRefresh && cached !== null && cached >= minTxs) {
    return cached;
  }

  // Cooldown: don't hammer the RPC. Apply to BOTH failed lookups (cached=null)
  // and sparse-but-not-zero counts (cached < minTxs). Without this, a wallet
  // whose RPC call always fails would re-fire a 3s timeout request on every
  // single guess submission. The check is only on `checkedAt` because the
  // 'never tried' state has checkedAt=null and falls through to the fetch.
  if (
    !forceRefresh &&
    checkedAt &&
    Date.now() - checkedAt.getTime() < WALLET_RETRY_COOLDOWN_MS
  ) {
    return cached;
  }

  const fetched = await fetchTxCount(wallet);

  // Tx counts are monotonic — they only go up. The rest of the gate relies
  // on this. But a load-balanced RPC backend serving a lagging node, or a
  // brief L2 reorg, can return a value lower than what we cached earlier.
  // Take the max of fetched and cached so a real user who already passed
  // never gets downgraded into a fail (especially dangerous on the
  // forceRefresh=true win-time path — would block a legitimate winner).
  // Also covers the RPC-failure case (fetched=null) since `cached` wins
  // through the same Math.max via nullish-coalescing default.
  const effective =
    fetched !== null
      ? Math.max(fetched, cached ?? 0)
      : cached;

  await db
    .update(users)
    .set({
      walletTxCount: effective ?? undefined,
      walletTxCountCheckedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.fid, fid));

  return effective;
}

/**
 * Check whether a FID's signer wallet has enough Base activity to play.
 *
 * Behavior:
 * - Allowlist FIDs bypass entirely.
 * - No wallet on file → ineligible (can't gate someone with no payout address).
 * - Cached pass → returns immediately.
 * - Cached fail within cooldown → returns cached value.
 * - Otherwise fetches via Base RPC and caches.
 * - RPC failures fail OPEN with Sentry warning (same trade as account-age).
 *
 * `forceRefresh: true` is used by the winner-eligibility check at win time —
 * we don't want to lock a round to a winner based on a stale cached pass.
 */
export async function checkWalletHistory(
  fid: number,
  forceRefresh = false
): Promise<WalletHistoryCheckResult> {
  const allowlist = getAllowlistedFids();
  if (allowlist.has(fid)) {
    return { eligible: true, txCount: null, reason: 'Allowlisted FID' };
  }

  const { wallet, cached, checkedAt } = await loadUserForGate(fid);

  if (!wallet) {
    return {
      eligible: false,
      txCount: null,
      reason: 'No wallet on file',
      errorCode: WALLET_TOO_FRESH_ERROR,
    };
  }

  const minTxs = getMinTxs();

  try {
    const txCount = await resolveWalletTxCount(fid, wallet, cached, checkedAt, forceRefresh);

    if (txCount === null) {
      // Fail open. Locking everyone out on a Base RPC blip is worse than the
      // attack we're defending against; sybil attackers can't trigger RPC outages.
      return { eligible: true, txCount: null, reason: 'RPC unavailable — allowing access' };
    }

    if (txCount >= minTxs) {
      return { eligible: true, txCount };
    }

    return {
      eligible: false,
      txCount,
      reason: `Connected wallet has only ${txCount} Base txs (minimum ${minTxs}). Use a wallet with more onchain activity.`,
      errorCode: WALLET_TOO_FRESH_ERROR,
    };
  } catch (error) {
    console.error(`[WalletHistory] Unexpected error for FID ${fid}:`, error);
    Sentry.captureException(error, {
      tags: { component: 'wallet-history', operation: 'check' },
      extra: { fid, wallet },
    });
    return { eligible: true, txCount: null, reason: 'Error checking wallet — allowing access' };
  }
}

export async function logBlockedWalletHistoryAttempt(
  fid: number,
  result: WalletHistoryCheckResult,
  action: string
): Promise<void> {
  await logAnalyticsEvent('WALLET_HISTORY_BLOCKED', {
    userId: fid,
    data: {
      action,
      txCount: result.txCount,
      minTxs: getMinTxs(),
      blockedAt: new Date().toISOString(),
    },
  });
  console.log(
    `🚫 [WalletHistory] Blocked FID ${fid} (txs ${result.txCount ?? '?'}) from action: ${action}`
  );
}

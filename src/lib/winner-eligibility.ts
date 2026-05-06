/**
 * Winner-Eligibility Check (defense-in-depth)
 *
 * Runs at win-time as a last line of defense before a round is locked
 * and a jackpot is paid out. Re-runs the same gates that should have
 * filtered the FID at guess-time, but with `forceRefresh: true` so we
 * don't trust stale cache when real ETH is at stake.
 *
 * Each gate is consulted only if its env flag is set — this is a layered
 * defense, not a separate one. If guess-time gates are off, this is too.
 */
import { checkAccountAge, type AccountAgeCheckResult } from './account-age';
import {
  checkWalletHistory,
  type WalletHistoryCheckResult,
} from './wallet-history';
import {
  checkWalletCluster,
  type WalletClusterCheckResult,
} from './wallet-cluster';

export interface WinnerEligibilityResult {
  eligible: boolean;
  reasons: string[];
  ageCheck?: AccountAgeCheckResult;
  walletCheck?: WalletHistoryCheckResult;
  clusterCheck?: WalletClusterCheckResult;
}

export async function checkWinnerEligibility(fid: number): Promise<WinnerEligibilityResult> {
  const reasons: string[] = [];

  // Run the two checks in parallel. They write to different column groups on
  // the same users row (fid_registered_at* vs wallet_tx_count*), each manages
  // its own DB update, and both fail-open internally — so concurrent execution
  // is safe and halves worst-case latency on the win path. Latency matters
  // here: this runs BEFORE the round-lock transaction, and every second of
  // delay widens the race window for a competing winner. With each gate
  // having a 3s network timeout, sequential = up to 6s; parallel = up to 3s.
  const ageEnabled = process.env.ACCOUNT_AGE_GATING_ENABLED === 'true';
  const walletEnabled = process.env.WALLET_HISTORY_GATING_ENABLED === 'true';
  const clusterEnabled = process.env.WALLET_CLUSTER_GATING_ENABLED === 'true';

  const [ageCheck, walletCheck, clusterCheck] = await Promise.all([
    ageEnabled
      ? checkAccountAge(fid, /* forceRefresh */ true)
      : (undefined as AccountAgeCheckResult | undefined),
    walletEnabled
      ? checkWalletHistory(fid, /* forceRefresh */ true)
      : (undefined as WalletHistoryCheckResult | undefined),
    clusterEnabled
      ? checkWalletCluster(fid, /* forceRefresh */ true)
      : (undefined as WalletClusterCheckResult | undefined),
  ]);

  if (ageCheck && !ageCheck.eligible) {
    reasons.push(`account_too_new (ageDays=${ageCheck.ageDays?.toFixed(2) ?? '?'})`);
  }
  if (walletCheck && !walletCheck.eligible) {
    reasons.push(`wallet_too_fresh (txCount=${walletCheck.txCount ?? '?'})`);
  }
  if (clusterCheck && !clusterCheck.eligible) {
    reasons.push(`wallet_in_bot_cluster (clusterSize=${clusterCheck.clusterSize ?? '?'})`);
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    ageCheck,
    walletCheck,
    clusterCheck,
  };
}

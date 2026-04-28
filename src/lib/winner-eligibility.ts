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

export interface WinnerEligibilityResult {
  eligible: boolean;
  reasons: string[];
  ageCheck?: AccountAgeCheckResult;
  walletCheck?: WalletHistoryCheckResult;
}

export async function checkWinnerEligibility(fid: number): Promise<WinnerEligibilityResult> {
  const reasons: string[] = [];
  let ageCheck: AccountAgeCheckResult | undefined;
  let walletCheck: WalletHistoryCheckResult | undefined;

  // Account-age check
  if (process.env.ACCOUNT_AGE_GATING_ENABLED === 'true') {
    ageCheck = await checkAccountAge(fid);
    if (!ageCheck.eligible) {
      reasons.push(`account_too_new (ageDays=${ageCheck.ageDays?.toFixed(2) ?? '?'})`);
    }
  }

  // Wallet-history check, force-refresh because counts are monotonic and a
  // win is the moment to confirm the wallet is genuinely active.
  if (process.env.WALLET_HISTORY_GATING_ENABLED === 'true') {
    walletCheck = await checkWalletHistory(fid, /* forceRefresh */ true);
    if (!walletCheck.eligible) {
      reasons.push(`wallet_too_fresh (txCount=${walletCheck.txCount ?? '?'})`);
    }
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    ageCheck,
    walletCheck,
  };
}

/**
 * $WORD amount arithmetic — pure, no I/O.
 *
 * Everything that decides how many tokens move lives here, deliberately free of
 * database, RPC and private-key imports for two reasons:
 *
 * 1. The client needs it. The UI renders $WORD prizes with a USD equivalent,
 *    and a component importing from `word-jackpot-contract.ts` would drag in
 *    `wallet-identity` -> `db` and the operator key path.
 * 2. It is the part worth testing exhaustively, and it should be testable
 *    without a DATABASE_URL.
 *
 * `tokensForUsdCents` mirrors WordJackpot.seedTokensFor exactly, truncation
 * included. If the two ever disagree the backend's pre-flight bounds check
 * passes while the contract computes a different seed, which means a round
 * funded with the wrong amount of money and no way to undo it.
 */

import { ethers } from 'ethers';

/**
 * Bounds on what the oracle may claim $WORD is worth, in USD.
 *
 * Not a price prediction — a floor and ceiling on what is conceivably a real
 * quote for a token that has traded in $0.00000022-$0.00000034 for five
 * months. A price below the floor makes a USD-denominated seed buy
 * proportionally more tokens (a 100x-too-low price seeds 100x the tokens), so
 * an unchecked near-zero price is the most expensive input error available.
 */
export const MIN_PLAUSIBLE_PRICE_USD = 1e-12;
export const MAX_PLAUSIBLE_PRICE_USD = 1e-2;

/** WordJackpot.MAX_RECIPIENTS, mirrored so pre-flight needs no round-trip. */
export const MAX_PAYOUT_RECIPIENTS = 32;

const E18 = 10n ** 18n;
const E34 = 10n ** 34n;

/**
 * Convert a USD-per-token float to the 1e18-scaled integer the contract stores.
 *
 * The oracle produces a JS number (2.56e-7). Multiplying by 1e18 in floating
 * point and rounding is lossy at this magnitude, so the value is rendered to a
 * fixed-point decimal string first and parsed as an integer.
 *
 * Throws rather than returning a sentinel. Every caller feeds a contract that
 * prices real payouts, and `config/economy.ts` already demonstrated the failure
 * mode where a '0' default propagates silently because the string is truthy.
 */
export function usdPriceToE18(priceUsd: number): bigint {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    throw new Error(`Refusing to convert non-positive $WORD price: ${priceUsd}`);
  }
  if (priceUsd < MIN_PLAUSIBLE_PRICE_USD || priceUsd > MAX_PLAUSIBLE_PRICE_USD) {
    throw new Error(
      `$WORD price ${priceUsd.toExponential(4)} is outside the plausible range ` +
        `[${MIN_PLAUSIBLE_PRICE_USD.toExponential(0)}, ${MAX_PLAUSIBLE_PRICE_USD.toExponential(0)}] — ` +
        `refusing to push it onchain`
    );
  }

  const e18 = ethers.parseUnits(priceUsd.toFixed(18), 18);
  if (e18 === 0n) {
    throw new Error(`$WORD price ${priceUsd.toExponential(4)} rounds to zero at 1e18 scale`);
  }
  return e18;
}

/** Inverse of `usdPriceToE18`, for display. */
export function e18PriceToUsd(priceE18: bigint): number {
  return Number(ethers.formatUnits(priceE18, 18));
}

/**
 * Token wei a USD amount buys at a 1e18-scaled price.
 *
 * Mirrors WordJackpot.seedTokensFor: `tokensWei = usdCents * 1e34 / priceE18`,
 * with the same truncating integer division.
 */
export function tokensForUsdCents(usdCents: bigint, priceE18: bigint): bigint {
  if (priceE18 <= 0n) {
    throw new Error('Cannot price a seed with a zero $WORD price');
  }
  return (usdCents * E34) / priceE18;
}

/**
 * USD cents a token amount is worth at a 1e18-scaled price.
 *
 * Used to label $WORD amounts in the UI and to record USD snapshots in the
 * archive, so a later price move never rewrites what a past round was worth.
 */
export function usdCentsForTokens(tokensWei: bigint, priceE18: bigint): bigint {
  if (priceE18 <= 0n) {
    throw new Error('Cannot value tokens with a zero $WORD price');
  }
  return (tokensWei * priceE18) / E34;
}

/**
 * Format token wei for display: whole tokens, thousands-separated.
 *
 * $WORD trades at ~$0.00000026, so a $20 seed is ~78 million tokens and the
 * fractional part is worth ~1e-25 dollars. Showing it is noise.
 */
export function formatWordAmount(amountWei: bigint): string {
  const whole = amountWei / E18;
  return whole.toLocaleString('en-US');
}

/** Format USD cents as `$12.34`. */
export function formatUsdCents(cents: bigint | number): string {
  const n = typeof cents === 'bigint' ? Number(cents) : cents;
  return `$${(n / 100).toFixed(2)}`;
}

export interface WordPayoutRecipient {
  address: string;
  amountWei: bigint;
  role: 'winner' | 'referrer' | 'top_guesser' | 'seed';
  fid?: number;
}

export interface PayoutValidation {
  valid: boolean;
  errors: string[];
  totalPayoutWei: bigint;
  totalWithCarryWei: bigint;
}

/**
 * Check a payout array against every condition WordJackpot.resolveRound
 * enforces, before spending gas to be told the same thing by a revert.
 *
 * The zero-address rule mirrors the contract's own check and is the subtle one:
 * a nonzero amount aimed at address(0) passes the sum test, is then skipped by
 * the payout loop, and leaves those tokens in the contract as unallocated —
 * sweepable, while the round reports them as paid.
 */
export function validateWordPayouts(
  payouts: WordPayoutRecipient[],
  carryForNextRoundWei: bigint,
  poolWei: bigint
): PayoutValidation {
  const errors: string[] = [];

  const totalPayoutWei = payouts.reduce((sum, p) => sum + p.amountWei, 0n);
  const totalWithCarryWei = totalPayoutWei + carryForNextRoundWei;

  if (payouts.length === 0) {
    errors.push('At least one payout recipient (the winner) is required');
  }
  if (payouts.length > MAX_PAYOUT_RECIPIENTS) {
    errors.push(
      `${payouts.length} recipients exceeds the contract cap of ${MAX_PAYOUT_RECIPIENTS}`
    );
  }
  if (carryForNextRoundWei < 0n) {
    errors.push('Carry for the next round cannot be negative');
  }

  for (const [i, p] of payouts.entries()) {
    if (p.amountWei < 0n) {
      errors.push(`Recipient ${i} (${p.role}) has a negative amount`);
      continue;
    }
    if (p.amountWei === 0n) continue;

    if (!p.address || p.address === ethers.ZeroAddress) {
      errors.push(
        `Recipient ${i} (${p.role}${p.fid ? `, FID ${p.fid}` : ''}) has a nonzero amount ` +
          `but a zero address — the contract rejects this, and it would otherwise strand ` +
          `${formatWordAmount(p.amountWei)} $WORD as sweepable while reporting it paid`
      );
      continue;
    }
    if (!ethers.isAddress(p.address)) {
      errors.push(`Recipient ${i} (${p.role}) has a malformed address: ${p.address}`);
    }
  }

  if (totalWithCarryWei !== poolWei) {
    const diff =
      totalWithCarryWei > poolWei ? totalWithCarryWei - poolWei : poolWei - totalWithCarryWei;
    errors.push(
      `Payout math mismatch: payouts ${formatWordAmount(totalPayoutWei)} + carry ` +
        `${formatWordAmount(carryForNextRoundWei)} = ${formatWordAmount(totalWithCarryWei)} $WORD, ` +
        `but the pool holds ${formatWordAmount(poolWei)} $WORD (off by ${diff} wei)`
    );
  }

  return { valid: errors.length === 0, errors, totalPayoutWei, totalWithCarryWei };
}

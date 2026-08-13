/**
 * Prize amount formatting for the UI — pure, no I/O.
 *
 * One place that answers "how do I render this round's prize", so the ~13
 * components and ~30 message templates that show a prize do not each grow their
 * own currency branch. Imported by client components, so it deliberately pulls
 * in nothing but `word-amounts` (which is itself I/O-free).
 *
 * The currency always comes from the round, never from a build flag: the
 * archive renders rounds 1-33 in ETH next to round 34+ in $WORD on the same
 * screen.
 */

import { formatWordAmount, usdCentsForTokens } from './word-amounts';

export type PrizeCurrency = 'eth' | 'word';

export interface PrizeAmountInput {
  currency: PrizeCurrency;
  /** ETH as a decimal string, e.g. "0.0216". Used when currency is 'eth'. */
  eth?: string | null;
  /** $WORD in wei as a decimal string. Used when currency is 'word'. */
  word?: string | null;
  /** USD equivalent as a decimal string, e.g. "20.00". Optional for both. */
  usd?: string | null;
}

/**
 * Format an ETH amount to 4 decimal places.
 *
 * Matches the existing TopTicker behaviour exactly so pulling this out changes
 * nothing about how rounds 1-33 render.
 */
export function formatEthAmount(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (!Number.isFinite(num)) return '0.0000';
  return num.toFixed(4);
}

/**
 * The prize amount without its unit, e.g. "0.0216" or "78,125,000".
 */
export function formatPrizeValue(input: PrizeAmountInput): string {
  if (input.currency === 'word') {
    let wei: bigint;
    try {
      wei = BigInt(input.word ?? '0');
    } catch {
      // A malformed value must not blank the header on the game's main screen.
      wei = 0n;
    }
    return formatWordAmount(wei);
  }
  return formatEthAmount(input.eth ?? '0');
}

/** The unit label: `ETH` or `$WORD`. */
export function prizeUnit(currency: PrizeCurrency): string {
  return currency === 'word' ? '$WORD' : 'ETH';
}

/**
 * Amount and unit together, e.g. "0.0216 ETH" or "78,125,000 $WORD".
 */
export function formatPrize(input: PrizeAmountInput): string {
  return `${formatPrizeValue(input)} ${prizeUnit(input.currency)}`;
}

/**
 * USD in parentheses, e.g. "($20.00)", or null when there is no value to show.
 *
 * $WORD amounts are large and unitless to most players, so the USD equivalent
 * is doing more work here than it did for ETH — it is the number that tells
 * someone whether the round is worth playing.
 */
export function formatPrizeUsd(usd: string | number | null | undefined): string | null {
  if (usd === null || usd === undefined || usd === '') return null;
  const num = typeof usd === 'string' ? parseFloat(usd) : usd;
  if (!Number.isFinite(num) || num <= 0) return null;
  return `$${num.toFixed(2)}`;
}

/**
 * USD value of a $WORD amount, given the 1e18-scaled price it was priced at.
 * Returns null when either input is missing, rather than a misleading "$0.00".
 */
export function wordUsdValue(
  wordWei: string | null | undefined,
  priceE18: string | null | undefined
): string | null {
  if (!wordWei || !priceE18) return null;
  try {
    const price = BigInt(priceE18);
    if (price <= 0n) return null;
    const cents = usdCentsForTokens(BigInt(wordWei), price);
    return (Number(cents) / 100).toFixed(2);
  } catch {
    return null;
  }
}

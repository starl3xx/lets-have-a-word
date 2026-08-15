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
 * Compact prize for the info bar (decided 2026-08-15): "120M $WORD" instead
 * of "120,000,000 $WORD". The bar is the tightest surface in the app and
 * never wraps; every other surface keeps the full-separator form. ETH
 * amounts are short already and pass through unchanged.
 */
export function formatPrizeCompact(input: PrizeAmountInput): string {
  if (input.currency === 'word') {
    let wei: bigint;
    try {
      wei = BigInt(input.word ?? '0');
    } catch {
      wei = 0n;
    }
    return `${compactWordAmount(wei)} $WORD`;
  }
  return `${formatEthAmount(input.eth ?? '0')} ETH`;
}

function compactWordAmount(wei: bigint): string {
  const whole = Number(wei / 10n ** 18n);
  if (!Number.isFinite(whole) || whole <= 0) return '0';
  const tiers = [
    { div: 1_000_000_000, suffix: 'B' },
    { div: 1_000_000, suffix: 'M' },
    { div: 1_000, suffix: 'K' },
  ] as const;
  for (let i = 0; i < tiers.length; i++) {
    const { div, suffix } = tiers[i];
    if (whole < div) continue;
    // Round BEFORE choosing the label: 999.96M must roll up to 1B, not
    // render as "1000M" — the one-decimal rounding can carry past the unit.
    const rounded = Math.round((whole / div) * 10) / 10;
    if (rounded >= 1000 && i > 0) {
      const up = tiers[i - 1];
      return `${trimTrailingZero(whole / up.div)}${up.suffix}`;
    }
    return `${trimTrailingZero(rounded)}${suffix}`;
  }
  return whole.toLocaleString('en-US');
}

/** "120.0" reads worse than "120"; one decimal only when it carries signal. */
function trimTrailingZero(n: number): string {
  const s = n.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
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

/**
 * The shape every archive surface receives — the public archive page, the
 * in-game archive modal, and the admin archive table all read the same row from
 * /api/archive/*. Fields are optional because a payload cached from before the
 * $WORD columns shipped arrives without them, and those rounds are ETH.
 */
export interface ArchiveRoundAmounts {
  currency?: string | null;
  finalJackpotEth?: string | null;
  finalJackpotWord?: string | null;
  seedEth?: string | null;
  seedWord?: string | null;
  finalJackpotUsdCents?: number | null;
}

/** Narrow an archive row's currency field, defaulting to the pre-34 asset. */
export function archiveCurrency(round: { currency?: string | null }): PrizeCurrency {
  return round.currency === 'word' ? 'word' : 'eth';
}

/**
 * Final prize pool for an archived round, with its unit.
 *
 * The ETH columns are NULL on a $WORD archive row, so anything reading
 * finalJackpotEth unconditionally renders "NaN ETH" from round 34 on.
 */
export function formatArchiveJackpot(round: ArchiveRoundAmounts): string {
  return formatPrize({
    currency: archiveCurrency(round),
    eth: round.finalJackpotEth,
    word: round.finalJackpotWord,
  });
}

/** Seed for an archived round, with its unit. */
export function formatArchiveSeed(round: ArchiveRoundAmounts): string {
  return formatPrize({
    currency: archiveCurrency(round),
    eth: round.seedEth,
    word: round.seedWord,
  });
}

/**
 * A share of the pool (e.g. the winner's 80%), in the round's currency.
 *
 * $WORD is split in bigint wei — a pool is ~1e26 wei, far past
 * Number.MAX_SAFE_INTEGER, so the float path used for ETH loses precision.
 */
export function formatArchiveShare(round: ArchiveRoundAmounts, bps: number): string {
  if (archiveCurrency(round) === 'word') {
    let wei = 0n;
    try {
      wei = BigInt(round.finalJackpotWord ?? '0');
    } catch {
      wei = 0n;
    }
    return formatPrize({ currency: 'word', word: ((wei * BigInt(bps)) / 10000n).toString() });
  }
  const eth = parseFloat(round.finalJackpotEth ?? '0') || 0;
  return formatPrize({ currency: 'eth', eth: ((eth * bps) / 10000).toFixed(4) });
}

/** One payoutsJson entry, in the round's currency. */
export function formatArchivePayoutEntry(
  entry: { amountEth?: string | null; amountWord?: string | null } | undefined,
  currency: PrizeCurrency
): string {
  if (!entry) return formatPrize({ currency, eth: '0', word: '0' });
  return formatPrize({ currency, eth: entry.amountEth, word: entry.amountWord });
}

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

/**
 * How an archive surface wants its amounts rendered.
 *
 * `compact` is a property of the SURFACE, not of the round: the public archive
 * rounds like the rest of the game, while the admin table keeps every digit so
 * an operator can reconcile a row against the payout tx. ETH is unaffected
 * either way — `formatPrizeCompact` and `formatPrize` both render an ETH
 * amount as four decimals, so rounds 1-33 are byte-identical with the flag on
 * or off, and `archive-currency.test.ts` pins that.
 */
export interface PrizeFormatOptions {
  compact?: boolean;
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

/**
 * Public compact form for a bare $WORD amount ("78.7M", "1.50M") — the same
 * three-significant-digit rule the info bar uses, so every surface rounds
 * identically.
 */
export function formatWordAmountCompact(wei: bigint): string {
  return compactWordAmount(wei);
}

function compactWordAmount(wei: bigint): string {
  const whole = Number(wei / 10n ** 18n);
  if (!Number.isFinite(whole) || whole <= 0) return '0';
  const tiers = [
    { div: 1_000_000_000, suffix: 'B' },
    { div: 1_000_000, suffix: 'M' },
    { div: 1_000, suffix: 'K' },
  ] as const;
  // THREE SIGNIFICANT DIGITS, always (decided 2026-08-15): 999M, 78.1M,
  // 1.00B — the digit count stays constant across magnitudes, the decimal
  // appears only when the magnitude calls for it. A value that rounds past
  // its unit rolls up (999.6M becomes 1.00B, never 1000M).
  for (let i = 0; i < tiers.length; i++) {
    const { div, suffix } = tiers[i];
    if (whole < div) continue;
    let value = whole / div;
    let unit = suffix;
    if (value >= 999.5 && i > 0) {
      value = whole / tiers[i - 1].div;
      unit = tiers[i - 1].suffix;
    }
    return `${threeSignificantDigits(value)}${unit}`;
  }
  return whole.toLocaleString('en-US');
}

/** 1.00–9.99 → two decimals; 10.0–99.9 → one; 100–999 → none. */
function threeSignificantDigits(value: number): string {
  if (value >= 99.95) return Math.round(value).toString();
  if (value >= 9.995) return value.toFixed(1);
  return value.toFixed(2);
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

/** The one place the compact flag is honoured, so no caller re-implements it. */
function formatPrizeWithOptions(
  input: PrizeAmountInput,
  options?: PrizeFormatOptions
): string {
  return options?.compact ? formatPrizeCompact(input) : formatPrize(input);
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
export function formatArchiveJackpot(
  round: ArchiveRoundAmounts,
  options?: PrizeFormatOptions
): string {
  return formatPrizeWithOptions(
    {
      currency: archiveCurrency(round),
      eth: round.finalJackpotEth,
      word: round.finalJackpotWord,
    },
    options
  );
}

/**
 * Rendered where an amount could not be recovered at all.
 *
 * A number is a measurement; the absence of one is not. Printing "0" for a
 * missing value asserts a measurement that was never taken, which is how
 * "0 $WORD" came to sit on the archive page beside a 117M final pool.
 */
export const UNRECOVERABLE_AMOUNT = 'Unknown';

/**
 * Seed for an archived round, with its unit — or UNRECOVERABLE_AMOUNT.
 *
 * A NULL seed column means "the opening pool could not be recovered", NOT "the
 * round opened empty", and the two must not render alike. formatPrize coerces a
 * missing $WORD amount with `BigInt(input.word ?? '0')`, so a null seed_word
 * printed "0 $WORD" — a real-looking number, and a false one. archive.ts writes
 * that NULL deliberately (and now raises a standing incident when it does) for a
 * $WORD round whose seedUsdCents/seedPriceE18 pair cannot be priced; a round
 * that genuinely opened empty carries a real "0" string and still renders as
 * zero.
 */
export function formatArchiveSeed(
  round: ArchiveRoundAmounts,
  options?: PrizeFormatOptions
): string {
  const currency = archiveCurrency(round);
  const seed = currency === 'word' ? round.seedWord : round.seedEth;
  if (seed === null || seed === undefined || seed === '') return UNRECOVERABLE_AMOUNT;
  return formatPrizeWithOptions(
    {
      currency,
      eth: round.seedEth,
      word: round.seedWord,
    },
    options
  );
}

/**
 * A share of the pool (e.g. the winner's 80%), in the round's currency.
 *
 * $WORD is split in bigint wei — a pool is ~1e26 wei, far past
 * Number.MAX_SAFE_INTEGER, so the float path used for ETH loses precision.
 */
export function formatArchiveShare(
  round: ArchiveRoundAmounts,
  bps: number,
  options?: PrizeFormatOptions
): string {
  if (archiveCurrency(round) === 'word') {
    let wei = 0n;
    try {
      wei = BigInt(round.finalJackpotWord ?? '0');
    } catch {
      wei = 0n;
    }
    return formatPrizeWithOptions(
      { currency: 'word', word: ((wei * BigInt(bps)) / 10000n).toString() },
      options
    );
  }
  const eth = parseFloat(round.finalJackpotEth ?? '0') || 0;
  return formatPrizeWithOptions({ currency: 'eth', eth: ((eth * bps) / 10000).toFixed(4) }, options);
}

/** One payoutsJson entry, in the round's currency. */
export function formatArchivePayoutEntry(
  entry: { amountEth?: string | null; amountWord?: string | null } | undefined,
  currency: PrizeCurrency,
  options?: PrizeFormatOptions
): string {
  if (!entry) return formatPrizeWithOptions({ currency, eth: '0', word: '0' }, options);
  return formatPrizeWithOptions(
    { currency, eth: entry.amountEth, word: entry.amountWord },
    options
  );
}

/**
 * What a bonus word paid, stated as the RULE for the era being viewed rather
 * than a number.
 *
 * A bonus word paid a flat 5,000,000 for every find in rounds 1-33 and has paid
 * $1.50 priced by oracle since round 34, so a single number is wrong on one
 * side of the boundary or the other — and the archive shows both eras. Each
 * finder's row carries what that find actually transferred; this is only the
 * caption above the list.
 *
 * The "$1.50" is spelled out rather than read from BONUS_WORD_USD_CENTS on
 * purpose: this module is imported by the info bar on the game's first paint
 * and must not pull `config/economy` into that bundle. prize-display.test.ts
 * asserts the two agree, so the constant cannot move without the copy failing.
 */
export function bonusWordRewardRule(currency: PrizeCurrency): string {
  return currency === 'word' ? '$1.50 of $WORD each' : '5M $WORD each';
}

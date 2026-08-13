/**
 * The current prize for a round, formatted with its unit.
 *
 * Every outbound message that names a prize — casts, push notifications, share
 * text — needs the same three things: read the right contract, fall back to the
 * right database column, and render the right unit. Doing that in each place is
 * how a $WORD round ends up announcing an ETH prize.
 */

import { getCurrentJackpotOnChain } from './jackpot-contract';
import { formatWordAmount, usdCentsForTokens } from './word-amounts';

/**
 * Byte-for-byte the announcer's existing formatEth: 4 decimals, trailing zeros
 * stripped. Reproduced rather than reused so this module does not import the
 * announcer, and copied exactly so no existing ETH cast changes wording.
 */
function formatEthTrimmed(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (!Number.isFinite(num)) return '0';
  return num.toFixed(4).replace(/\.?0+$/, '');
}

/**
 * Only the fields this needs, rather than a full row type. `getActiveRound()`
 * returns the narrower `Round` from ../types while the announcer holds a
 * Drizzle `RoundRow`; both satisfy this, so callers do not have to convert.
 */
export interface RoundPrizeInput {
  prizeCurrency?: string | null;
  prizePoolEth: string;
  prizePoolWord?: string | null;
  seedPriceE18?: string | null;
}

export interface RoundPrize {
  /** Prize with its unit, e.g. "0.0216 ETH" or "78,125,000 $WORD". */
  display: string;
  /** USD value as a decimal string, or null when it cannot be determined. */
  usd: string | null;
  currency: 'eth' | 'word';
}

/**
 * Read the live prize for a round and format it.
 *
 * Reads the contract that actually holds the round's money — WordJackpot for a
 * $WORD round, JackpotManagerV3 otherwise — and falls back to the matching
 * database column on RPC failure. The old code path fell back to
 * `prizePoolEth`, which is 0 on a $WORD round, so a failed read would have
 * quietly announced a zero prize rather than a stale one.
 */
export async function getRoundPrize(round: RoundPrizeInput): Promise<RoundPrize> {
  if (round.prizeCurrency === 'word') {
    let poolWei: bigint;
    try {
      const { getWordJackpotSolvency } = await import('./word-jackpot-contract');
      poolWei = (await getWordJackpotSolvency()).poolWei;
    } catch (err) {
      console.error('[round-prize] Failed to read WordJackpot pool, using database value:', err);
      try {
        poolWei = BigInt(round.prizePoolWord ?? '0');
      } catch {
        poolWei = 0n;
      }
    }

    const priceE18 = round.seedPriceE18 ? BigInt(round.seedPriceE18) : 0n;
    const usd =
      priceE18 > 0n ? (Number(usdCentsForTokens(poolWei, priceE18)) / 100).toFixed(2) : null;

    return {
      display: `${formatWordAmount(poolWei)} $WORD`,
      usd,
      currency: 'word',
    };
  }

  let eth: string;
  try {
    eth = formatEthTrimmed(await getCurrentJackpotOnChain());
  } catch (err) {
    console.error('[round-prize] Failed to read jackpot from contract, using database value:', err);
    eth = formatEthTrimmed(round.prizePoolEth);
  }

  // Deliberately not formatPrize: that pads to 4 decimals, and every existing
  // cast and notification renders "0.02 ETH" rather than "0.0200 ETH".
  return { display: `${eth} ETH`, usd: null, currency: 'eth' };
}

/**
 * Format one payout row in the round's currency.
 *
 * round_payouts.amount_eth is NULL on a $WORD round (migration 0022 dropped its
 * NOT NULL for exactly this reason) and amount_word carries the value. Reading
 * amountEth unconditionally gives parseFloat(null) = NaN, which reaches the
 * cast as the literal text "NaN ETH".
 */
export function formatPayoutAmount(
  row: { amountEth?: string | null; amountWord?: string | null },
  currency: 'eth' | 'word'
): string {
  if (currency === 'word') {
    try {
      return `${formatWordAmount(BigInt(row.amountWord ?? '0'))} $WORD`;
    } catch {
      return '0 $WORD';
    }
  }
  return `${formatEthTrimmed(row.amountEth ?? '0')} ETH`;
}

/**
 * Format the sum of several payout rows in the round's currency.
 *
 * $WORD is summed as bigint wei rather than through Number: a top-10 bucket is
 * ~1e25 wei, far past Number.MAX_SAFE_INTEGER, so float addition would quietly
 * lose precision at the low end of the total.
 */
export function formatPayoutTotal(
  rows: { amountEth?: string | null; amountWord?: string | null }[],
  currency: 'eth' | 'word'
): string {
  if (currency === 'word') {
    let total = 0n;
    for (const r of rows) {
      try {
        total += BigInt(r.amountWord ?? '0');
      } catch {
        // Skip an unparseable row rather than failing the whole announcement.
      }
    }
    return `${formatWordAmount(total)} $WORD`;
  }
  const total = rows.reduce((sum, r) => sum + (parseFloat(r.amountEth ?? '0') || 0), 0);
  return `${formatEthTrimmed(total)} ETH`;
}

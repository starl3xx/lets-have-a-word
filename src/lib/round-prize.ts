/**
 * The current prize for a round, formatted with its unit.
 *
 * Every outbound message that names a prize — casts, push notifications, share
 * text — needs the same three things: read the right SOURCE, fall back to the
 * right database column, and render the right unit. Doing that in each place is
 * how a $WORD round ends up announcing an ETH prize.
 *
 * There are two sources, and picking the wrong one is the whole reason this
 * module has three entry points rather than one:
 *
 *   getRoundPrize        reads the CONTRACT that holds the money. Correct at
 *                        round start only — see its note.
 *   getLivePoolPrize     the pool a player is looking at RIGHT NOW. This is
 *                        what every mid-round surface wants.
 *   getRoundPrizeFromRow the pool as the round row records it, no I/O. This is
 *                        what every post-resolve surface wants.
 *
 * Why they differ: JackpotManagerV3 takes an ETH purchase the moment it
 * happens, so for rounds 1-33 the contract IS the live pool. WordJackpot does
 * not. A $WORD round's pack and Superguess purchases grow rounds.prize_pool_word
 * in the database (word-pool-credits.ts) and reach the contract in ONE batched
 * top-up immediately before resolve (economics.ts). So from round 34 on, the
 * contract pool is frozen at the seed for the entire round and then paid out to
 * zero — reading it mid-round under-reports, and reading it after resolve
 * reports nothing at all.
 */

import { getCurrentJackpotOnChain } from './jackpot-contract';
import { formatWordAmount } from './word-amounts';
import { formatPrize, wordUsdValue } from './prize-display';

/**
 * Byte-for-byte the announcer's existing formatEth: 4 decimals, trailing zeros
 * stripped. Reproduced rather than reused so this module does not import the
 * announcer, and copied exactly so no existing ETH cast changes wording.
 *
 * Deliberately not prize-display's formatPrize for the ETH branch: that pads to
 * 4 decimals, and every existing cast and notification renders "0.02 ETH"
 * rather than "0.0200 ETH". The $WORD branches DO go through formatPrize, so
 * the unit and separators there match the app exactly.
 */
function formatEthTrimmed(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (!Number.isFinite(num)) return '0';
  return num.toFixed(4).replace(/\.?0+$/, '');
}

/**
 * Parse a $WORD wei column, logging rather than throwing.
 *
 * prize_pool_word and seed_price_e18 are both `numeric(78,0)`, so a value that
 * will not parse is a database problem, not a caller problem — and an
 * announcement that silently renders "0 $WORD" is the exact failure this module
 * exists to prevent. Falling back to 0 keeps the round resolving; the log line
 * is what tells an operator why the number was wrong.
 *
 * Exported so the announcer reads BOTH of its numeric columns through this one
 * parser. It had guarded prize_pool_word and left seed_price_e18 bare, which is
 * the kind of asymmetry that reads as an oversight; and it hand-rolled a second
 * copy of this try/catch rather than reusing it. `label` is free text so a
 * caller can name the round as well as the column.
 */
export function parseWordWei(value: string | null | undefined, label: string): bigint {
  try {
    return BigInt(value ?? '0');
  } catch {
    console.error(`[round-prize] Unparseable ${label} (${JSON.stringify(value)}) — treating as 0`);
    return 0n;
  }
}

/**
 * Only the fields this needs, rather than a full row type. `getActiveRound()`
 * returns the narrower `Round` from ../types while the announcer holds a
 * Drizzle `RoundRow`; both satisfy this, so callers do not have to convert.
 *
 * All four fields are required reading. `prizeCurrency` is optional in the
 * `Round` type, so a caller that rebuilds a round object and drops it hands a
 * $WORD round to the ETH branch without failing a typecheck — four bugs in one
 * day came from exactly that.
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
 * Render a $WORD pool. One place, so the three entry points below cannot drift
 * in separators, unit or USD rounding.
 *
 * The USD figure is valued at the round's SEED-time price snapshot, not a live
 * quote: an announcement is a permanent record of a moment, and re-reading the
 * oracle would make two messages about the same pool disagree.
 */
function renderWordPool(poolWei: bigint, seedPriceE18: string | null | undefined): RoundPrize {
  const pool = poolWei.toString();
  return {
    display: formatPrize({ currency: 'word', word: pool }),
    usd: wordUsdValue(pool, seedPriceE18),
    currency: 'word',
  };
}

/**
 * The prize exactly as the round row records it. No contract read, no I/O.
 *
 * Use this for anything that reports a pool AFTER resolution. The onchain
 * resolveRound pays the pool out, so a contract read at that point returns 0 —
 * round 34's resolved cast, push notification and tweet all announced that the
 * winner had won "the 0 $WORD jackpot" while the real figure sat in
 * prize_pool_word, written by economics.ts one statement earlier.
 *
 * For an ETH round this is the ETH-era behaviour restored, not a new one: the
 * resolved cast read prize_pool_eth from the row until the $WORD migration
 * moved it onto the contract. The row is trustworthy on both sides because the
 * resolve UPDATE in economics.ts now writes the pool back for BOTH currencies —
 * prize_pool_word for a $WORD round, prize_pool_eth for an ETH one — from the
 * same `jackpotWei` the payouts were computed from. Before that it wrote only
 * the $WORD column, and prize_pool_eth was otherwise synced from the contract
 * only when a PAID GUESS is consumed, so a pack bought and never spent left the
 * row below the pool that was paid out. Closing it in that UPDATE was the right
 * place, not a contract read here: this function runs after the payout, when
 * the contract holds nothing.
 */
export function getRoundPrizeFromRow(round: RoundPrizeInput): RoundPrize {
  if (round.prizeCurrency === 'word') {
    return renderWordPool(parseWordWei(round.prizePoolWord, 'prizePoolWord'), round.seedPriceE18);
  }
  return { display: `${formatEthTrimmed(round.prizePoolEth)} ETH`, usd: null, currency: 'eth' };
}

/**
 * The pool a player is looking at right now — the number the game screen shows.
 *
 * The currency branch lives here rather than at the call site so that a surface
 * asking "what is the prize right now" does not have to know which contract
 * settles when. For a $WORD round that is the database column, which is exactly
 * what /api/round-state serves to the app (wheel.ts). For ETH the contract is
 * still the live figure and prize_pool_eth is synced FROM it, so rounds 1-33
 * keep the read they have always had.
 */
export async function getLivePoolPrize(round: RoundPrizeInput): Promise<RoundPrize> {
  if (round.prizeCurrency === 'word') {
    return getRoundPrizeFromRow(round);
  }
  return getRoundPrize(round);
}

/**
 * Read the prize from the CONTRACT that holds it, falling back to the matching
 * database column on RPC failure.
 *
 * Correct for exactly one surface: the round-STARTED announcement. At that
 * moment the contract pool is the seed and nothing has been purchased yet, so
 * DB and contract agree — and reading the contract is what would catch a
 * seeding mismatch before the bot promises a prize the contract cannot pay.
 *
 * Anywhere else in a $WORD round it under-reports, because the contract does
 * not learn about pack and Superguess purchases until the flush before resolve.
 * Use getLivePoolPrize or getRoundPrizeFromRow instead.
 *
 * The fallback goes to the matching column per currency. The old code path fell
 * back to `prizePoolEth`, which is 0 on a $WORD round, so a failed read would
 * have quietly announced a zero prize rather than a stale one.
 */
export async function getRoundPrize(round: RoundPrizeInput): Promise<RoundPrize> {
  if (round.prizeCurrency === 'word') {
    let poolWei: bigint;
    try {
      const { getWordJackpotSolvency } = await import('./word-jackpot-contract');
      poolWei = (await getWordJackpotSolvency()).poolWei;
    } catch (err) {
      console.error('[round-prize] Failed to read WordJackpot pool, using database value:', err);
      poolWei = parseWordWei(round.prizePoolWord, 'prizePoolWord');
    }

    return renderWordPool(poolWei, round.seedPriceE18);
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

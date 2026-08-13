/**
 * Prize pool split — pure, currency-agnostic, no I/O.
 *
 * The 80/10/5/5 arithmetic extracted from `economics.ts` so the $WORD path can
 * reuse it rather than fork it. Forking it would mean two copies of the rule
 * that decides how a prize pool is divided, drifting apart the first time one
 * is edited.
 *
 * Nothing here knows about ETH or $WORD. Amounts are integer wei of whatever
 * 18-decimal asset the round is denominated in, and the seed cap is a
 * parameter rather than a constant — for ETH it is the fixed 0.02 ETH, for
 * $WORD it is an oracle-priced token amount that changes with the price.
 *
 * THE SPLIT
 *   80% winner
 *   10% top 10 guessers
 *    5% next-round seed
 *    5% referrer
 *
 * With no referrer that 5% is halved into the other two buckets, giving 12.5%
 * to the top 10 and 7.5% to the seed. Seed above the cap goes to the creator.
 */

/** Basis points, out of 10000. */
const WINNER_BPS = 8000n;
const TOP_GUESSERS_BPS = 1000n;
const SEED_BPS = 500n;
const REFERRER_BPS = 500n;

export interface PrizeSplitInput {
  jackpotWei: bigint;
  hasReferrer: boolean;
  /** Maximum that may be carried to the next round; excess goes to the creator. */
  seedCapWei: bigint;
}

export interface PrizeSplit {
  toWinnerWei: bigint;
  toTopGuessersWei: bigint;
  toReferrerWei: bigint;
  seedForNextRoundWei: bigint;
  toCreatorOverflowWei: bigint;
  seedWasCapped: boolean;
  /**
   * Remainder left by integer division. The five buckets are floors of exact
   * percentages, so they can sum to slightly less than the pool. The caller
   * adds this to the winner after building the payout array — the contract
   * requires the total to equal the pool exactly, so it cannot simply vanish.
   */
  dustWei: bigint;
}

/**
 * Divide a prize pool.
 *
 * The cap is applied in BOTH branches. The code this replaces applied it only
 * when there was no referrer, so a referred win could carry an unbounded seed.
 * That asymmetry never fired: across all 33 ETH rounds the largest seed
 * produced was 0.0141 ETH against a 0.02 cap, and the cap would only bind above
 * a 0.4 ETH pool with a referrer (0.267 ETH without) — against a historical
 * maximum pool of 0.188 ETH. So this is a no-op for every round the game has
 * played, and it closes the gap before $WORD pools have a chance to grow into
 * it, which is the entire point of the migration.
 */
export function computePrizeSplit({
  jackpotWei,
  hasReferrer,
  seedCapWei,
}: PrizeSplitInput): PrizeSplit {
  if (jackpotWei < 0n) {
    throw new Error(`Cannot split a negative pool: ${jackpotWei}`);
  }
  if (seedCapWei < 0n) {
    throw new Error(`Seed cap cannot be negative: ${seedCapWei}`);
  }

  const toWinnerWei = (jackpotWei * WINNER_BPS) / 10000n;
  const referrerShareWei = (jackpotWei * REFERRER_BPS) / 10000n;
  const baseSeedWei = (jackpotWei * SEED_BPS) / 10000n;

  let toTopGuessersWei = (jackpotWei * TOP_GUESSERS_BPS) / 10000n;
  let toReferrerWei = 0n;
  let uncappedSeedWei: bigint;

  if (hasReferrer) {
    toReferrerWei = referrerShareWei;
    uncappedSeedWei = baseSeedWei;
  } else {
    // The referrer's 5% is halved between the top 10 and the seed. Note this
    // halves the already-floored referrer share, matching the original.
    const halfReferrerShareWei = referrerShareWei / 2n;
    toTopGuessersWei += halfReferrerShareWei;
    uncappedSeedWei = baseSeedWei + halfReferrerShareWei;
  }

  const seedWasCapped = uncappedSeedWei > seedCapWei;
  const seedForNextRoundWei = seedWasCapped ? seedCapWei : uncappedSeedWei;
  const toCreatorOverflowWei = seedWasCapped ? uncappedSeedWei - seedCapWei : 0n;

  const allocatedWei =
    toWinnerWei +
    toTopGuessersWei +
    toReferrerWei +
    seedForNextRoundWei +
    toCreatorOverflowWei;

  return {
    toWinnerWei,
    toTopGuessersWei,
    toReferrerWei,
    seedForNextRoundWei,
    toCreatorOverflowWei,
    seedWasCapped,
    dustWei: jackpotWei - allocatedWei,
  };
}

/**
 * Rank weights for the top 10, in basis points of the top-10 bucket.
 * Sums to exactly 10000, so the bucket is fully distributed with no dust.
 */
export const TOP_TEN_BPS = [1900, 1600, 1400, 1100, 1000, 600, 600, 600, 600, 600] as const;

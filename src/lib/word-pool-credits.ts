/**
 * Crediting player purchases into a $WORD round's prize pool.
 *
 * Packs and Superguesses are bought with ETH, which goes to the treasury. 80%
 * of each purchase is credited to the prize pool in $WORD at the price in force
 * when it was bought; the remaining 20% is creator revenue. That is the same
 * 80/20 the ETH economy ran inside JackpotManagerV3 — what changed is that the
 * pool side now needs an explicit conversion, because the money arrives in one
 * asset and the prize is denominated in another.
 *
 * The treasury fronts the $WORD out of its pre-funded tranche and converts the
 * received ETH back to $WORD later (tracked in word_conversions). So the tranche
 * is working capital cycling rather than a subsidy draining down — with the
 * caveat that between crediting and converting, the treasury is short $WORD: if
 * the price rises in that window the same ETH buys back fewer tokens than were
 * paid out.
 */

import { db } from '../db';
import { rounds, wordPoolCredits, systemState } from '../db/schema';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { ethers } from 'ethers';

/**
 * The price and contract layers are imported inside the functions that need
 * them, not at module scope.
 *
 * economics.ts imports getUnflushedCreditTotal from here, and the test setup
 * imports economics.ts — so a static import would drag word-jackpot-contract
 * and prices into every test file's module graph before any vi.mock could
 * apply, and the real RPC clients would run. Keeping them dynamic also means a
 * pack bought on an ETH round never loads the $WORD contract layer at all.
 */

/** The pool's share of a purchase, in basis points. The rest is creator revenue. */
export const POOL_SHARE_BPS = 8000;

export type CreditSource = 'pack' | 'superguess';

export interface CreditWordPoolParams {
  roundId: number;
  source: CreditSource;
  /** `${txHash}:${logIndex}` — what makes the credit idempotent. */
  sourceRef: string;
  ethAmountWei: bigint;
}

export interface CreditResult {
  credited: boolean;
  /** Set when the credit landed or already existed. */
  wordAmountWei?: bigint;
  /** Why nothing was credited. Never a reason to fail the caller. */
  reason?: 'not_a_word_round' | 'already_credited' | 'no_price' | 'error';
}

/**
 * Credit a purchase to the round's prize pool.
 *
 * NEVER THROWS, AND NEVER REJECTS THE PURCHASE.
 *
 * By the time this runs the player has already paid — the transaction is
 * onchain and their guesses have been granted. A stale oracle or a dropped RPC
 * call at this point is the house's problem, not theirs, so every failure path
 * returns a reason and leaves the purchase intact. This is the exact opposite
 * of the seeding path, which refuses loudly on a stale price; the difference is
 * only that seeding runs *before* money moves and this runs after.
 *
 * The reconciliation for a missed credit is the ledger itself: a purchase with
 * no matching row is visible, and re-running is safe because `(source,
 * sourceRef)` is unique.
 */
export async function creditWordPool(params: CreditWordPoolParams): Promise<CreditResult> {
  const { roundId, source, sourceRef, ethAmountWei } = params;

  try {
    const [round] = await db
      .select({
        prizeCurrency: rounds.prizeCurrency,
        prizePoolWord: rounds.prizePoolWord,
        seedPriceE18: rounds.seedPriceE18,
      })
      .from(rounds)
      .where(eq(rounds.id, roundId))
      .limit(1);

    if (!round || round.prizeCurrency !== 'word') {
      // An ETH round's pool is the contract's balance; nothing to credit here.
      return { credited: false, reason: 'not_a_word_round' };
    }

    // Price the purchase. The contract's own price is preferred so that credits
    // and the round's seed are struck on the same basis — a credit priced from
    // a different source than the seed makes the pool a mix of two rates.
    const { getWordPriceOnChain } = await import('./word-jackpot-contract');
    const { getEthUsdPrice } = await import('./prices');

    let priceE18: bigint | null = null;
    let priceSource: 'contract' | 'round_seed' = 'contract';
    try {
      const onchain = await getWordPriceOnChain();
      if (onchain.priceE18 > 0n) priceE18 = onchain.priceE18;
    } catch {
      // Fall through to the round's snapshot.
    }
    if (priceE18 === null && round.seedPriceE18) {
      try {
        const snapshot = BigInt(round.seedPriceE18);
        if (snapshot > 0n) {
          priceE18 = snapshot;
          priceSource = 'round_seed';
        }
      } catch {
        // Leave null; handled below.
      }
    }

    const ethUsd = await getEthUsdPrice();

    if (priceE18 === null || !ethUsd || ethUsd <= 0) {
      // Recorded as a gap rather than silently dropped: the purchase stands,
      // and the missing row is what makes it findable later.
      console.error(
        `[word-pool-credits] No usable price for round ${roundId} (${source} ${sourceRef}) — ` +
          `purchase stands, credit deferred. wordPrice=${priceE18} ethUsd=${ethUsd}`
      );
      return { credited: false, reason: 'no_price' };
    }

    // ETH -> USD -> $WORD, all in integer arithmetic once the ETH/USD rate is
    // applied. priceE18 is USD-per-token scaled by 1e18, so tokens =
    // usdValue * 1e18 / priceE18, and the token result is itself in wei.
    const ethAmount = Number(ethers.formatEther(ethAmountWei));
    const usdValue = ethAmount * ethUsd;
    const usdScaled = BigInt(Math.round(usdValue * 1e18));
    const totalTokensWei = (usdScaled * 10n ** 18n) / priceE18;
    const wordAmountWei = (totalTokensWei * BigInt(POOL_SHARE_BPS)) / 10000n;

    if (wordAmountWei <= 0n) {
      return { credited: false, reason: 'no_price' };
    }

    // Insert first. If this conflicts, the purchase was already credited and
    // the pool must not move again — which is the whole point of the unique
    // key, since a retried webhook is indistinguishable from a real purchase
    // at every other layer.
    const inserted = await db
      .insert(wordPoolCredits)
      .values({
        roundId,
        source,
        sourceRef,
        ethAmountWei: ethAmountWei.toString(),
        wordAmountWei: wordAmountWei.toString(),
        priceE18: priceE18.toString(),
        priceSource,
        ethUsdPrice: ethUsd.toFixed(8),
      })
      .onConflictDoNothing()
      .returning();

    if (inserted.length === 0) {
      return { credited: false, reason: 'already_credited' };
    }

    // Grow the displayed pool. The contract does not learn about this until the
    // flush before resolve.
    await db
      .update(rounds)
      .set({
        prizePoolWord: sql`${rounds.prizePoolWord} + ${wordAmountWei.toString()}::numeric`,
      })
      .where(eq(rounds.id, roundId));

    // Creator's 20%, kept in ETH because that is the asset that actually
    // arrived. Recording it against the same balance the ETH economy used keeps
    // one number meaningful across both eras.
    const creatorEth = ethAmount * (1 - POOL_SHARE_BPS / 10000);
    if (creatorEth > 0) {
      const [state] = await db.select().from(systemState).limit(1);
      if (state) {
        await db
          .update(systemState)
          .set({
            creatorBalanceEth: (parseFloat(state.creatorBalanceEth) + creatorEth).toFixed(18),
            updatedAt: new Date(),
          })
          .where(eq(systemState.id, state.id));
      }
    }

    console.log(
      `[word-pool-credits] Round ${roundId}: credited ${ethers.formatUnits(wordAmountWei, 18)} $WORD ` +
        `from ${source} ${sourceRef} (${ethAmount} ETH @ $${ethUsd}, price source: ${priceSource})`
    );

    return { credited: true, wordAmountWei };
  } catch (error) {
    // Deliberately swallowed. See the note on this function.
    console.error(`[word-pool-credits] Failed to credit round ${roundId} (${source} ${sourceRef}):`, error);
    return { credited: false, reason: 'error' };
  }
}

/**
 * Total $WORD credited to this round that has not yet reached the contract.
 */
export async function getUnflushedCreditTotal(roundId: number): Promise<bigint> {
  const rows = await db
    .select({ wordAmountWei: wordPoolCredits.wordAmountWei })
    .from(wordPoolCredits)
    .where(and(eq(wordPoolCredits.roundId, roundId), isNull(wordPoolCredits.flushedAt)));

  return rows.reduce((sum, r) => sum + BigInt(r.wordAmountWei), 0n);
}

export interface FlushResult {
  flushed: boolean;
  amountWei: bigint;
  txHash?: string;
  creditCount: number;
}

/**
 * Push every unflushed credit for a round into WordJackpot in one transaction.
 *
 * Must run before the round resolves. resolveRound validates its payout sum
 * against the contract's currentPool, so a credit that never reached the
 * contract makes resolution revert — at the worst possible moment, with a
 * winner already found and waiting.
 *
 * Rows are marked flushed only after the transaction confirms. The failure this
 * leaves is a double top-up if the transaction lands but the marking write
 * fails, which is recoverable (the pool is over-funded, and the surplus is
 * visible against the ledger). The opposite ordering loses credits silently,
 * which is not.
 */
export async function flushWordPoolCredits(roundId: number): Promise<FlushResult> {
  const pending = await db
    .select({ id: wordPoolCredits.id, wordAmountWei: wordPoolCredits.wordAmountWei })
    .from(wordPoolCredits)
    .where(and(eq(wordPoolCredits.roundId, roundId), isNull(wordPoolCredits.flushedAt)));

  if (pending.length === 0) {
    return { flushed: true, amountWei: 0n, creditCount: 0 };
  }

  const total = pending.reduce((sum, r) => sum + BigInt(r.wordAmountWei), 0n);

  const { topUpWordPoolOnChain } = await import('./word-jackpot-contract');
  const txHash = await topUpWordPoolOnChain(total);

  await db
    .update(wordPoolCredits)
    .set({ flushedAt: new Date(), flushTxHash: txHash })
    .where(and(eq(wordPoolCredits.roundId, roundId), isNull(wordPoolCredits.flushedAt)));

  console.log(
    `[word-pool-credits] Flushed ${ethers.formatUnits(total, 18)} $WORD ` +
      `across ${pending.length} credits for round ${roundId} — tx ${txHash}`
  );

  return { flushed: true, amountWei: total, txHash, creditCount: pending.length };
}

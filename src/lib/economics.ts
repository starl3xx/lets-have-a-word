import { db } from '../db';
import { rounds, systemState, roundPayouts, guesses, users } from '../db/schema';
import { eq, and, desc, count, lte, isNotNull, sql } from 'drizzle-orm';
import type { RoundPayoutInsert } from '../db/schema';
import { announceRoundResolved, announceReferralWin } from './announcer';
import { archiveRound } from './archive';
import { awardTopTenGuesserXp } from './xp';
import { ethers } from 'ethers';
import {
  resolveRoundWithPayoutsOnChain,
  resolveRoundWithPayoutsOnSepolia,
  getCurrentJackpotOnChain,
  getCurrentJackpotOnChainWei,
  getCurrentJackpotOnSepolia,
  getCurrentJackpotOnSepoliaWei,
  getSepoliaContractBalance,
  getMainnetContractBalance,
  getContractConfig,
  type PayoutRecipient,
} from './jackpot-contract';
import { getBaseProvider } from './word-token';
import { getWinnerPayoutAddress, logWalletResolution } from './wallet-identity';
import { calculateTopGuesserPayouts, formatPayoutsForLog } from './top-guesser-payouts';
import { TOP10_LOCK_AFTER_GUESSES } from './top10-lock';
import { computePrizeSplit } from './prize-split';
import {
  getWordJackpotSolvency,
  resolveWordRoundOnChain,
  tokensForUsdCents,
  formatWordAmount,
} from './word-jackpot-contract';
import { getUnflushedCreditTotal, flushWordPoolCredits } from './word-pool-credits';
import { WORD_SEED_USD_CENTS } from '../../config/economy';

/**
 * How many rounds' worth of seed the $WORD carry may accumulate to.
 *
 * WordJackpot spends carry before drawing on the tranche, so a token carried
 * forward is a token the treasury does not have to supply — letting it build up
 * is directly good for runway. The cap only bounds it.
 */
export const WORD_SEED_CARRY_MULTIPLE = 10;

// Global flag for Sepolia simulation mode
// When true, contract queries use Sepolia RPC instead of mainnet
let sepoliaSimulationMode = false;

// Global flag to skip onchain resolution entirely
// When true, DB payouts are created but no onchain transaction is executed
// Use this when the contract state is inconsistent (e.g., jackpot > balance)
let skipOnchainResolutionFlag = false;

export function setSepoliaSimulationMode(enabled: boolean): void {
  sepoliaSimulationMode = enabled;
  console.log(`[economics] Sepolia simulation mode: ${enabled ? 'ENABLED' : 'DISABLED'}`);
}

export function isSepoliaSimulationMode(): boolean {
  return sepoliaSimulationMode;
}

export function setSkipOnchainResolution(skip: boolean): void {
  skipOnchainResolutionFlag = skip;
  console.log(`[economics] Skip onchain resolution: ${skip ? 'YES' : 'NO'}`);
}

export function isSkipOnchainResolution(): boolean {
  return skipOnchainResolutionFlag;
}

/**
 * Economics Module - Milestone 3.1
 * Milestone 6.9 - Onchain multi-recipient payouts
 * Updated Economics (January 2026) - New 80/10/5/5 split with seed
 *
 * Handles jackpot splits, seed accumulation, and payouts
 *
 * End-of-round distribution:
 * - 80% → jackpot winner
 * - 10% → Top 10 Early Guessers
 * - 5% → next round seed
 * - 5% → referrer (if exists)
 *
 * If no referrer:
 * - 2.5% of the 5% referrer allocation → Top 10 pool (total 12.5%)
 * - 2.5% of the 5% referrer allocation → seed (total 7.5%)
 * - Apply 0.02 ETH cap to seed
 * - Overflow beyond cap → creator
 */

// Seed cap: Maximum ETH that can accumulate as seed for next round
// This also serves as the creator pool withdrawal threshold
// Below this, funds prioritize seeding future rounds
export const SEED_CAP_ETH = 0.02; // 0.02 ETH
export const SEED_CAP_ETH_STRING = '0.02';
export const SEED_CAP_WEI = 20000000000000000n; // 0.02 ETH in wei

/**
 * Validate that payout amounts sum correctly before calling contract
 * The contract requires: sum(payouts) + seedForNextRound == currentJackpot
 *
 * Returns an error message if validation fails, null if valid
 */
export function validatePayoutMath(
  payouts: { amountWei: bigint }[],
  seedForNextRoundWei: bigint,
  jackpotWei: bigint
): { valid: boolean; error?: string; totalPayoutsWei: bigint; expectedWei: bigint; diffWei: bigint } {
  const totalPayoutsWei = payouts.reduce((sum, p) => sum + p.amountWei, 0n);
  const expectedWei = jackpotWei;
  const actualWei = totalPayoutsWei + seedForNextRoundWei;
  const diffWei = expectedWei - actualWei;

  console.log(`[economics] Payout validation:`);
  console.log(`  - Jackpot: ${ethers.formatEther(jackpotWei)} ETH (${jackpotWei} wei)`);
  console.log(`  - Sum of payouts: ${ethers.formatEther(totalPayoutsWei)} ETH (${totalPayoutsWei} wei)`);
  console.log(`  - Seed for next round: ${ethers.formatEther(seedForNextRoundWei)} ETH (${seedForNextRoundWei} wei)`);
  console.log(`  - Total (payouts + seed): ${ethers.formatEther(actualWei)} ETH (${actualWei} wei)`);
  console.log(`  - Difference: ${diffWei} wei`);

  if (diffWei === 0n) {
    console.log(`  ✅ Payout math is VALID`);
    return { valid: true, totalPayoutsWei, expectedWei, diffWei };
  } else if (diffWei > 0n && diffWei < 1000n) {
    // Small rounding error (< 1000 wei), this is acceptable and can be added to winner
    console.warn(`  ⚠️ Small rounding error of ${diffWei} wei - will be added to winner payout`);
    return { valid: true, totalPayoutsWei, expectedWei, diffWei };
  } else {
    console.error(`  ❌ Payout math INVALID: difference of ${diffWei} wei is too large!`);
    return {
      valid: false,
      error: `Payout sum (${actualWei} wei) does not equal jackpot (${jackpotWei} wei). Diff: ${diffWei} wei`,
      totalPayoutsWei,
      expectedWei,
      diffWei
    };
  }
}

/**
 * Sync the DB prize pool from the contract's current jackpot
 *
 * IMPORTANT: The contract is the single source of truth for prize pool balance.
 * Call this after any onchain operation that modifies the jackpot (seeding, purchases, etc.)
 *
 * @param roundId - The round ID to sync
 * @returns The synced prize pool amount in ETH
 */
export async function syncPrizePoolFromContract(roundId: number): Promise<string> {
  const [round] = await db
    .select({ prizePoolEth: rounds.prizePoolEth, prizeCurrency: rounds.prizeCurrency })
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .limit(1);

  if (!round) {
    throw new Error(`Round ${roundId} not found`);
  }

  // A $WORD round's prize lives in WordJackpot, not JackpotManagerV3. Reading
  // the ETH contract here and writing the result into prize_pool_eth stamps a
  // balance that was never this round's prize into a column the archive later
  // copies into the permanent record — and which the admin dashboards then sum
  // into their ETH totals. Refuse rather than write.
  //
  // Called at round creation (rounds.ts) and from the sync-prize-pool admin
  // endpoint, so the guard belongs here rather than at either call site: one
  // place cannot be forgotten when a third caller appears.
  if (round.prizeCurrency === 'word') {
    console.warn(
      `[economics] Round ${roundId} is a $WORD round — skipping ETH prize-pool sync. ` +
        `Its pool is held in WordJackpot; prize_pool_eth is left untouched.`
    );
    return round.prizePoolEth;
  }

  // Use Sepolia or mainnet based on simulation mode
  const contractJackpot = sepoliaSimulationMode
    ? await getCurrentJackpotOnSepolia()
    : await getCurrentJackpotOnChain();

  await db
    .update(rounds)
    .set({
      prizePoolEth: contractJackpot,
    })
    .where(eq(rounds.id, roundId));

  console.log(`[economics] Synced round ${roundId} prize pool from contract: ${contractJackpot} ETH`);
  return contractJackpot;
}

/**
 * Apply economic effects when a paid guess is made
 *
 * IMPORTANT: The contract is the single source of truth for prize pool balance.
 * This function syncs the DB to match the contract's current jackpot.
 *
 * Split logic (handled by contract):
 * - 80% goes to prize pool (P)
 * - 20% goes to creator profit (contract tracks this)
 *
 * DB-only logic (seed accumulation):
 * - We track seed for next round in DB
 * - If seed S < 0.02 ETH, portion of 20% goes to S
 *
 * @param roundId - The round ID
 * @param guessPriceEth - Price of the guess in ETH (as string)
 */
export async function applyPaidGuessEconomicEffects(
  roundId: number,
  guessPriceEth: string
): Promise<void> {
  const price = parseFloat(guessPriceEth);

  // The 20% portion for seed/creator calculation
  const toSeedOrCreator = price * 0.2;

  // Get current round
  const [round] = await db
    .select()
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .limit(1);

  if (!round) {
    throw new Error(`Round ${roundId} not found`);
  }

  // EVERYTHING BELOW IS THE ETH ECONOMY. A $WORD round must not enter it.
  //
  // This function models JackpotManagerV3: ETH arrives via purchaseGuesses,
  // 80% lands in the contract's jackpot and 20% is split between the DB-tracked
  // seed and creator balance. None of that describes a $WORD round. There the
  // pack is still paid in ETH, but it goes to WordPackSales and straight on to
  // the treasury, while the prize sits in WordJackpot as tokens.
  //
  // Left unguarded this was the worst bug in the migration, because it needed
  // nobody to do anything wrong: the three call sites in guesses.ts branch only
  // on `isPaidGuess`, so the first pack purchase of round 34 would read the old
  // ETH contract's balance and write it into prize_pool_eth. The column starts
  // at '0' (rounds.ts), which reads as an obvious bug, and then quietly heals
  // into a plausible non-zero ETH figure that was never that round's prize —
  // which archive.ts copies into the permanent archive and the admin economics
  // aggregates sum into their ETH totals.
  //
  // Growing a $WORD pool as packs sell is a separate question, not an omission
  // here. It needs decisions this function cannot make — which tranche funds
  // it, at what oracle price, and whether the pool should move between resolves
  // at all — and the onchain half already exists as topUpWordPoolOnChain().
  // Until that is designed, doing nothing is correct: the pool is whatever
  // WordJackpot says it is.
  if (round.prizeCurrency === 'word') {
    console.log(
      `[economics] Round ${roundId} is a $WORD round — no ETH economics applied. ` +
        `Pack revenue goes to WordPackSales; the prize pool is held in WordJackpot.`
    );
    return;
  }

  // CRITICAL: Sync prize pool from contract (single source of truth)
  // Use Sepolia or mainnet based on simulation mode
  let newPrizePool: string;
  try {
    newPrizePool = sepoliaSimulationMode
      ? await getCurrentJackpotOnSepolia()
      : await getCurrentJackpotOnChain();
    console.log(`[economics] Synced prize pool from contract${sepoliaSimulationMode ? ' (Sepolia)' : ''}: ${newPrizePool} ETH`);
  } catch (error) {
    // Fallback to local calculation if contract query fails
    console.warn(`[economics] Failed to sync from contract, using local calculation:`, error);
    const toPrizePool = price * 0.8;
    newPrizePool = (parseFloat(round.prizePoolEth) + toPrizePool).toFixed(18);
  }

  // Get or create system state
  let [state] = await db.select().from(systemState).limit(1);

  if (!state) {
    // Create initial system state if it doesn't exist
    const [newState] = await db
      .insert(systemState)
      .values({
        creatorBalanceEth: '0',
      })
      .returning();
    state = newState;
  }

  // Calculate seed update (DB-only concept, not in contract)
  const currentSeed = parseFloat(round.seedNextRoundEth);
  const seedCap = SEED_CAP_ETH;

  let newSeed = currentSeed;
  let toCreator = 0;

  if (currentSeed < seedCap) {
    // Seed has room to grow
    const seedRoom = seedCap - currentSeed;
    const toSeed = Math.min(toSeedOrCreator, seedRoom);
    newSeed = currentSeed + toSeed;
    toCreator = toSeedOrCreator - toSeed;
  } else {
    // Seed is at cap, all goes to creator
    toCreator = toSeedOrCreator;
  }

  // Update round with synced prize pool and calculated seed
  await db
    .update(rounds)
    .set({
      prizePoolEth: newPrizePool,
      seedNextRoundEth: newSeed.toFixed(18),
    })
    .where(eq(rounds.id, roundId));

  // Update creator balance if needed (DB tracking for display)
  if (toCreator > 0) {
    const newCreatorBalance = parseFloat(state.creatorBalanceEth) + toCreator;
    await db
      .update(systemState)
      .set({
        creatorBalanceEth: newCreatorBalance.toFixed(18),
        updatedAt: new Date(),
      })
      .where(eq(systemState.id, state.id));
  }

  console.log(`✅ Applied paid guess economics for round ${roundId}:
  - Prize pool (from contract): ${newPrizePool} ETH
  - Seed: ${round.seedNextRoundEth} → ${newSeed.toFixed(18)}
  - Creator balance: ${state.creatorBalanceEth} → ${(parseFloat(state.creatorBalanceEth) + toCreator).toFixed(18)}`);
}

/**
 * Allocate unused referrer share to seed and creator
 * Milestone 4.9: When winner has no referrer, the 10% referrer share
 * is allocated to next-round seed (up to cap) and creator wallet (overflow)
 *
 * @param roundId - The round ID
 * @param amountEth - Amount in ETH to allocate
 */
async function allocateToSeedAndCreator(
  roundId: number,
  amountEth: number
): Promise<void> {
  if (amountEth <= 0) return;

  // Get current round
  const [round] = await db
    .select()
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .limit(1);

  if (!round) {
    throw new Error(`Round ${roundId} not found`);
  }

  // Calculate how much can go to seed
  const seedCap = SEED_CAP_ETH;
  const currentSeed = parseFloat(round.seedNextRoundEth);
  const missing = Math.max(0, seedCap - currentSeed);
  const toSeed = Math.min(missing, amountEth);
  const toCreator = amountEth - toSeed;

  // Allocate to seed if there's room
  if (toSeed > 0) {
    const newSeed = currentSeed + toSeed;
    await db
      .update(rounds)
      .set({
        seedNextRoundEth: newSeed.toFixed(18),
      })
      .where(eq(rounds.id, roundId));

    // Create payout record for analytics
    await db.insert(roundPayouts).values({
      roundId,
      fid: null,
      amountEth: toSeed.toFixed(18),
      role: 'seed',
    });

    console.log(`  → Seed: ${toSeed.toFixed(18)} ETH (new total: ${newSeed.toFixed(18)} ETH)`);
  }

  // Allocate overflow to creator
  if (toCreator > 0) {
    // Get or create system state
    let [state] = await db.select().from(systemState).limit(1);

    if (!state) {
      const [newState] = await db
        .insert(systemState)
        .values({
          creatorBalanceEth: '0',
        })
        .returning();
      state = newState;
    }

    const newCreatorBalance = parseFloat(state.creatorBalanceEth) + toCreator;
    await db
      .update(systemState)
      .set({
        creatorBalanceEth: newCreatorBalance.toFixed(18),
        updatedAt: new Date(),
      })
      .where(eq(systemState.id, state.id));

    // Create payout record for analytics
    await db.insert(roundPayouts).values({
      roundId,
      fid: null,
      amountEth: toCreator.toFixed(18),
      role: 'creator',
    });

    console.log(`  → Creator: ${toCreator.toFixed(18)} ETH (new balance: ${newCreatorBalance.toFixed(18)} ETH)`);
  }
}

/**
 * Resolve round and create payouts (Milestone 6.9 - Onchain multi-recipient)
 * Updated Economics (January 2026) - New 80/10/5/5 split
 *
 * Jackpot split:
 * - 80% to winner (always)
 * - 10% to top 10 guessers (always)
 * - 5% to next round seed (always)
 * - 5% to referrer (if exists)
 *
 * If winner has NO referrer:
 * - 5% referrer allocation redirects to next round seed
 * - Total seed = 10% (5% base + 5% from referrer fallback)
 * - Seed cap: 0.02 ETH
 * - Any overflow beyond cap routes to creator
 *
 * Top 10 ranking:
 * - By total guess count (volume) - ALL guesses count (free + paid)
 * - Tiebreaker: earliest first guess time
 *
 * @param roundId - The round ID
 * @param winnerFid - The FID of the winner
 */
export async function resolveRoundAndCreatePayouts(
  roundId: number,
  winnerFid: number
): Promise<void> {
  // Get round
  const [round] = await db
    .select()
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .limit(1);

  if (!round) {
    throw new Error(`Round ${roundId} not found`);
  }

  if (round.resolvedAt) {
    console.log(`⚠️  Round ${roundId} already resolved`);
    return;
  }

  // Which contract holds this round's prize. Read from the ROUND, never from
  // global config: a round must resolve in the currency it was seeded in, so
  // flipping the env var mid-round cannot strand a live prize in the contract
  // the resolver stopped looking at.
  const isWordRound = round.prizeCurrency === 'word';

  // CRITICAL: Use actual contract balance for payouts, not DB value
  // This prevents payout failures when DB and contract are out of sync
  // Use Sepolia or mainnet based on simulation mode
  let jackpotEth: number;
  let jackpotWei: bigint;

  if (isWordRound) {
    // Every purchase credit must have reached the contract before we compute a
    // payout, because the payout is validated against the contract's pool.
    //
    // Pack and Superguess credits accumulate in the database and reach
    // WordJackpot in one batched top-up, so that buying a pack never waits on a
    // transaction. The cost of that choice is this window: between a purchase
    // and the flush, the pool players can see is larger than the pool the
    // contract will pay from.
    //
    // Refusing here converts the failure from a revert during payout — with a
    // winner already found, the round already announced, and the operator
    // improvising — into a refusal beforehand that names the missing amount.
    // Same outage, vastly better moment to have it.
    // Flush first, then verify. Nothing else calls this — a round that sold a
    // pack would otherwise refuse to resolve forever, since the credits it is
    // waiting on have no other route to the contract.
    //
    // The check below is not made redundant by the flush: it is what happens
    // when the flush fails. Attempting the send and then asserting it worked is
    // the whole point — a refusal here names the outstanding amount, whereas
    // proceeding on the assumption that the flush succeeded produces a reverted
    // payout with a winner already found.
    try {
      const flush = await flushWordPoolCredits(roundId);
      if (flush.creditCount > 0) {
        console.log(
          `[economics] Flushed ${formatWordAmount(flush.amountWei)} $WORD of purchase credits ` +
            `for round ${roundId} before resolving — tx ${flush.txHash}`
        );
      }
    } catch (error) {
      console.error(`[economics] Credit flush failed for round ${roundId}:`, error);
      // Deliberately swallowed: the check below turns this into a refusal that
      // states the amount, which is more useful than this stack trace.
    }

    const unflushed = await getUnflushedCreditTotal(roundId);
    if (unflushed > 0n) {
      throw new Error(
        `Cannot resolve round ${roundId}: ${formatWordAmount(unflushed)} $WORD of purchase ` +
          `credits have not reached WordJackpot. Flush them first — resolving now would ` +
          `compute payouts against a pool the contract does not have.`
      );
    }

    // WordJackpot tracks `pool` explicitly rather than inferring it from
    // balanceOf, so there is no balance-vs-internal reconciliation to do here —
    // that entire class of mismatch is designed out. The pool IS the number the
    // contract will validate the payout sum against.
    const solvency = await getWordJackpotSolvency();
    jackpotWei = solvency.poolWei;
    jackpotEth = 0;

    console.log(`[economics] WordJackpot state for round ${roundId}:`);
    console.log(`  - Pool: ${formatWordAmount(jackpotWei)} $WORD`);
    console.log(`  - Carry (already reserved): ${formatWordAmount(solvency.carryWei)} $WORD`);
    console.log(`  - Unallocated tranche: ${formatWordAmount(solvency.unallocatedWei)} $WORD`);
  } else if (skipOnchainResolutionFlag) {
    // No onchain call is going to happen, so there is no contract figure to
    // match and the database value is the only one that exists.
    //
    // The read below deliberately refuses to fall back to the DB, because a
    // value that disagrees with the contract's internal jackpot makes
    // resolveRoundWithPayouts revert with CALL_EXCEPTION. That reasoning does
    // not apply when the transaction is skipped entirely — and requiring a
    // reachable contract to compute payouts we are not sending is what made
    // this path untestable.
    jackpotWei = ethers.parseEther(round.prizePoolEth || '0');
    jackpotEth = parseFloat(round.prizePoolEth || '0');
    console.log(
      `[economics] Onchain resolution skipped — using DB prize pool ${jackpotEth} ETH`
    );
  } else {
  try {
    if (sepoliaSimulationMode) {
      // For Sepolia: MUST use internal jackpot for payout calculations
      // The contract validates: sum(payouts) + seed == currentJackpot
      // CRITICAL: Use raw wei value to avoid precision loss from ETH string round-trip
      const contractBalance = await getSepoliaContractBalance();
      const internalJackpotWei = await getCurrentJackpotOnSepoliaWei();
      const internalJackpotEth = ethers.formatEther(internalJackpotWei);

      console.log(`[economics] Sepolia contract state:`);
      console.log(`  - Internal jackpot: ${internalJackpotEth} ETH (${internalJackpotWei} wei)`);
      console.log(`  - Actual balance: ${contractBalance} ETH`);

      const balanceWei = ethers.parseEther(contractBalance);

      if (balanceWei < internalJackpotWei) {
        // WARNING: Contract has less ETH than its internal jackpot tracks
        // This means previous resolutions failed and left the contract in bad state
        console.error(`[economics] ❌ CRITICAL: Balance (${contractBalance} ETH) < Internal jackpot (${internalJackpotEth} ETH)`);
        console.error(`[economics] The contract cannot pay out. Use "Clear Sepolia Round" in admin to reset.`);
        throw new Error(`Sepolia contract state error: balance (${contractBalance} ETH) < internal jackpot (${internalJackpotEth} ETH). Clear the round in admin dashboard.`);
      }

      // Use raw wei value - this is EXACTLY what the contract has
      jackpotEth = parseFloat(internalJackpotEth);
      jackpotWei = internalJackpotWei;
    } else {
      // For mainnet: verify contract balance >= internal jackpot to prevent CALL_EXCEPTION
      // CRITICAL: Use raw wei value to avoid precision loss from ETH string round-trip
      const contractBalance = await getMainnetContractBalance();
      const internalJackpotWei = await getCurrentJackpotOnChainWei();
      const internalJackpotEth = ethers.formatEther(internalJackpotWei);

      console.log(`[economics] Mainnet contract state:`);
      console.log(`  - Internal jackpot: ${internalJackpotEth} ETH (${internalJackpotWei} wei)`);
      console.log(`  - Actual balance: ${contractBalance} ETH`);

      const balanceWei = ethers.parseEther(contractBalance);

      if (balanceWei < internalJackpotWei) {
        // CRITICAL: Balance is less than internal jackpot - this would cause CALL_EXCEPTION
        console.error(`[economics] ❌ CRITICAL: Contract balance (${contractBalance} ETH) is less than internal jackpot (${internalJackpotEth} ETH)`);
        console.error(`[economics] This indicates a serious contract state inconsistency. Aborting payout to prevent loss.`);
        throw new Error(`Contract balance (${contractBalance} ETH) is less than internal jackpot (${internalJackpotEth} ETH). Cannot safely execute payouts.`);
      }

      // Use raw wei value - this is EXACTLY what the contract has
      jackpotEth = parseFloat(internalJackpotEth);
      jackpotWei = internalJackpotWei;
    }

    const dbJackpotEth = parseFloat(round.prizePoolEth);
    if (Math.abs(jackpotEth - dbJackpotEth) > 0.0001) {
      console.warn(`[economics] ⚠️ Jackpot mismatch: DB=${dbJackpotEth} ETH, Contract${sepoliaSimulationMode ? ' (Sepolia)' : ''}=${jackpotEth} ETH`);
      console.warn(`[economics] Using contract balance for payouts to prevent CALL_EXCEPTION`);
    }
  } catch (error) {
    // CRITICAL: Do NOT fall back to DB value for payouts!
    // Using a DB value that doesn't match contract's internal jackpot exactly
    // will cause resolution to fail with CALL_EXCEPTION.
    // Better to fail fast here with a clear error than to attempt resolution
    // with potentially incorrect values.
    console.error(`[economics] ❌ CRITICAL: Failed to query contract jackpot:`, error);
    console.error(`[economics] Cannot safely compute payouts without current contract state.`);
    throw new Error(`Failed to query contract jackpot. Cannot compute payouts safely. Please check RPC connectivity.`);
  }
  }

  // ETH keeps its float check so behaviour is unchanged; the token round tests
  // the exact wei, since a $WORD pool has no meaningful float representation.
  if (isWordRound ? jackpotWei === 0n : jackpotEth === 0) {
    console.log(`⚠️  Round ${roundId} has zero jackpot, no payouts created`);

    // Still close the round. This used to return here outright, which skipped
    // the update at the end of this function that records the winner and marks
    // the round resolved — so a round won while its pool was empty stayed
    // `active` with a null `winnerFid` forever. Everything downstream keys off
    // that: getActiveRound kept handing back a finished round, resolveRound's
    // already-resolved guard never fired so it could be run again and again,
    // and no new round could start because one was still active. A pool can be
    // empty in normal play — the seed carries nothing and the winner spends a
    // free guess before anyone buys a pack — so this was reachable without
    // anything else going wrong.
    //
    // There are no payouts to make, only the round to close. The referrer is
    // still recorded: who referred the winner is a fact about the round, not
    // about whether there was a share to pay them, and the archive reads it.
    const [zeroPoolWinner] = await db
      .select({ referrerFid: users.referrerFid })
      .from(users)
      .where(eq(users.fid, winnerFid))
      .limit(1);

    await db
      .update(rounds)
      .set({
        resolvedAt: new Date(),
        winnerFid,
        referrerFid: zeroPoolWinner?.referrerFid ?? null,
        status: 'resolved',
      })
      .where(eq(rounds.id, roundId));

    return;
  }

  // Get winner's referrer
  const [winner] = await db
    .select()
    .from(users)
    .where(eq(users.fid, winnerFid))
    .limit(1);

  let referrerFid = winner?.referrerFid || null;

  // Reward gate: a referrer must pass the same bar as everyone earning money.
  // An ineligible referrer is treated exactly like no referrer — the 5%
  // redirects 2.5/2.5 to the Top 10 and the seed, the established split.
  if (referrerFid !== null) {
    const { checkPlayEligibility, isRewardGateEnabled } = await import('./reward-gate');
    if (isRewardGateEnabled()) {
      // claimWallet off: a payout is not a new play (same rule as Top 10)
      const gate = await checkPlayEligibility(referrerFid, {
        round,
        useCache: false,
        claimWallet: false,
      });
      if (!gate.eligible) {
        console.warn(
          `🚧 [RewardGate] Referrer ${referrerFid} below the bar at resolve (${gate.reason}); redirecting the referrer share`
        );
        referrerFid = null;
      }
    }
  }

  const hasReferrer = referrerFid !== null;

  // ============================================================================
  // NEW ECONOMICS (January 2026): 80/10/5/5 split with seed cap
  // ============================================================================
  // Base splits (always apply):
  // - 80% → winner
  // - 10% → top 10 guessers
  // - 5% → next round seed
  // - 5% → referrer (if exists)
  //
  // If no referrer, the 5% is split:
  // - 2.5% → added to top 10 guessers (total 12.5%)
  // - 2.5% → added to seed (total 7.5%, with cap)
  //
  // Seed cap logic:
  // - Seed is capped at 0.02 ETH
  // - Any overflow beyond cap routes to creator
  // ============================================================================

  // The $WORD cap is oracle-priced rather than constant: carry is capped at
  // WORD_SEED_CARRY_MULTIPLE rounds' worth of seed at the round's own seed
  // price. Letting carry accumulate is deliberate — WordJackpot spends carry
  // before drawing on the tranche, so every token carried forward is a token
  // the treasury does not have to supply. The multiple exists only to bound it.
  let seedCapWei = SEED_CAP_WEI;
  if (isWordRound) {
    const priceE18 = round.seedPriceE18 ? BigInt(round.seedPriceE18) : 0n;
    if (priceE18 > 0n) {
      seedCapWei =
        tokensForUsdCents(BigInt(WORD_SEED_USD_CENTS), priceE18) *
        BigInt(WORD_SEED_CARRY_MULTIPLE);
    } else {
      // No price snapshot means the round predates the column or was seeded
      // outside the normal path. Capping at zero would silently divert the
      // whole carry to the creator, so leave it uncapped and say so.
      seedCapWei = jackpotWei;
      console.warn(
        `[economics] Round ${roundId} has no seed_price_e18 — carrying the full seed uncapped`
      );
    }
  }

  // The arithmetic itself lives in prize-split.ts: it is currency-agnostic, so
  // the $WORD path reuses it rather than forking a second copy of the rule that
  // decides how a prize pool is divided.
  const split = computePrizeSplit({
    jackpotWei,
    hasReferrer,
    seedCapWei,
  });

  /**
   * Amount columns for a payout row. The ETH columns are numeric(20,18) and
   * physically cannot hold a ~78M-token amount, which is why migration 0022
   * added parallel ones rather than reusing them.
   */
  const payoutAmount = (wei: bigint) =>
    isWordRound
      ? { amountWord: wei.toString(), currency: 'word' }
      : { amountEth: ethers.formatEther(wei), currency: 'eth' };

  const toWinnerWei = split.toWinnerWei;
  const toTopGuessersWei = split.toTopGuessersWei;
  const toReferrerWei = split.toReferrerWei;
  const seedForNextRoundWei = split.seedForNextRoundWei;
  const toCreatorOverflowWei = split.toCreatorOverflowWei;

  if (split.seedWasCapped) {
    console.log(`[economics] Seed capped at ${ethers.formatEther(SEED_CAP_WEI)} ETH, overflow ${ethers.formatEther(toCreatorOverflowWei)} ETH → creator`);
  }

  // Note: For Sepolia simulation, seed is handled by the contract.

  // Get top 10 guessers (FIDs)
  const topGuesserFids = await getTop10Guessers(roundId, winnerFid);

  // Build onchain payout recipients
  const onChainPayouts: PayoutRecipient[] = [];
  const dbPayouts: RoundPayoutInsert[] = [];

  // 1. Winner payout (80%)
  const winnerWallet = await getWinnerPayoutAddress(winnerFid);
  logWalletResolution('PAYOUT', winnerFid, winnerWallet);
  onChainPayouts.push({
    address: winnerWallet,
    amountWei: toWinnerWei,
    role: 'winner',
    fid: winnerFid,
  });
  dbPayouts.push({
    roundId,
    fid: winnerFid,
    walletAddress: winnerWallet,
    ...payoutAmount(toWinnerWei),
    role: 'winner',
  });

  // 2. Referrer payout (5% if exists)
  if (hasReferrer && referrerFid) {
    const referrerWallet = await getWinnerPayoutAddress(referrerFid);
    logWalletResolution('PAYOUT', referrerFid, referrerWallet);
    onChainPayouts.push({
      address: referrerWallet,
      amountWei: toReferrerWei,
      role: 'referrer',
      fid: referrerFid,
    });
    dbPayouts.push({
      roundId,
      fid: referrerFid,
      walletAddress: referrerWallet,
      ...payoutAmount(toReferrerWei),
      role: 'referrer',
    });
  }

  // 3. Top guessers payouts (tiered distribution - Milestone 6.9b)
  if (topGuesserFids.length > 0) {
    // Resolve wallet addresses for all top guessers
    const guesserWallets: { fid: number; wallet: string }[] = [];
    for (const fid of topGuesserFids) {
      const wallet = await getWinnerPayoutAddress(fid);
      logWalletResolution('PAYOUT', fid, wallet);
      guesserWallets.push({ fid, wallet });
    }

    // Calculate tiered payouts using the new system
    const tieredPayouts = calculateTopGuesserPayouts(
      guesserWallets.map(g => g.wallet),
      toTopGuessersWei
    );

    console.log(`[economics] Tiered top-guesser distribution:\n${formatPayoutsForLog(tieredPayouts)}`);

    // Add to onchain and DB payouts
    for (let i = 0; i < tieredPayouts.length; i++) {
      const { amountWei } = tieredPayouts[i];
      const { fid, wallet } = guesserWallets[i];
      onChainPayouts.push({
        address: wallet,
        amountWei,
        role: 'top_guesser',
        fid,
      });
      dbPayouts.push({
        roundId,
        fid,
        walletAddress: wallet,
        ...payoutAmount(amountWei),
        role: 'top_guesser',
      });
    }
  } else {
    // No other guessers, winner gets this too
    // Add to winner's existing payout by creating separate entry
    dbPayouts.push({
      roundId,
      fid: winnerFid,
      walletAddress: winnerWallet,
      ...payoutAmount(toTopGuessersWei),
      role: 'top_guesser',
    });
    // Update winner's onchain payout
    onChainPayouts[0].amountWei += toTopGuessersWei;
  }

  // 4. Add seed record (always 5% base, up to 10% if no referrer, capped at 0.02 ETH)
  if (seedForNextRoundWei > 0n) {
    dbPayouts.push({
      roundId,
      fid: null,
      ...payoutAmount(seedForNextRoundWei),
      role: 'seed',
    });
  }

  // 5. Add creator overflow if seed cap was hit (onchain payout + DB record)
  if (toCreatorOverflowWei > 0n) {
    // Add onchain payout to creator wallet (ensures sum(payouts) + seed == jackpot)
    const creatorWallet = process.env.CREATOR_PROFIT_WALLET || '0x3Cee630075DC586D5BFdFA81F3a2d77980F0d223';
    onChainPayouts.push({
      address: creatorWallet,
      amountWei: toCreatorOverflowWei,
      role: 'creator',
      fid: undefined,
    });

    // Add DB record for analytics
    dbPayouts.push({
      roundId,
      fid: null,
      walletAddress: creatorWallet,
      ...payoutAmount(toCreatorOverflowWei),
      role: 'creator',
    });

    // Also update system state creator balance
    let [state] = await db.select().from(systemState).limit(1);
    if (!state) {
      const [newState] = await db
        .insert(systemState)
        .values({ creatorBalanceEth: '0' })
        .returning();
      state = newState;
    }
    const newCreatorBalance = parseFloat(state.creatorBalanceEth) + parseFloat(ethers.formatEther(toCreatorOverflowWei));
    await db
      .update(systemState)
      .set({
        creatorBalanceEth: newCreatorBalance.toFixed(18),
        updatedAt: new Date(),
      })
      .where(eq(systemState.id, state.id));
  }

  // Log payout breakdown
  console.log(`[economics] Resolving round ${roundId} with onchain payouts:`);
  console.log(`  - Jackpot: ${jackpotEth} ETH`);
  console.log(`  - Winner (80%): ${ethers.formatEther(onChainPayouts[0].amountWei)} ETH`);
  if (hasReferrer) {
    console.log(`  - Top guessers (10%): ${ethers.formatEther(toTopGuessersWei)} ETH tiered among ${topGuesserFids.length || 1}`);
    console.log(`  - Referrer (5%): ${ethers.formatEther(toReferrerWei)} ETH`);
    console.log(`  - Seed for next round (5%): ${ethers.formatEther(seedForNextRoundWei)} ETH`);
  } else {
    console.log(`  - Top guessers (12.5%): ${ethers.formatEther(toTopGuessersWei)} ETH tiered among ${topGuesserFids.length || 1}`);
    const seedPercent = split.seedWasCapped ? 'capped' : '7.5%';
    console.log(`  - Seed for next round (${seedPercent}): ${ethers.formatEther(seedForNextRoundWei)} ETH`);
    if (toCreatorOverflowWei > 0n) {
      console.log(`  - Creator overflow: ${ethers.formatEther(toCreatorOverflowWei)} ETH (seed cap exceeded)`);
    }
  }

  // CRITICAL: Validate all payout addresses before calling contract
  // Invalid addresses will cause CALL_EXCEPTION on the contract
  console.log(`[economics] Validating ${onChainPayouts.length} payout addresses...`);
  for (const payout of onChainPayouts) {
    if (!ethers.isAddress(payout.address)) {
      console.error(`[economics] ❌ Invalid address for ${payout.role} (FID ${payout.fid}): "${payout.address}"`);
      throw new Error(`Invalid payout address for ${payout.role}: "${payout.address}" is not a valid Ethereum address`);
    }
    // Also check for precompile addresses (0x01-0x09)
    const addrLower = payout.address.toLowerCase();
    if (/^0x0+[1-9]$/.test(addrLower)) {
      console.error(`[economics] ❌ Precompile address for ${payout.role} (FID ${payout.fid}): "${payout.address}"`);
      throw new Error(`Precompile address for ${payout.role}: "${payout.address}" cannot receive ETH`);
    }
    console.log(`  ✓ ${payout.role} (FID ${payout.fid}): ${payout.address}`);
  }

  // Pre-flight ETH receive check: simulate sending 1 wei to each recipient
  // Contracts with reverting receive() functions will brick resolution (Pashov audit finding)
  //
  // Skipped entirely for $WORD, for two independent reasons. An ERC-20 transfer
  // never invokes the recipient's receive(), so the simulation tests a property
  // that has no bearing on whether the payout lands. And WordJackpot credits a
  // failed transfer to claimable() rather than reverting the batch, so one bad
  // recipient can no longer strand everyone else — which is the only thing this
  // check was protecting against. Its remedy was also worse than the problem:
  // it silently redirected a player's prize to the operator wallet.
  if (!isWordRound && !sepoliaSimulationMode && !skipOnchainResolutionFlag) {
    const provider = getBaseProvider();
    const config = getContractConfig();
    console.log(`[economics] Pre-flight ETH receive check for ${onChainPayouts.length} recipients...`);
    for (const payout of onChainPayouts) {
      try {
        await provider.call({
          to: payout.address,
          value: 1n, // 1 wei simulation
        });
      } catch (err: any) {
        // Distinguish revert errors (contract can't accept ETH) from transient RPC failures
        const errMsg = err?.message || String(err);
        const isRevert = errMsg.includes('CALL_EXCEPTION') || errMsg.includes('revert') || errMsg.includes('execution reverted');
        if (isRevert) {
          console.error(`[economics] ⚠️ Recipient ${payout.address} (${payout.role}, FID ${payout.fid}) cannot accept ETH — substituting operator wallet. Error: ${errMsg}`);
          payout.originalAddress = payout.address;
          payout.address = config.operatorWallet;
        } else {
          // RPC timeout/network error — don't redirect, log and continue (will fail at resolution if truly broken)
          console.warn(`[economics] ⚠️ Pre-flight check RPC error for ${payout.address} (${payout.role}, FID ${payout.fid}) — skipping check (not a revert). Error: ${errMsg}`);
        }
      }
    }
    // Log any substitutions for manual follow-up
    const substitutions = onChainPayouts.filter(p => p.originalAddress);
    if (substitutions.length > 0) {
      console.warn(`[economics] ⚠️ ${substitutions.length} recipient(s) substituted with operator wallet:`);
      for (const sub of substitutions) {
        console.warn(`  - ${sub.role} (FID ${sub.fid}): ${sub.originalAddress} → ${sub.address}`);
      }
    }
  }

  // CRITICAL: Validate payout math before calling contract
  // The contract requires: sum(payouts) + seedForNextRound == currentJackpot
  const validation = validatePayoutMath(onChainPayouts, seedForNextRoundWei, jackpotWei);
  if (!validation.valid) {
    console.error(`[economics] ❌ Payout validation FAILED: ${validation.error}`);
    throw new Error(`Payout validation failed: ${validation.error}`);
  }

  // Fix rounding errors by adding any dust to the winner payout
  if (validation.diffWei > 0n) {
    console.log(`[economics] Adding ${validation.diffWei} wei rounding dust to winner payout`);
    onChainPayouts[0].amountWei += validation.diffWei;
    // Update DB payout too
    if (isWordRound) {
      dbPayouts[0].amountWord = onChainPayouts[0].amountWei.toString();
    } else {
      dbPayouts[0].amountEth = ethers.formatEther(onChainPayouts[0].amountWei);
    }
  }

  // Execute onchain payouts (use Sepolia or mainnet based on simulation mode)
  // Skip entirely if skipOnchainResolutionFlag is set (contract state issues)
  let resolveTxHash: string | null = null;
  if (skipOnchainResolutionFlag) {
    console.log(`[economics] ⚠️ SKIPPING onchain resolution (skipOnchainResolution=true)`);
    console.log(`[economics] DB payouts will be created but no onchain transaction`);
  } else {
    try {
      if (isWordRound) {
        // resolveWordRoundOnChain re-validates the whole payout array against
        // the live pool before spending gas, and logs any payout the contract
        // had to defer to claimable().
        resolveTxHash = await resolveWordRoundOnChain(
          roundId,
          onChainPayouts.map((p) => ({
            address: p.address,
            amountWei: p.amountWei,
            role: p.role as 'winner' | 'referrer' | 'top_guesser' | 'seed',
            fid: p.fid,
          })),
          seedForNextRoundWei
        );
      } else {
        resolveTxHash = sepoliaSimulationMode
          ? await resolveRoundWithPayoutsOnSepolia(onChainPayouts, seedForNextRoundWei)
          : await resolveRoundWithPayoutsOnChain(onChainPayouts, seedForNextRoundWei);
      }
      console.log(`[economics] Onchain payouts executed${sepoliaSimulationMode ? ' (Sepolia)' : ''}: ${resolveTxHash}`);
    } catch (error) {
      console.error(`[economics] CRITICAL: Onchain payout failed for round ${roundId}:`, error);
      throw error; // Re-throw to prevent marking round as resolved
    }
  }

  // Insert all database payout records (including seed/creator with null fid)
  // Migration 0005_nullable_payout_fid.sql allows null fid for seed and creator payouts
  if (dbPayouts.length > 0) {
    await db.insert(roundPayouts).values(dbPayouts);
  }

  // Milestone 14: Distribute $WORD top-10 rewards (non-blocking, never blocks ETH payouts)
  //
  // DELIBERATE: on a $WORD round the top 10 receive TWO separate $WORD streams,
  // and this is intended rather than an oversight. They are funded from
  // different places and mean different things:
  //
  //   1. Their share of the prize pool (10%, or 12.5% with no referrer), paid
  //      from WordJackpot above. Scales with how big the round got.
  //   2. This reward, paid from WordManagerV3's tranche. Fixed in USD terms,
  //      and there to make placing in the top 10 worth chasing even in a small
  //      round — which is what drives pack purchases.
  //
  // Structurally identical to what rounds 1-33 did (ETH prize + $WORD reward);
  // the only change is that both legs are now the same token, which makes it
  // LOOK like a double-pay when reading the resolve path. It is not one.
  //
  // The staker-solvency guard added to WordManagerV3 means this leg now reverts
  // loudly rather than quietly paying out of staked principal when the tranche
  // is dry, and the catch below keeps that from blocking round resolution.
  if (topGuesserFids.length > 0) {
    (async () => {
      try {
        const { getTop10WordAmounts, getTop10WordAmountsWei, WORD_MARKET_CAP_USD } =
          await import('../../config/economy');
        const { getRewardPriceE18 } = await import('./word-jackpot-contract');
        const { distributeTop10RewardsOnChain } = await import('./word-manager');
        const { wordRewards: wordRewardsTable, roundPayouts: roundPayoutsTable } = await import('../db/schema');

        // Oracle-priced at $3.00 for first place when a price is available;
        // the legacy tier-stepped token amounts are the fallback so a dead
        // oracle costs players nothing.
        const rewardPriceE18 = await getRewardPriceE18();
        const wordAmounts = rewardPriceE18
          ? getTop10WordAmountsWei(rewardPriceE18).map((w) => w.toString())
          : getTop10WordAmounts(WORD_MARKET_CAP_USD);
        console.log(
          `[economics] Top-10 $WORD rewards priced ${
            rewardPriceE18 ? `by oracle (${rewardPriceE18} e18)` : 'from the legacy fixed tiers'
          }`
        );
        const playerAmounts = wordAmounts.slice(0, topGuesserFids.length);

        // Look up wallet addresses for top guessers
        const walletResults = await Promise.all(
          topGuesserFids.map(async (fid) => {
            const [user] = await db
              .select({ wallet: users.signerWalletAddress })
              .from(users)
              .where(eq(users.fid, fid))
              .limit(1);
            return { fid, wallet: user?.wallet || null };
          })
        );

        // Pair each player with their rank-correct amount before filtering
        const playersWithAmounts = walletResults.map((p, i) => ({
          ...p,
          amount: playerAmounts[i],
        }));
        const validPlayers = playersWithAmounts.filter(p => p.wallet !== null);

        if (validPlayers.length > 0) {
          // Onchain distribution (single batch tx)
          const txHash = await distributeTop10RewardsOnChain(
            roundId,
            validPlayers.map(p => p.wallet!),
            validPlayers.map(p => p.amount)
          );

          // Record each payout in word_rewards audit trail
          for (let i = 0; i < validPlayers.length; i++) {
            await db.insert(wordRewardsTable).values({
              roundId,
              fid: validPlayers[i].fid,
              rewardType: 'top10',
              amount: validPlayers[i].amount,
              txHash,
            });
          }

          console.log(`[economics] ✅ Distributed $WORD top-10 rewards for round ${roundId} (${validPlayers.length} players)`);
        }
      } catch (error) {
        console.error(`[economics] $WORD top-10 distribution failed for round ${roundId}:`, error);
        // CRITICAL: $WORD payout failure must NOT block ETH payouts or round resolution
      }
    })();
  }

  // Milestone 6.7: Award TOP_TEN_GUESSER XP (+50 XP each, fire-and-forget)
  if (topGuesserFids.length > 0) {
    awardTopTenGuesserXp(roundId, topGuesserFids);

    // Award QUICKDRAW wordmark to Top 10 guessers (fire-and-forget)
    (async () => {
      try {
        const { checkAndAwardQuickdraw } = await import('./wordmarks');
        for (let i = 0; i < topGuesserFids.length; i++) {
          const fid = topGuesserFids[i];
          const rank = i + 1; // 1-based rank
          await checkAndAwardQuickdraw(fid, roundId, rank);
        }
        console.log(`⚡ Checked QUICKDRAW wordmark for ${topGuesserFids.length} Top 10 guessers in round ${roundId}`);
      } catch (error) {
        console.error(`[Wordmark] Failed to award QUICKDRAW for round ${roundId}:`, error);
      }
    })();
  }

  // Mark round as resolved
  // Milestone 9.5: Also set status to 'resolved'
  await db
    .update(rounds)
    .set({
      resolvedAt: new Date(),
      winnerFid,
      referrerFid,
      status: 'resolved',
      txHash: resolveTxHash,
      // Record what actually carried forward so the next round's seed and the
      // archive read the same number the contract holds.
      //
      // Both currencies, not just $WORD. During a round `seed_next_round_eth`
      // accumulates 20% of each paid guess; at resolution the carry is instead
      // 5% of the final pool (capped), and that is the figure handed to the
      // contract. Nothing was writing it back, so the column kept the
      // accumulator — and `archiveRound` derives a round's seed from the
      // *previous* round's copy of it, meaning the permanent record showed a
      // number the contract never carried. The Milestone 4.9 helper that used
      // to reconcile this, `allocateToSeedAndCreator`, is still defined but no
      // longer called by anything.
      ...(isWordRound
        ? {
            prizePoolWord: jackpotWei.toString(),
            seedNextRoundWord: seedForNextRoundWei.toString(),
          }
        : {
            seedNextRoundEth: ethers.formatEther(seedForNextRoundWei),
          }),
    })
    .where(eq(rounds.id, roundId));

  console.log(
    isWordRound
      ? `✅ Resolved round ${roundId} with ${dbPayouts.length} payouts (pool: ${formatWordAmount(jackpotWei)} $WORD)`
      : `✅ Resolved round ${roundId} with ${dbPayouts.length} payouts (jackpot: ${jackpotEth.toFixed(18)} ETH)`
  );

  // Milestone 5.1: Announce round resolution (non-blocking)
  try {
    // Get total guess count for the round
    const totalGuessesResult = await db
      .select({ count: count() })
      .from(guesses)
      .where(eq(guesses.roundId, roundId));
    const totalGuesses = totalGuessesResult[0]?.count ?? 0;

    // Get updated round with resolved data
    const [resolvedRound] = await db
      .select()
      .from(rounds)
      .where(eq(rounds.id, roundId))
      .limit(1);

    if (resolvedRound) {
      // Announce round resolved
      const result = await announceRoundResolved(resolvedRound, dbPayouts, totalGuesses);

      // If there was a referrer payout, announce it as a reply
      if (referrerFid) {
        const referrerPayout = dbPayouts.find(p => p.role === 'referrer');
        if (referrerPayout) {
          await announceReferralWin(
            resolvedRound,
            referrerPayout,
            result?.cast?.hash
          );
        }
      }
    }
  } catch (error) {
    console.error('[economics] Failed to announce round resolution:', error);
    // Continue - announcer failures should never break the game
  }

  // Milestone 5.4: Archive round immediately after resolution (non-blocking)
  // This ensures the archive is created right away instead of waiting for daily cron
  try {
    const archiveResult = await archiveRound({ roundId });
    if (archiveResult.success) {
      console.log(`[economics] ✅ Round ${roundId} archived successfully`);
    } else {
      console.error(`[economics] Failed to archive round ${roundId}: ${archiveResult.error}`);
    }
  } catch (error) {
    console.error('[economics] Failed to archive round:', error);
    // Continue - archive failures should never break the game
  }
}

/**
 * Get top 10 guessers for a round (excluding the winner)
 *
 * Milestone 7.x: Only considers guesses with guessIndexInRound <= TOP10_LOCK_AFTER_GUESSES
 * Guesses after the lock threshold do not count toward Top-10 ranking.
 *
 * Ranking criteria:
 * - By total guess count (volume) - ALL guesses count (free + paid)
 * - Tiebreaker: who reached their count first (lowest max guessIndexInRound)
 *
 * @param roundId - The round ID
 * @param winnerFid - The FID of the winner to exclude
 * @returns Array of FIDs (up to 10)
 */
async function getTop10Guessers(roundId: number, winnerFid: number): Promise<number[]> {

  // Get all TOP-10 ELIGIBLE guesses for this round (both free and paid)
  // Only guesses with guessIndexInRound <= TOP10_LOCK_AFTER_GUESSES count
  const eligibleGuesses = await db
    .select({
      fid: guesses.fid,
      createdAt: guesses.createdAt,
      guessIndexInRound: guesses.guessIndexInRound,
    })
    .from(guesses)
    .where(
      and(
        eq(guesses.roundId, roundId),
        // Only include guesses within the Top-10 eligibility window
        // Handle legacy guesses without index (treat as eligible for backwards compat)
        // New guesses will always have an index
        isNotNull(guesses.guessIndexInRound)
          ? lte(guesses.guessIndexInRound, TOP10_LOCK_AFTER_GUESSES)
          : undefined
      )
    )
    .orderBy(guesses.createdAt);

  // Also get legacy guesses without index (backwards compatibility)
  const legacyGuesses = await db
    .select({
      fid: guesses.fid,
      createdAt: guesses.createdAt,
      guessIndexInRound: guesses.guessIndexInRound,
    })
    .from(guesses)
    .where(eq(guesses.roundId, roundId))
    .orderBy(guesses.createdAt);

  // Combine: use indexed guesses if available, fall back to all guesses for legacy rounds
  const hasIndexedGuesses = eligibleGuesses.some(g => g.guessIndexInRound !== null);
  const allGuesses = hasIndexedGuesses
    ? eligibleGuesses.filter(g => g.guessIndexInRound !== null && g.guessIndexInRound <= TOP10_LOCK_AFTER_GUESSES)
    : legacyGuesses;

  // Group by FID and track count + last guess index (for tiebreaker)
  const guesserStats = new Map<number, { count: number; lastGuessIndex: number }>();

  for (const guess of allGuesses) {
    // Skip winner
    if (guess.fid === winnerFid) {
      continue;
    }

    const guessIndex = guess.guessIndexInRound ?? 0;
    const existing = guesserStats.get(guess.fid);
    if (existing) {
      existing.count++;
      // Track the highest guess index (when they reached their final count)
      existing.lastGuessIndex = Math.max(existing.lastGuessIndex, guessIndex);
    } else {
      guesserStats.set(guess.fid, {
        count: 1,
        lastGuessIndex: guessIndex,
      });
    }
  }

  // Convert to array and sort
  const sorted = Array.from(guesserStats.entries())
    .sort((a, b) => {
      // Primary: by count (descending)
      if (b[1].count !== a[1].count) {
        return b[1].count - a[1].count;
      }
      // Tiebreaker: who reached their count first (lower lastGuessIndex is better)
      return a[1].lastGuessIndex - b[1].lastGuessIndex;
    });

  const rankedFids = sorted.map(([fid]) => fid);

  // Reward gate: ineligible accounts do not rank; the next eligible account
  // moves up. Uncached, against the round's frozen seed price — resolve is
  // exactly the moment a farm's dumped balance must count against it.
  const { checkPlayEligibility, isRewardGateEnabled } = await import('./reward-gate');
  if (!isRewardGateEnabled()) {
    return rankedFids.slice(0, 10);
  }

  const [roundRow] = await db
    .select({ id: rounds.id, seedPriceE18: rounds.seedPriceE18 })
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .limit(1);

  // Bounded and parallel. An unbounded serial walk would let a large farm
  // cohort force hundreds of sequential RPC reads during resolve and stall
  // the payout. Only the top slice is checked, all at once; if fewer than
  // ten of them pass, the round pays fewer than ten — the split already
  // handles short lists (small rounds produce them today) — instead of
  // resolve hanging on the farm's tail. claimWallet is off: a payout is not
  // a new play, so it must neither consume a (day, wallet) claim nor be
  // blocked by one made under the resolve day.
  const MAX_TOP10_GATE_CHECKS = 30;
  const candidates = rankedFids.slice(0, MAX_TOP10_GATE_CHECKS);
  const checks = await Promise.all(
    candidates.map((fid) =>
      checkPlayEligibility(fid, {
        round: roundRow ?? null,
        useCache: false,
        claimWallet: false,
      }).then(
        (gate) => ({ fid, eligible: gate.eligible, reason: gate.reason }),
        // Consistent with the decided fail-open policy on infrastructure error
        () => ({ fid, eligible: true, reason: undefined })
      )
    )
  );

  const top10: number[] = [];
  for (const check of checks) {
    if (top10.length >= 10) break;
    if (check.eligible) {
      top10.push(check.fid);
    } else {
      console.warn(
        `🚧 [RewardGate] FID ${check.fid} excluded from Top 10 at resolve (${check.reason}); next eligible moves up`
      );
    }
  }
  return top10;
}

/**
 * Create next round from seed of previous round
 *
 * - Takes seed S from previous round
 * - Creates new round with prize pool initialized to S
 * - Resets seed to 0 for the new round
 *
 * @param previousRoundId - The ID of the previous round
 * @param answer - The answer word for the new round
 * @param salt - The salt for commit-reveal
 * @param commitHash - The commit hash
 * @param rulesetId - The ruleset ID
 * @returns The new round ID
 */
export async function createNextRoundFromSeed(
  previousRoundId: number,
  answer: string,
  salt: string,
  commitHash: string,
  rulesetId: number
): Promise<number> {
  // Get previous round
  const [prevRound] = await db
    .select()
    .from(rounds)
    .where(eq(rounds.id, previousRoundId))
    .limit(1);

  if (!prevRound) {
    throw new Error(`Previous round ${previousRoundId} not found`);
  }

  // Get seed from previous round
  const seed = prevRound.seedNextRoundEth;

  // Create new round with seed as initial prize pool
  const [newRound] = await db
    .insert(rounds)
    .values({
      rulesetId,
      answer: answer.toUpperCase(),
      salt,
      commitHash,
      prizePoolEth: seed, // Initialize with previous round's seed
      seedNextRoundEth: '0', // Reset seed to 0
    })
    .returning();

  // CRITICAL: Validate salt immediately after insert to catch any corruption
  if (typeof newRound.salt !== 'string' || newRound.salt.length !== 64 || !/^[a-f0-9]+$/i.test(newRound.salt)) {
    console.error(`[economics] ⚠️ SALT CORRUPTION DETECTED after insert for round ${newRound.id}!`);
    console.error(`[economics] Salt type: ${typeof newRound.salt}, isDate: ${newRound.salt instanceof Date}`);

    // Fix the corruption immediately using raw SQL
    await db.execute(sql`UPDATE rounds SET salt = ${salt} WHERE id = ${newRound.id}`);
    (newRound as any).salt = salt;
    console.log(`[economics] ✅ Salt corruption fixed for round ${newRound.id}`);
  }

  console.log(`✅ Created round ${newRound.id} with seed from round ${previousRoundId}: ${seed} ETH`);

  return newRound.id;
}

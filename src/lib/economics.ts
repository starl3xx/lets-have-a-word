import { db } from '../db';
import { rounds, systemState, roundPayouts, guesses, users } from '../db/schema';
import { eq, and, desc, count, lte, isNotNull } from 'drizzle-orm';
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
  type PayoutRecipient,
} from './jackpot-contract';
import { getWinnerPayoutAddress, logWalletResolution } from './wallet-identity';
import { calculateTopGuesserPayouts, formatPayoutsForLog } from './top-guesser-payouts';
import { TOP10_LOCK_AFTER_GUESSES } from './top10-lock';

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
 * - Apply 0.03 ETH cap to seed
 * - Overflow beyond cap → creator
 */

// Seed cap: Maximum ETH that can accumulate as seed for next round
// This also serves as the creator pool withdrawal threshold
// Below this, funds prioritize seeding future rounds
export const SEED_CAP_ETH = 0.03; // 0.03 ETH
export const SEED_CAP_ETH_STRING = '0.03';
export const SEED_CAP_WEI = 30000000000000000n; // 0.03 ETH in wei

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
 * - If seed S < 0.03 ETH, portion of 20% goes to S
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
 * - Seed cap: 0.03 ETH
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

  // CRITICAL: Use actual contract balance for payouts, not DB value
  // This prevents payout failures when DB and contract are out of sync
  // Use Sepolia or mainnet based on simulation mode
  let jackpotEth: number;
  let jackpotWei: bigint;

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

  if (jackpotEth === 0) {
    console.log(`⚠️  Round ${roundId} has zero jackpot, no payouts created`);
    return;
  }

  // Get winner's referrer
  const [winner] = await db
    .select()
    .from(users)
    .where(eq(users.fid, winnerFid))
    .limit(1);

  const referrerFid = winner?.referrerFid || null;
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
  // - Seed is capped at 0.03 ETH
  // - Any overflow beyond cap routes to creator
  // ============================================================================

  const toWinnerWei = (jackpotWei * 8000n) / 10000n; // 80%
  let toTopGuessersWei = (jackpotWei * 1000n) / 10000n; // 10% base
  const baseSeedWei = (jackpotWei * 500n) / 10000n; // 5%
  const referrerShareWei = (jackpotWei * 500n) / 10000n; // 5%

  let toReferrerWei = 0n;
  let seedForNextRoundWei = baseSeedWei;
  let toCreatorOverflowWei = 0n;

  if (hasReferrer) {
    // Winner has referrer: 80% winner, 10% top guessers, 5% seed, 5% referrer
    toReferrerWei = referrerShareWei;
    // Seed is just the base 5%
    seedForNextRoundWei = baseSeedWei;
  } else {
    // No referrer: split the 5% referrer share as 2.5% to top guessers, 2.5% to seed
    const halfReferrerShareWei = referrerShareWei / 2n; // 2.5%

    // Add 2.5% to top guessers (total 12.5%)
    toTopGuessersWei = toTopGuessersWei + halfReferrerShareWei;

    // Add 2.5% to seed (total 7.5%), with cap
    const totalSeedWei = baseSeedWei + halfReferrerShareWei;

    // Apply seed cap (0.03 ETH)
    if (totalSeedWei > SEED_CAP_WEI) {
      seedForNextRoundWei = SEED_CAP_WEI;
      toCreatorOverflowWei = totalSeedWei - SEED_CAP_WEI;
      console.log(`[economics] Seed capped at ${ethers.formatEther(SEED_CAP_WEI)} ETH, overflow ${ethers.formatEther(toCreatorOverflowWei)} ETH → creator`);
    } else {
      seedForNextRoundWei = totalSeedWei;
    }
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
    amountEth: ethers.formatEther(toWinnerWei),
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
      amountEth: ethers.formatEther(toReferrerWei),
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
        amountEth: ethers.formatEther(amountWei),
        role: 'top_guesser',
      });
    }
  } else {
    // No other guessers, winner gets this too
    // Add to winner's existing payout by creating separate entry
    dbPayouts.push({
      roundId,
      fid: winnerFid,
      amountEth: ethers.formatEther(toTopGuessersWei),
      role: 'top_guesser',
    });
    // Update winner's onchain payout
    onChainPayouts[0].amountWei += toTopGuessersWei;
  }

  // 4. Add seed record (always 5% base, up to 10% if no referrer, capped at 0.03 ETH)
  if (seedForNextRoundWei > 0n) {
    dbPayouts.push({
      roundId,
      fid: null,
      amountEth: ethers.formatEther(seedForNextRoundWei),
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
      amountEth: ethers.formatEther(toCreatorOverflowWei),
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
    const seedPercent = seedForNextRoundWei === SEED_CAP_WEI ? 'capped' : '7.5%';
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
    dbPayouts[0].amountEth = ethers.formatEther(onChainPayouts[0].amountWei);
  }

  // Execute onchain payouts (use Sepolia or mainnet based on simulation mode)
  // Skip entirely if skipOnchainResolutionFlag is set (contract state issues)
  let resolveTxHash: string | null = null;
  if (skipOnchainResolutionFlag) {
    console.log(`[economics] ⚠️ SKIPPING onchain resolution (skipOnchainResolution=true)`);
    console.log(`[economics] DB payouts will be created but no onchain transaction`);
  } else {
    try {
      resolveTxHash = sepoliaSimulationMode
        ? await resolveRoundWithPayoutsOnSepolia(onChainPayouts, seedForNextRoundWei)
        : await resolveRoundWithPayoutsOnChain(onChainPayouts, seedForNextRoundWei);
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
    })
    .where(eq(rounds.id, roundId));

  console.log(`✅ Resolved round ${roundId} with ${dbPayouts.length} payouts (jackpot: ${jackpotEth.toFixed(18)} ETH)`);

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

  // Return top 10 FIDs
  return sorted.slice(0, 10).map(([fid]) => fid);
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

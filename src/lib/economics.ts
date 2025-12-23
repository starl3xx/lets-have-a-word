import { db } from '../db';
import { rounds, systemState, roundPayouts, guesses, users } from '../db/schema';
import { eq, and, desc, count, lte, isNotNull } from 'drizzle-orm';
import type { RoundPayoutInsert } from '../db/schema';
import { announceRoundResolved, announceReferralWin } from './announcer';
import { awardTopTenGuesserXp } from './xp';
import { ethers } from 'ethers';
import { resolveRoundWithPayoutsOnChain, type PayoutRecipient } from './jackpot-contract';
import { getWinnerPayoutAddress, logWalletResolution } from './wallet-identity';
import { calculateTopGuesserPayouts, formatPayoutsForLog } from './top-guesser-payouts';
import { TOP10_LOCK_AFTER_GUESSES } from './top10-lock';

/**
 * Economics Module - Milestone 3.1
 * Milestone 6.9 - On-chain multi-recipient payouts
 *
 * Handles jackpot splits, seed accumulation, and payouts
 */

const SEED_CAP_ETH = '0.03'; // 0.03 ETH cap for seed accumulation (updated from 0.1 in Milestone 5.4b)

/**
 * Apply economic effects when a paid guess is made
 *
 * Split logic:
 * - 80% goes to prize pool (P)
 * - 20% goes to seed/creator:
 *   - If seed S < 0.03 ETH, add to S
 *   - Otherwise add to creator balance
 *
 * @param roundId - The round ID
 * @param guessPriceEth - Price of the guess in ETH (as string)
 */
export async function applyPaidGuessEconomicEffects(
  roundId: number,
  guessPriceEth: string
): Promise<void> {
  const price = parseFloat(guessPriceEth);

  // Calculate splits
  const toPrizePool = price * 0.8;
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

  // Update prize pool
  const newPrizePool = parseFloat(round.prizePoolEth) + toPrizePool;

  // Calculate seed update
  const currentSeed = parseFloat(round.seedNextRoundEth);
  const seedCap = parseFloat(SEED_CAP_ETH);

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

  // Update round with new prize pool and seed
  await db
    .update(rounds)
    .set({
      prizePoolEth: newPrizePool.toFixed(18),
      seedNextRoundEth: newSeed.toFixed(18),
    })
    .where(eq(rounds.id, roundId));

  // Update creator balance if needed
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
  - Prize pool: ${round.prizePoolEth} → ${newPrizePool.toFixed(18)}
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
  const seedCap = parseFloat(SEED_CAP_ETH);
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
 * Resolve round and create payouts (Milestone 6.9 - On-chain multi-recipient)
 *
 * Jackpot split:
 * - 80% to winner (always)
 * - If winner HAS referrer:
 *   - 10% to referrer
 *   - 10% to top 10 guessers
 * - If winner has NO referrer:
 *   - 17.5% to top 10 guessers (10% + 7.5% from referrer share)
 *   - 2.5% to seed for next round (always, no cap)
 *
 * Top 10 ranking:
 * - By total paid guess count (volume)
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

  const jackpotEth = parseFloat(round.prizePoolEth);
  const jackpotWei = ethers.parseEther(round.prizePoolEth);

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

  // Calculate splits based on referrer status
  const toWinnerWei = (jackpotWei * 8000n) / 10000n; // 80%
  const referrerShareWei = (jackpotWei * 1000n) / 10000n; // 10%
  const baseTopGuessersWei = (jackpotWei * 1000n) / 10000n; // 10%

  let toReferrerWei = 0n;
  let toTopGuessersWei = baseTopGuessersWei;
  let seedForNextRoundWei = 0n;

  if (hasReferrer) {
    // Winner has referrer: 80% winner, 10% referrer, 10% top guessers
    toReferrerWei = referrerShareWei;
  } else {
    // No referrer: 80% winner, 17.5% top guessers, 2.5% seed
    // 7.5% of referrer share (75% of 10%) goes to top guessers
    const toTopGuessersBonus = (referrerShareWei * 7500n) / 10000n; // 7.5%
    toTopGuessersWei = baseTopGuessersWei + toTopGuessersBonus; // 17.5%
    // 2.5% of referrer share (25% of 10%) goes to seed
    seedForNextRoundWei = (referrerShareWei * 2500n) / 10000n; // 2.5%
  }

  // Get top 10 guessers (FIDs)
  const topGuesserFids = await getTop10Guessers(roundId, winnerFid);

  // Build on-chain payout recipients
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

  // 2. Referrer payout (10% if exists)
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

    // Add to on-chain and DB payouts
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
    // Update winner's on-chain payout
    onChainPayouts[0].amountWei += toTopGuessersWei;
  }

  // 4. Add seed record if applicable (for database tracking only)
  if (seedForNextRoundWei > 0n) {
    dbPayouts.push({
      roundId,
      fid: null,
      amountEth: ethers.formatEther(seedForNextRoundWei),
      role: 'seed',
    });
  }

  console.log(`[economics] Resolving round ${roundId} with on-chain payouts:`);
  console.log(`  - Jackpot: ${jackpotEth} ETH`);
  console.log(`  - Winner (80%): ${ethers.formatEther(onChainPayouts[0].amountWei)} ETH`);
  if (hasReferrer) {
    console.log(`  - Referrer (10%): ${ethers.formatEther(toReferrerWei)} ETH`);
    console.log(`  - Top guessers (10%): ${ethers.formatEther(toTopGuessersWei)} ETH tiered among ${topGuesserFids.length || 1}`);
  } else {
    console.log(`  - Top guessers (17.5%): ${ethers.formatEther(toTopGuessersWei)} ETH tiered among ${topGuesserFids.length || 1}`);
    console.log(`  - Seed for next round (2.5%): ${ethers.formatEther(seedForNextRoundWei)} ETH`);
  }

  // Execute on-chain payouts
  try {
    const txHash = await resolveRoundWithPayoutsOnChain(onChainPayouts, seedForNextRoundWei);
    console.log(`[economics] On-chain payouts executed: ${txHash}`);
  } catch (error) {
    console.error(`[economics] CRITICAL: On-chain payout failed for round ${roundId}:`, error);
    throw error; // Re-throw to prevent marking round as resolved
  }

  // Insert all database payout records
  await db.insert(roundPayouts).values(dbPayouts);

  // Milestone 6.7: Award TOP_TEN_GUESSER XP (+50 XP each, fire-and-forget)
  if (topGuesserFids.length > 0) {
    awardTopTenGuesserXp(roundId, topGuesserFids);
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
}

/**
 * Get top 10 guessers for a round (excluding the winner)
 *
 * Milestone 7.x: Only considers guesses with guessIndexInRound <= TOP10_LOCK_AFTER_GUESSES
 * Guesses after the lock threshold do not count toward Top-10 ranking.
 *
 * Ranking criteria:
 * - By total paid guess count (volume) - only eligible guesses
 * - Tiebreaker: earliest first guess time
 *
 * @param roundId - The round ID
 * @param winnerFid - The FID of the winner to exclude
 * @returns Array of FIDs (up to 10)
 */
async function getTop10Guessers(roundId: number, winnerFid: number): Promise<number[]> {

  // Get all TOP-10 ELIGIBLE paid guesses for this round
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
        eq(guesses.isPaid, true),
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
    .where(
      and(
        eq(guesses.roundId, roundId),
        eq(guesses.isPaid, true)
      )
    )
    .orderBy(guesses.createdAt);

  // Combine: use indexed guesses if available, fall back to all guesses for legacy rounds
  const hasIndexedGuesses = eligibleGuesses.some(g => g.guessIndexInRound !== null);
  const allGuesses = hasIndexedGuesses
    ? eligibleGuesses.filter(g => g.guessIndexInRound !== null && g.guessIndexInRound <= TOP10_LOCK_AFTER_GUESSES)
    : legacyGuesses;

  // Group by FID and count
  const guesserStats = new Map<number, { count: number; firstGuessTime: Date }>();

  for (const guess of allGuesses) {
    // Skip winner
    if (guess.fid === winnerFid) {
      continue;
    }

    const existing = guesserStats.get(guess.fid);
    if (existing) {
      existing.count++;
    } else {
      guesserStats.set(guess.fid, {
        count: 1,
        firstGuessTime: guess.createdAt,
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
      // Tiebreaker: by first guess time (ascending - earlier is better)
      return a[1].firstGuessTime.getTime() - b[1].firstGuessTime.getTime();
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

  console.log(`✅ Created round ${newRound.id} with seed from round ${previousRoundId}: ${seed} ETH`);

  return newRound.id;
}

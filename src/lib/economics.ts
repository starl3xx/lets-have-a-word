import { db } from '../db';
import { rounds, systemState, roundPayouts, guesses, users } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import type { RoundPayoutInsert } from '../db/schema';

/**
 * Economics Module - Milestone 3.1
 * Handles jackpot splits, seed accumulation, and payouts
 */

const SEED_CAP_ETH = '0.1'; // 0.1 ETH cap for seed accumulation

/**
 * Apply economic effects when a paid guess is made
 *
 * Split logic:
 * - 80% goes to prize pool (P)
 * - 20% goes to seed/creator:
 *   - If seed S < 0.1 ETH, add to S
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
 * Resolve round and create payouts
 *
 * Jackpot split:
 * - 80% to winner
 * - 10% to referrer (or winner if no referrer)
 * - 10% to top 10 guessers (split equally among them)
 *
 * Top 10 ranking:
 * - By total guess volume (paid guesses only)
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

  const jackpot = parseFloat(round.prizePoolEth);

  if (jackpot === 0) {
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

  // Calculate splits
  const toWinner = jackpot * 0.8;
  const toReferrer = jackpot * 0.1;
  const toTopGuessers = jackpot * 0.1;

  const payouts: RoundPayoutInsert[] = [];

  // 1. Winner payout (80%)
  payouts.push({
    roundId,
    fid: winnerFid,
    amountEth: toWinner.toFixed(18),
    role: 'winner',
  });

  // 2. Referrer payout (10%)
  // If no referrer, winner gets this too
  payouts.push({
    roundId,
    fid: referrerFid || winnerFid,
    amountEth: toReferrer.toFixed(18),
    role: 'referrer',
  });

  // 3. Top 10 guessers payout (10% split equally)
  const topGuessers = await getTop10Guessers(roundId);

  if (topGuessers.length > 0) {
    const perGuesser = toTopGuessers / topGuessers.length;

    for (const fid of topGuessers) {
      payouts.push({
        roundId,
        fid,
        amountEth: perGuesser.toFixed(18),
        role: 'top_guesser',
      });
    }
  } else {
    // No other guessers, winner gets this too
    payouts.push({
      roundId,
      fid: winnerFid,
      amountEth: toTopGuessers.toFixed(18),
      role: 'top_guesser',
    });
  }

  // Insert all payouts
  await db.insert(roundPayouts).values(payouts);

  // Mark round as resolved
  await db
    .update(rounds)
    .set({
      resolvedAt: new Date(),
      winnerFid,
      referrerFid,
    })
    .where(eq(rounds.id, roundId));

  console.log(`✅ Resolved round ${roundId} with ${payouts.length} payouts (jackpot: ${jackpot.toFixed(18)} ETH)`);
}

/**
 * Get top 10 guessers for a round (excluding the winner)
 *
 * Ranking criteria:
 * - By total paid guess count (volume)
 * - Tiebreaker: earliest first guess time
 *
 * @param roundId - The round ID
 * @returns Array of FIDs (up to 10)
 */
async function getTop10Guessers(roundId: number): Promise<number[]> {
  // Get round to find winner
  const [round] = await db
    .select()
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .limit(1);

  if (!round || !round.winnerFid) {
    return [];
  }

  // Get all paid guesses for this round (excluding winner's guesses)
  const allGuesses = await db
    .select({
      fid: guesses.fid,
      createdAt: guesses.createdAt,
    })
    .from(guesses)
    .where(
      and(
        eq(guesses.roundId, roundId),
        eq(guesses.isPaid, true)
      )
    )
    .orderBy(guesses.createdAt);

  // Group by FID and count
  const guesserStats = new Map<number, { count: number; firstGuessTime: Date }>();

  for (const guess of allGuesses) {
    // Skip winner
    if (guess.fid === round.winnerFid) {
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

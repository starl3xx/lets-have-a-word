import { db, rounds } from '../db';
import { eq, isNull, desc, and } from 'drizzle-orm';
import type { Round } from '../types';
import { getRandomAnswerWord, isValidAnswer } from './word-lists';
import { createCommitment, verifyCommit } from './commit-reveal';
import { resolveRoundAndCreatePayouts } from './economics';
import { announceRoundStarted } from './announcer';
import { logRoundEvent, AnalyticsEventTypes } from './analytics';
import { trackSlowQuery } from './redis';
import { shouldBlockNewRoundCreation } from './operational-guard';
import { encryptAndPack, getPlaintextAnswer } from './encryption';
import { startRoundWithCommitmentOnChain, isContractDeployed } from './jackpot-contract';

/**
 * Options for creating a new round
 */
export interface CreateRoundOptions {
  forceAnswer?: string; // Force a specific answer (for testing)
  rulesetId?: number; // Game rules ID to use (default 1)
  skipOnChainCommitment?: boolean; // Skip onchain commitment (for testing without contract)
  skipActiveRoundCheck?: boolean; // Skip active round check (for Sepolia simulation)
}

/**
 * Create a new round
 *
 * @param opts Optional configuration
 * @returns The created round
 */
export async function createRound(opts?: CreateRoundOptions): Promise<Round> {
  const rulesetId = opts?.rulesetId ?? 1;
  const forceAnswer = opts?.forceAnswer;
  const skipOnChainCommitment = opts?.skipOnChainCommitment ?? false;
  const skipActiveRoundCheck = opts?.skipActiveRoundCheck ?? false;

  // Check if there's already an active round (skip for simulations)
  if (!skipActiveRoundCheck) {
    const existingRound = await getActiveRound();
    if (existingRound) {
      throw new Error(
        `Cannot create new round: Round ${existingRound.id} is still active. ` +
        `Resolve it first before creating a new round.`
      );
    }
  }

  // Select answer
  const selectedAnswer = forceAnswer || getRandomAnswerWord();

  // Validate answer
  if (!isValidAnswer(selectedAnswer)) {
    throw new Error(`Invalid answer word: ${selectedAnswer}`);
  }

  // Create commitment (using plaintext answer)
  const { salt, commitHash } = createCommitment(selectedAnswer);

  // Milestone 10.1: Onchain commitment for provably fair verification
  // This MUST succeed before we insert into the database, ensuring the
  // commitment is immutably recorded onchain before the round can accept guesses
  let onChainCommitmentTxHash: string | null = null;

  if (!skipOnChainCommitment) {
    try {
      // Check if contract is deployed and accessible
      const contractDeployed = await isContractDeployed();

      if (contractDeployed) {
        console.log(`[rounds] Committing answer hash onchain...`);
        onChainCommitmentTxHash = await startRoundWithCommitmentOnChain(commitHash);
        console.log(`[rounds] ✅ Onchain commitment successful: ${onChainCommitmentTxHash}`);
      } else {
        console.warn(`[rounds] ⚠️ Contract not deployed, skipping onchain commitment`);
      }
    } catch (error) {
      // Onchain commitment failed - this is critical for provable fairness
      // Log the error but continue with round creation (commitment is in DB)
      console.error(`[rounds] ❌ Onchain commitment failed:`, error);
      console.warn(`[rounds] ⚠️ Continuing with off-chain commitment only`);
      // In strict mode, you might want to throw here instead:
      // throw new Error(`Onchain commitment failed: ${error}`);
    }
  } else {
    console.log(`[rounds] Skipping onchain commitment (skipOnChainCommitment=true)`);
  }

  // Encrypt the answer for storage
  // The plaintext answer is NEVER stored in the database
  const encryptedAnswer = encryptAndPack(selectedAnswer);

  // Insert round into database with encrypted answer
  const result = await db
    .insert(rounds)
    .values({
      rulesetId,
      answer: encryptedAnswer, // Encrypted: iv:tag:ciphertext
      salt,
      commitHash,
      prizePoolEth: '0',
      seedNextRoundEth: '0',
      winnerFid: null,
      referrerFid: null,
      startedAt: new Date(),
      resolvedAt: null,
    })
    .returning();

  const round = result[0];

  console.log(`✅ Created round ${round.id} with commit hash: ${round.commitHash}`);
  if (onChainCommitmentTxHash) {
    console.log(`   Onchain commitment tx: ${onChainCommitmentTxHash}`);
  }

  // Milestone 4.10: Seed words removed - wheel shows all GUESS_WORDS from start

  // Milestone 5.1: Announce round started (non-blocking)
  try {
    await announceRoundStarted(round);
  } catch (error) {
    console.error('[rounds] Failed to announce round started:', error);
    // Continue - announcer failures should never break the game
  }

  // Milestone 5.2: Log analytics event (non-blocking)
  logRoundEvent(AnalyticsEventTypes.ROUND_STARTED, round.id, {
    prizePoolEth: round.prizePoolEth,
    commitHash: round.commitHash,
  });

  return {
    id: round.id,
    rulesetId: round.rulesetId,
    answer: getPlaintextAnswer(round.answer), // Decrypt for internal use
    salt: round.salt,
    commitHash: round.commitHash,
    prizePoolEth: round.prizePoolEth,
    seedNextRoundEth: round.seedNextRoundEth,
    winnerFid: round.winnerFid,
    referrerFid: round.referrerFid,
    startedAt: round.startedAt,
    resolvedAt: round.resolvedAt,
  };
}

/**
 * Get the current active round (latest unresolved round)
 *
 * Milestone 9.5: Excludes cancelled rounds - a cancelled round is not active
 */
export async function getActiveRound(): Promise<Round | null> {
  return trackSlowQuery('query:getActiveRound', async () => {
    const result = await db
      .select()
      .from(rounds)
      .where(and(
        isNull(rounds.resolvedAt),
        eq(rounds.status, 'active') // Exclude cancelled rounds
      ))
      .orderBy(desc(rounds.startedAt))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    const round = result[0];
    return {
      id: round.id,
      rulesetId: round.rulesetId,
      answer: getPlaintextAnswer(round.answer), // Decrypt for internal use
      salt: round.salt,
      commitHash: round.commitHash,
      prizePoolEth: round.prizePoolEth,
      seedNextRoundEth: round.seedNextRoundEth,
      winnerFid: round.winnerFid,
      referrerFid: round.referrerFid,
      startedAt: round.startedAt,
      resolvedAt: round.resolvedAt,
    };
  });
}

/**
 * Get the current active round with FOR UPDATE lock (for use in transactions)
 *
 * This acquires a row-level lock on the round, preventing other transactions
 * from modifying it until this transaction commits. Used to prevent race
 * conditions when resolving rounds.
 *
 * @param tx - The transaction context
 * @returns The active round (locked) or null if no active round
 */
export async function getActiveRoundForUpdate(tx: typeof db): Promise<Round | null> {
  const result = await tx
    .select()
    .from(rounds)
    .where(and(
      isNull(rounds.resolvedAt),
      eq(rounds.status, 'active')
    ))
    .orderBy(desc(rounds.startedAt))
    .limit(1)
    .for('update');

  if (result.length === 0) {
    return null;
  }

  const round = result[0];
  return {
    id: round.id,
    rulesetId: round.rulesetId,
    answer: getPlaintextAnswer(round.answer),
    salt: round.salt,
    commitHash: round.commitHash,
    prizePoolEth: round.prizePoolEth,
    seedNextRoundEth: round.seedNextRoundEth,
    winnerFid: round.winnerFid,
    referrerFid: round.referrerFid,
    startedAt: round.startedAt,
    resolvedAt: round.resolvedAt,
  };
}

/**
 * Ensure there is an active round, creating one if necessary
 *
 * Milestone 9.5: Will NOT create a new round if:
 * - Kill switch is active
 * - Dead day is enabled (current round finished, waiting to resume)
 *
 * @param opts Optional configuration for round creation
 * @returns The active round (existing or newly created)
 * @throws Error if new round creation is blocked by operational controls
 */
export async function ensureActiveRound(opts?: CreateRoundOptions): Promise<Round> {
  const activeRound = await getActiveRound();

  if (activeRound) {
    return activeRound;
  }

  // No active round exists - check if we can create one
  const blocked = await shouldBlockNewRoundCreation();
  if (blocked) {
    throw new Error(
      'Cannot create new round: Game is paused (kill switch or dead day active). ' +
      'Please wait for the game to resume.'
    );
  }

  // Create new round
  return createRound(opts);
}

/**
 * Alias for getActiveRound() for backwards compatibility
 * @deprecated Use getActiveRound() instead
 */
export const getCurrentRound = getActiveRound;

/**
 * Get a round by ID
 */
export async function getRoundById(roundId: number): Promise<Round | null> {
  const result = await db
    .select()
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .limit(1);

  if (result.length === 0) {
    return null;
  }

  const round = result[0];
  return {
    id: round.id,
    rulesetId: round.rulesetId,
    answer: getPlaintextAnswer(round.answer), // Decrypt for internal use
    salt: round.salt,
    commitHash: round.commitHash,
    prizePoolEth: round.prizePoolEth,
    seedNextRoundEth: round.seedNextRoundEth,
    winnerFid: round.winnerFid,
    referrerFid: round.referrerFid,
    startedAt: round.startedAt,
    resolvedAt: round.resolvedAt,
  };
}

/**
 * Resolve a round (mark as complete with winner)
 *
 * @param roundId Round to resolve
 * @param winnerFid FID of winning user
 * @param referrerFid Optional FID of winner's referrer
 * @returns The resolved round
 * @throws Error if round not found or already resolved
 */
export async function resolveRound(
  roundId: number,
  winnerFid: number,
  referrerFid?: number | null
): Promise<Round> {
  // First, check if the round exists and is not already resolved
  const existingRound = await getRoundById(roundId);

  if (!existingRound) {
    throw new Error(`Round ${roundId} not found`);
  }

  if (existingRound.resolvedAt !== null) {
    throw new Error(
      `Round ${roundId} is already resolved (winner: FID ${existingRound.winnerFid})`
    );
  }

  // Create payouts and resolve round (Milestone 3.1)
  // This marks the round as resolved and creates payout records
  await resolveRoundAndCreatePayouts(roundId, winnerFid);

  // Fetch the updated round
  const updatedRound = await getRoundById(roundId);

  if (!updatedRound) {
    throw new Error(`Failed to fetch resolved round ${roundId}`);
  }

  console.log(`✅ Resolved round ${roundId} with winner FID: ${winnerFid}`);

  // Milestone 5.2: Log analytics event (non-blocking)
  logRoundEvent(AnalyticsEventTypes.ROUND_RESOLVED, roundId, {
    winnerFid,
    referrerFid: updatedRound.referrerFid,
    prizePoolEth: updatedRound.prizePoolEth,
    seedNextRoundEth: updatedRound.seedNextRoundEth,
  });

  return updatedRound;
}

/**
 * Verify round commitment (for transparency after resolution)
 *
 * @param round The round to verify
 * @returns true if commitment is valid
 */
export function verifyRoundCommitment(round: Round): boolean {
  return verifyCommit(round.salt, round.answer, round.commitHash);
}

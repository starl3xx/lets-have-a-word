import { db, rounds, roundBonusWords } from '../db';
import { eq, isNull, desc, and } from 'drizzle-orm';
import type { Round } from '../types';
import { getRandomAnswerWord, isValidAnswer, selectBonusWords } from './word-lists';
import { createCommitment, createBonusWordsCommitment, verifyCommit } from './commit-reveal';
import { resolveRoundAndCreatePayouts } from './economics';
import { announceRoundStarted } from './announcer';
import { logRoundEvent, AnalyticsEventTypes } from './analytics';
import { trackSlowQuery } from './redis';
import { shouldBlockNewRoundCreation } from './operational-guard';
import { encryptAndPack, getPlaintextAnswer } from './encryption';
import {
  startRoundWithCommitmentOnChain,
  startRoundWithBothCommitmentsOnChain,
  isContractDeployed,
  isBonusWordsEnabledOnChain,
} from './jackpot-contract';

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
 * Number of bonus words per round
 */
const BONUS_WORDS_COUNT = 10;

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

  // Create commitment for secret word
  const { salt, commitHash } = createCommitment(selectedAnswer);

  // Check if bonus words feature is enabled on contract
  let bonusWordsEnabled = false;
  let bonusWords: string[] = [];
  let bonusWordsCommitment: {
    masterSalt: string;
    individualSalts: string[];
    commitHash: string;
  } | null = null;

  if (!skipOnChainCommitment) {
    bonusWordsEnabled = await isBonusWordsEnabledOnChain();
    console.log(`[rounds] Bonus words feature enabled: ${bonusWordsEnabled}`);

    if (bonusWordsEnabled) {
      // Select 10 unique bonus words (excluding the secret word)
      bonusWords = selectBonusWords(BONUS_WORDS_COUNT, [selectedAnswer]);
      console.log(`[rounds] Selected ${bonusWords.length} bonus words`);

      // Create commitment for bonus words
      bonusWordsCommitment = createBonusWordsCommitment(bonusWords);
      console.log(`[rounds] Bonus words commit hash: ${bonusWordsCommitment.commitHash}`);
    }
  }

  // Milestone 10.1: Onchain commitment for provably fair verification
  // This MUST succeed before we insert into the database, ensuring the
  // commitment is immutably recorded onchain before the round can accept guesses
  let onChainCommitmentTxHash: string | null = null;

  if (!skipOnChainCommitment) {
    // Check if contract is deployed and accessible
    const contractDeployed = await isContractDeployed();

    if (!contractDeployed) {
      throw new Error(
        'Cannot create round: Smart contract is not deployed. ' +
        'All rounds require onchain commitment for provable fairness.'
      );
    }

    if (bonusWordsEnabled && bonusWordsCommitment) {
      // Use new function with both commitments
      console.log(`[rounds] Committing both secret word and bonus words onchain...`);
      onChainCommitmentTxHash = await startRoundWithBothCommitmentsOnChain(
        commitHash,
        bonusWordsCommitment.commitHash
      );
      console.log(`[rounds] ✅ Onchain commitment (with bonus words) successful: ${onChainCommitmentTxHash}`);
    } else {
      // Legacy: only secret word commitment
      console.log(`[rounds] Committing answer hash onchain...`);
      onChainCommitmentTxHash = await startRoundWithCommitmentOnChain(commitHash);
      console.log(`[rounds] ✅ Onchain commitment successful: ${onChainCommitmentTxHash}`);
    }
  } else {
    console.log(`[rounds] ⚠️ Skipping onchain commitment (skipOnChainCommitment=true) - FOR TESTING ONLY`);
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
      bonusWordsCommitHash: bonusWordsCommitment?.commitHash ?? null,
      prizePoolEth: '0',
      seedNextRoundEth: '0',
      winnerFid: null,
      referrerFid: null,
      startTxHash: onChainCommitmentTxHash ?? null, // Store the commitment tx hash
      startedAt: new Date(),
      resolvedAt: null,
    })
    .returning();

  const round = result[0];

  // CRITICAL: Validate salt immediately after insert to catch any corruption
  // This has been a recurring issue where salt becomes a Date object
  if (typeof round.salt !== 'string' || round.salt.length !== 64 || !/^[a-f0-9]+$/i.test(round.salt)) {
    console.error(`[rounds] ⚠️ SALT CORRUPTION DETECTED after insert for round ${round.id}!`);
    console.error(`[rounds] Salt type: ${typeof round.salt}, isDate: ${round.salt instanceof Date}`);
    console.error(`[rounds] Expected salt: ${salt}`);
    console.error(`[rounds] Actual salt: ${String(round.salt).substring(0, 50)}`);

    // Fix the corruption immediately using raw SQL
    const { sql: rawSql } = await import('drizzle-orm');
    await db.execute(rawSql`UPDATE rounds SET salt = ${salt} WHERE id = ${round.id}`);
    round.salt = salt;
    console.log(`[rounds] ✅ Salt corruption fixed for round ${round.id}`);
  }

  // Insert bonus words if enabled
  if (bonusWordsEnabled && bonusWordsCommitment && bonusWords.length > 0) {
    console.log(`[rounds] Storing ${bonusWords.length} encrypted bonus words...`);

    for (let i = 0; i < bonusWords.length; i++) {
      await db.insert(roundBonusWords).values({
        roundId: round.id,
        wordIndex: i,
        word: encryptAndPack(bonusWords[i]), // Encrypted same as secret word
        salt: bonusWordsCommitment.individualSalts[i],
      });
    }

    console.log(`[rounds] ✅ Stored ${bonusWords.length} bonus words for round ${round.id}`);
  }

  console.log(`✅ Created round ${round.id} with commit hash: ${round.commitHash}`);
  if (bonusWordsCommitment) {
    console.log(`   Bonus words commit hash: ${bonusWordsCommitment.commitHash}`);
  }
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
    bonusWordsEnabled,
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
 * Also excludes rounds where winnerFid is set (round locked, payouts in progress)
 */
export async function getActiveRound(): Promise<Round | null> {
  return trackSlowQuery('query:getActiveRound', async () => {
    const result = await db
      .select()
      .from(rounds)
      .where(and(
        isNull(rounds.resolvedAt),
        isNull(rounds.winnerFid), // Round is locked once winner is set
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
 * Also checks winnerFid to ensure round isn't already locked by a winning guess.
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
      isNull(rounds.winnerFid), // Round is locked once winner is set
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

import { db, rounds } from '../db';
import { eq, isNull } from 'drizzle-orm';
import type { Round } from '../types';
import { getRandomAnswerWord, isValidAnswer } from './word-lists';
import { createCommitment, verifyCommit } from './commit-reveal';

/**
 * Options for creating a new round
 */
export interface CreateRoundOptions {
  forceAnswer?: string; // Force a specific answer (for testing)
  rulesetId?: number; // Game rules ID to use (default 1)
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

  // Check if there's already an active round
  const existingRound = await getActiveRound();
  if (existingRound) {
    throw new Error(
      `Cannot create new round: Round ${existingRound.id} is still active. ` +
      `Resolve it first before creating a new round.`
    );
  }

  // Select answer
  const selectedAnswer = forceAnswer || getRandomAnswerWord();

  // Validate answer
  if (!isValidAnswer(selectedAnswer)) {
    throw new Error(`Invalid answer word: ${selectedAnswer}`);
  }

  // Create commitment
  const { salt, commitHash } = createCommitment(selectedAnswer);

  // Insert round into database
  const result = await db
    .insert(rounds)
    .values({
      rulesetId,
      answer: selectedAnswer,
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

  return {
    id: round.id,
    rulesetId: round.rulesetId,
    answer: round.answer,
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
 */
export async function getActiveRound(): Promise<Round | null> {
  const result = await db
    .select()
    .from(rounds)
    .where(isNull(rounds.resolvedAt))
    .orderBy(rounds.startedAt)
    .limit(1);

  if (result.length === 0) {
    return null;
  }

  const round = result[0];
  return {
    id: round.id,
    rulesetId: round.rulesetId,
    answer: round.answer,
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
 * @param opts Optional configuration for round creation
 * @returns The active round (existing or newly created)
 */
export async function ensureActiveRound(opts?: CreateRoundOptions): Promise<Round> {
  const activeRound = await getActiveRound();

  if (activeRound) {
    return activeRound;
  }

  // No active round exists, create one
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
    answer: round.answer,
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

  // Update the round
  const result = await db
    .update(rounds)
    .set({
      resolvedAt: new Date(),
      winnerFid,
      referrerFid: referrerFid ?? null,
    })
    .where(eq(rounds.id, roundId))
    .returning();

  const round = result[0];

  console.log(`✅ Resolved round ${roundId} with winner FID: ${winnerFid}`);

  return {
    id: round.id,
    rulesetId: round.rulesetId,
    answer: round.answer,
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
 * Verify round commitment (for transparency after resolution)
 *
 * @param round The round to verify
 * @returns true if commitment is valid
 */
export function verifyRoundCommitment(round: Round): boolean {
  return verifyCommit(round.salt, round.answer, round.commitHash);
}

import { db, rounds } from '../db';
import { eq, isNull } from 'drizzle-orm';
import type { Round } from '../types';
import { getRandomAnswerWord, isValidAnswer } from './word-lists';
import { createCommitment, verifyCommit } from './commit-reveal';

/**
 * Create a new round
 *
 * @param rulesetId Game rules ID to use (default 1)
 * @param answer Optional specific answer (for testing). If not provided, a random answer is chosen.
 * @returns The created round
 */
export async function createRound(
  rulesetId: number = 1,
  answer?: string
): Promise<Round> {
  // Select answer
  const selectedAnswer = answer || getRandomAnswerWord();

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
export async function getCurrentRound(): Promise<Round | null> {
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
 */
export async function resolveRound(
  roundId: number,
  winnerFid: number,
  referrerFid?: number
): Promise<Round> {
  const result = await db
    .update(rounds)
    .set({
      resolvedAt: new Date(),
      winnerFid,
      referrerFid: referrerFid || null,
    })
    .where(eq(rounds.id, roundId))
    .returning();

  if (result.length === 0) {
    throw new Error(`Round ${roundId} not found`);
  }

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

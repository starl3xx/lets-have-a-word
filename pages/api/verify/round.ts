/**
 * Verification Data API
 * Milestone 10: Provably Fair Verification
 * Milestone 10.1: On-chain commitment verification
 *
 * Returns the data needed to verify a round's commit-reveal fairness.
 *
 * GET /api/verify/round
 * Query params:
 *   - round: (optional) Round number to verify. If omitted, returns latest completed round.
 *
 * Response:
 * {
 *   roundNumber: number,
 *   status: 'resolved' | 'active' | 'cancelled',
 *   commitHash: string,
 *   onChainCommitHash?: string, // On-chain commitment hash (if available)
 *   hasOnChainCommitment: boolean,
 *   revealedWord?: string,      // Only if revealed
 *   revealedSalt?: string,      // Only if revealed
 *   roundStartedAt: string,
 *   roundEndedAt?: string,      // Only if resolved
 * }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../src/db';
import { rounds, roundArchive } from '../../../src/db/schema';
import { eq, desc, isNotNull, and } from 'drizzle-orm';
import { getPlaintextAnswer } from '../../../src/lib/encryption';
import { getCommitHashOnChain, hasOnChainCommitment as checkOnChainCommitment, isContractDeployed } from '../../../src/lib/jackpot-contract';

export interface VerifyRoundResponse {
  roundNumber: number;
  status: 'resolved' | 'active' | 'cancelled';
  commitHash: string;
  onChainCommitHash?: string; // On-chain commitment hash (null if no on-chain commitment)
  hasOnChainCommitment: boolean;
  revealedWord?: string;
  revealedSalt?: string;
  roundStartedAt: string;
  roundEndedAt?: string;
}

export interface VerifyRoundErrorResponse {
  error: string;
  code?: 'NOT_FOUND' | 'INVALID_ROUND' | 'NO_ROUNDS';
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<VerifyRoundResponse | VerifyRoundErrorResponse>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { round: roundParam } = req.query;

    let roundNumber: number | null = null;

    // If round param provided, parse it
    if (roundParam && typeof roundParam === 'string') {
      roundNumber = parseInt(roundParam, 10);
      if (isNaN(roundNumber) || roundNumber < 1) {
        return res.status(400).json({
          error: 'Invalid round number. Please provide a positive integer.',
          code: 'INVALID_ROUND',
        });
      }
    }

    // If no round specified, get the latest completed round
    if (roundNumber === null) {
      const [latestResolved] = await db
        .select()
        .from(rounds)
        .where(
          and(
            isNotNull(rounds.resolvedAt),
            eq(rounds.status, 'resolved')
          )
        )
        .orderBy(desc(rounds.id))
        .limit(1);

      if (!latestResolved) {
        return res.status(404).json({
          error: 'No completed rounds found yet.',
          code: 'NO_ROUNDS',
        });
      }

      roundNumber = latestResolved.id;
    }

    // Get round data from the rounds table (contains the ORIGINAL commitHash)
    const [roundData] = await db
      .select()
      .from(rounds)
      .where(eq(rounds.id, roundNumber))
      .limit(1);

    if (!roundData) {
      return res.status(404).json({
        error: `Round ${roundNumber} not found.`,
        code: 'NOT_FOUND',
      });
    }

    // Milestone 10.1: Fetch on-chain commitment data
    let onChainCommitHash: string | null = null;
    let hasOnChainCommit = false;

    try {
      const contractDeployed = await isContractDeployed();
      if (contractDeployed) {
        // Get on-chain commitment hash
        onChainCommitHash = await getCommitHashOnChain(roundNumber);
        hasOnChainCommit = onChainCommitHash !== null;
      }
    } catch (error) {
      // Log but don't fail - on-chain data is supplementary
      console.error('[api/verify/round] Failed to fetch on-chain commitment:', error);
    }

    // Also check archive for additional data (timestamps may differ)
    const [archivedRound] = await db
      .select()
      .from(roundArchive)
      .where(eq(roundArchive.roundNumber, roundNumber))
      .limit(1);

    // If archived, use archive timestamps but ALWAYS use original commitHash from rounds table
    if (archivedRound) {
      return res.status(200).json({
        roundNumber: archivedRound.roundNumber,
        status: 'resolved',
        // Use the ORIGINAL commitHash that was stored before the round started
        commitHash: roundData.commitHash,
        onChainCommitHash: onChainCommitHash || undefined,
        hasOnChainCommitment: hasOnChainCommit,
        revealedWord: archivedRound.targetWord,
        revealedSalt: archivedRound.salt,
        roundStartedAt: archivedRound.startTime.toISOString(),
        roundEndedAt: archivedRound.endTime.toISOString(),
      });
    }

    // Determine status
    let status: 'resolved' | 'active' | 'cancelled';
    if (roundData.status === 'cancelled') {
      status = 'cancelled';
    } else if (roundData.resolvedAt) {
      status = 'resolved';
    } else {
      status = 'active';
    }

    // For resolved rounds, reveal the word and salt
    if (status === 'resolved') {
      return res.status(200).json({
        roundNumber: roundData.id,
        status: 'resolved',
        commitHash: roundData.commitHash,
        onChainCommitHash: onChainCommitHash || undefined,
        hasOnChainCommitment: hasOnChainCommit,
        revealedWord: getPlaintextAnswer(roundData.answer), // Decrypt for reveal
        revealedSalt: roundData.salt,
        roundStartedAt: roundData.startedAt.toISOString(),
        roundEndedAt: roundData.resolvedAt!.toISOString(),
      });
    }

    // For active or cancelled rounds, only show the commitment hash
    return res.status(200).json({
      roundNumber: roundData.id,
      status,
      commitHash: roundData.commitHash,
      onChainCommitHash: onChainCommitHash || undefined,
      hasOnChainCommitment: hasOnChainCommit,
      roundStartedAt: roundData.startedAt.toISOString(),
      roundEndedAt: roundData.cancelledAt?.toISOString(),
    });
  } catch (error) {
    console.error('[api/verify/round] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

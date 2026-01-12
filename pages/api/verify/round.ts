/**
 * Verification Data API
 * Milestone 10: Provably Fair Verification
 * Milestone 10.1: Onchain commitment verification
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
 *   onChainCommitHash?: string, // Onchain commitment hash (if available)
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
import { eq, desc, isNotNull, and, sql } from 'drizzle-orm';
import { getPlaintextAnswer } from '../../../src/lib/encryption';
import { getCommitHashOnChain, hasOnChainCommitment as checkOnChainCommitment, isContractDeployed } from '../../../src/lib/jackpot-contract';

export interface VerifyRoundResponse {
  roundNumber: number;
  status: 'resolved' | 'active' | 'cancelled';
  commitHash: string;
  onChainCommitHash?: string; // Onchain commitment hash (null if no onchain commitment)
  hasOnChainCommitment: boolean;
  startTxHash?: string; // Transaction hash for startRoundWithCommitment
  revealedWord?: string;
  revealedSalt?: string;
  roundStartedAt: string;
  roundEndedAt?: string;
  // Bonus Words Feature: Bonus words commitment (if enabled for this round)
  bonusWordsCommitHash?: string;
  hasBonusWords?: boolean;
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

    // If no round specified, get the latest round (active or completed)
    if (roundNumber === null) {
      const [latestRound] = await db
        .select({ id: rounds.id })
        .from(rounds)
        .orderBy(desc(rounds.id))
        .limit(1);

      if (!latestRound) {
        return res.status(404).json({
          error: 'No rounds found yet.',
          code: 'NO_ROUNDS',
        });
      }

      roundNumber = latestRound.id;
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

    // Milestone 10.1: Fetch onchain commitment data
    let onChainCommitHash: string | null = null;
    let hasOnChainCommit = false;

    try {
      const contractDeployed = await isContractDeployed();
      if (contractDeployed) {
        // Get onchain commitment hash
        onChainCommitHash = await getCommitHashOnChain(roundNumber);
        hasOnChainCommit = onChainCommitHash !== null;
      }
    } catch (error) {
      // Log but don't fail - onchain data is supplementary
      console.error('[api/verify/round] Failed to fetch onchain commitment:', error);
    }

    // Fetch startTxHash via raw SQL (column may not exist yet)
    let startTxHash: string | undefined;
    try {
      const startTxResult = await db.execute(
        sql`SELECT start_tx_hash FROM rounds WHERE id = ${roundNumber} LIMIT 1`
      );
      const rows = Array.isArray(startTxResult) ? startTxResult : startTxResult.rows || [];
      if (rows[0]?.start_tx_hash) {
        startTxHash = rows[0].start_tx_hash;
      }
    } catch {
      // Column doesn't exist yet - migration 0015 not applied
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
        startTxHash,
        revealedWord: archivedRound.targetWord,
        revealedSalt: archivedRound.salt,
        roundStartedAt: archivedRound.startTime.toISOString(),
        roundEndedAt: archivedRound.endTime.toISOString(),
        // Bonus Words Feature
        bonusWordsCommitHash: roundData.bonusWordsCommitHash || undefined,
        hasBonusWords: !!roundData.bonusWordsCommitHash,
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
        startTxHash,
        revealedWord: getPlaintextAnswer(roundData.answer), // Decrypt for reveal
        revealedSalt: roundData.salt,
        roundStartedAt: roundData.startedAt.toISOString(),
        roundEndedAt: roundData.resolvedAt!.toISOString(),
        // Bonus Words Feature
        bonusWordsCommitHash: roundData.bonusWordsCommitHash || undefined,
        hasBonusWords: !!roundData.bonusWordsCommitHash,
      });
    }

    // For active or cancelled rounds, only show the commitment hash
    return res.status(200).json({
      roundNumber: roundData.id,
      status,
      commitHash: roundData.commitHash,
      onChainCommitHash: onChainCommitHash || undefined,
      hasOnChainCommitment: hasOnChainCommit,
      startTxHash,
      roundStartedAt: roundData.startedAt.toISOString(),
      roundEndedAt: roundData.cancelledAt?.toISOString(),
      // Bonus Words Feature
      bonusWordsCommitHash: roundData.bonusWordsCommitHash || undefined,
      hasBonusWords: !!roundData.bonusWordsCommitHash,
    });
  } catch (error) {
    console.error('[api/verify/round] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Round Health Check API
 *
 * Checks for potential issues that could affect round resolution:
 * - Legacy guesses without guessIndexInRound
 * - Users missing from users table
 * - Onchain guess log coverage (the thing /verify rests on)
 * - Other data integrity issues
 *
 * Defaults to the active round. Pass ?roundId= to inspect a round that has
 * already resolved — which is the only way to diagnose a guess log that stopped
 * advancing, because that is normally noticed after the round is over.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../../src/db';
import { guesses, users, rounds } from '../../../../src/db/schema';
import { eq, isNull, isNotNull, and, sql, inArray } from 'drizzle-orm';
import { isAdminFid } from '../me';
import { TOP10_LOCK_AFTER_GUESSES } from '../../../../src/lib/top10-lock';
import {
  getGuessLogIntegrity,
  getFirstLoggedRound,
  GUESS_LOG_LAG_WARNING,
} from '../../../../src/lib/guess-log';
import { getOnchainLogState, isGuessLogConfigured } from '../../../../src/lib/guess-log-contract';

interface RoundHealthResponse {
  ok: boolean;
  roundId: number | null;
  /**
   * Which currency this round pays in. Carried because every rounds read in
   * this repo carries the discriminator — it is optional in TypeScript, so
   * dropping it type-checks and silently reads as an ETH round.
   */
  prizeCurrency: string | null;
  checks: {
    legacyGuesses: {
      status: 'ok' | 'warning' | 'error';
      message: string;
      details: {
        totalGuesses: number;
        indexedGuesses: number;
        legacyGuesses: number;
        hasIndexedGuesses: boolean;
      };
    };
    userRecords: {
      status: 'ok' | 'warning' | 'error';
      message: string;
      details: {
        uniqueGuessers: number;
        missingUserRecords: number;
        missingFids: number[];
      };
    };
    top10Eligibility: {
      status: 'ok' | 'warning' | 'error';
      message: string;
      details: {
        eligibleGuesses: number;
        top10LockThreshold: number;
        isLocked: boolean;
      };
    };
    guessLog: {
      status: 'ok' | 'warning' | 'error';
      message: string;
      details: {
        configured: boolean;
        totalGuesses: number;
        indexedGuesses: number;
        committedLeaves: number;
        uncommittedGuesses: number;
        checkpointCount: number;
        /** Null when the chain could not be read — the local half still stands. */
        onchainLeaves: number | null;
        onchainCheckpoints: number | null;
        /** Why the chain could not be read, when it could not. */
        onchainReadError: string | null;
        duplicateIndexCount: number;
        duplicateIndexes: number[];
        missingIndexCount: number;
        missingIndexes: number[];
      };
    };
  };
  timestamp: string;
}

/** Sample size for the broken-index lists, so a wrecked round cannot return megabytes. */
const INDEX_SAMPLE_LIMIT = 20;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<RoundHealthResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check admin access
  const devFid = parseInt(req.query.devFid as string, 10);
  if (!devFid || !isAdminFid(devFid)) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  // An explicit round beats the active one. Without it a resolved round cannot
  // be inspected at all, and a resolved round is where an orphaned guess-log
  // tail is found.
  let requestedRoundId: number | null = null;
  if (req.query.roundId !== undefined) {
    const parsed = parseInt(String(req.query.roundId), 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return res.status(400).json({ error: 'roundId must be a positive integer' });
    }
    requestedRoundId = parsed;
  }

  try {
    // Get the round to inspect: the requested one, else the active one.
    // Carries the currency columns, per the rule that nothing reads a rounds
    // row without its discriminator.
    const [targetRound] = await db
      .select({
        id: rounds.id,
        prizeCurrency: rounds.prizeCurrency,
        prizePoolWord: rounds.prizePoolWord,
        seedPriceE18: rounds.seedPriceE18,
        resolvedAt: rounds.resolvedAt,
      })
      .from(rounds)
      .where(requestedRoundId !== null ? eq(rounds.id, requestedRoundId) : isNull(rounds.resolvedAt))
      .limit(1);

    if (!targetRound && requestedRoundId !== null) {
      return res.status(404).json({ error: `Round ${requestedRoundId} not found` });
    }

    if (!targetRound) {
      return res.status(200).json({
        ok: true,
        roundId: null,
        prizeCurrency: null,
        checks: {
          legacyGuesses: {
            status: 'ok',
            message: 'No active round',
            details: { totalGuesses: 0, indexedGuesses: 0, legacyGuesses: 0, hasIndexedGuesses: false },
          },
          userRecords: {
            status: 'ok',
            message: 'No active round',
            details: { uniqueGuessers: 0, missingUserRecords: 0, missingFids: [] },
          },
          top10Eligibility: {
            status: 'ok',
            message: 'No active round',
            details: { eligibleGuesses: 0, top10LockThreshold: TOP10_LOCK_AFTER_GUESSES, isLocked: false },
          },
          guessLog: {
            status: 'ok',
            message: 'No active round - pass ?roundId= to inspect a resolved round',
            details: {
              configured: isGuessLogConfigured(),
              totalGuesses: 0,
              indexedGuesses: 0,
              committedLeaves: 0,
              uncommittedGuesses: 0,
              checkpointCount: 0,
              onchainLeaves: null,
              onchainCheckpoints: null,
              onchainReadError: null,
              duplicateIndexCount: 0,
              duplicateIndexes: [],
              missingIndexCount: 0,
              missingIndexes: [],
            },
          },
        },
        timestamp: new Date().toISOString(),
      });
    }

    const roundId = targetRound.id;
    const isResolved = targetRound.resolvedAt !== null;

    // Check 1: Legacy guesses (missing guessIndexInRound)
    const [guessStats] = await db
      .select({
        total: sql<number>`count(*)::int`,
        indexed: sql<number>`count(${guesses.guessIndexInRound})::int`,
        legacy: sql<number>`count(*) filter (where ${guesses.guessIndexInRound} is null)::int`,
      })
      .from(guesses)
      .where(eq(guesses.roundId, roundId));

    const hasIndexedGuesses = guessStats.indexed > 0;
    const hasLegacyGuesses = guessStats.legacy > 0;
    const isMixedRound = hasIndexedGuesses && hasLegacyGuesses;

    let legacyStatus: 'ok' | 'warning' | 'error' = 'ok';
    let legacyMessage = 'All guesses have proper indexing';

    if (isMixedRound) {
      legacyStatus = 'warning';
      legacyMessage = `Mixed round: ${guessStats.legacy} legacy guesses will be excluded from top-10 rankings`;
    } else if (!hasIndexedGuesses && guessStats.total > 0) {
      legacyStatus = 'warning';
      legacyMessage = `Legacy round: all ${guessStats.total} guesses lack indexing (will use fallback logic)`;
    }

    // Check 2: Missing user records
    const guesserFids = await db
      .selectDistinct({ fid: guesses.fid })
      .from(guesses)
      .where(eq(guesses.roundId, roundId));

    const fidList = guesserFids.map(g => g.fid);

    let missingFids: number[] = [];
    if (fidList.length > 0) {
      const existingUsers = await db
        .select({ fid: users.fid })
        .from(users)
        .where(inArray(users.fid, fidList));

      const existingFidSet = new Set(existingUsers.map(u => u.fid));
      missingFids = fidList.filter(fid => !existingFidSet.has(fid));
    }

    let userStatus: 'ok' | 'warning' | 'error' = 'ok';
    let userMessage = 'All guessers have user records';

    if (missingFids.length > 0) {
      userStatus = 'error';
      userMessage = `${missingFids.length} guessers missing from users table - resolution may fail`;
    }

    // Check 3: Top-10 eligibility
    const [eligibleStats] = await db
      .select({
        count: sql<number>`count(*)::int`,
      })
      .from(guesses)
      .where(
        and(
          eq(guesses.roundId, roundId),
          hasIndexedGuesses
            ? and(isNotNull(guesses.guessIndexInRound), sql`${guesses.guessIndexInRound} <= ${TOP10_LOCK_AFTER_GUESSES}`)
            : sql`true`
        )
      );

    const isLocked = guessStats.total >= TOP10_LOCK_AFTER_GUESSES;

    let top10Status: 'ok' | 'warning' | 'error' = 'ok';
    let top10Message = isLocked
      ? `Top-10 locked at ${TOP10_LOCK_AFTER_GUESSES} guesses`
      : `${TOP10_LOCK_AFTER_GUESSES - guessStats.total} guesses until top-10 lock`;

    // Check 4: Onchain guess log
    //
    // /verify rests on this. The Merkle checkpoints are what make the guess
    // ORDERING provable after the fact — who guessed the word first, and the
    // 1..850 that sets the top-10 payouts. Both of the checkpointer's stop
    // conditions return HTTP 200 by design (a cron that errors gets disabled),
    // so a stalled log is invisible in Vercel. This is where it becomes visible.
    const integrity = await getGuessLogIntegrity(roundId);
    const guessLogConfigured = isGuessLogConfigured();
    const firstLoggedRound = await getFirstLoggedRound();

    // The contract's own count, when the chain is reachable. A disagreement
    // between it and the local table is the exact condition postNextCheckpoint
    // refuses to post through, so showing both numbers is showing the cause.
    let onchainLeaves: number | null = null;
    let onchainCheckpoints: number | null = null;
    let onchainReadError: string | null = null;
    if (guessLogConfigured) {
      try {
        const onchain = await getOnchainLogState(roundId);
        onchainLeaves = onchain.leaves;
        onchainCheckpoints = onchain.checkpoints;
      } catch (error) {
        // The dashboard still has to render when Base is unreachable, and the
        // local half of the comparison is the half that names a broken index.
        // The failure is KEPT rather than only logged: the table-vs-contract
        // comparison below is the one that identifies round 34's stall class,
        // and a check that could not run must not come back green.
        onchainReadError = error instanceof Error ? error.message : 'Unknown error';
        console.error('[round-health] Could not read GuessLog onchain state:', error);
      }
    }

    let guessLogStatus: 'ok' | 'warning' | 'error' = 'ok';
    let guessLogMessage: string;

    if (!guessLogConfigured) {
      guessLogMessage = 'GuessLog is not configured - the onchain guess log is dormant';
    } else if (firstLoggedRound === null) {
      // SILENCE IS NOT SUCCESS. The era floor is derived from the checkpoint
      // table, so "no checkpoint has ever landed" used to fall into the same
      // branch as "this round predates the log" and report ok. Those are the
      // bootstrap state and the total-failure state of the feature, and on
      // 2026-08-17 it was the second one: every post was refused with
      // NonContiguous(expected 0, got 1) and the table stayed empty. Reporting
      // the live, completely uncommitted round as green is the one thing this
      // check exists not to do.
      if (integrity.indexedGuesses === 0) {
        guessLogMessage =
          'GuessLog is configured and has committed nothing yet - this round has no indexed guesses';
      } else if (!isResolved) {
        // A live round with indexed guesses and an empty checkpoint table. A
        // contract deployed minutes ago looks like this too, so the lag
        // threshold separates "has not ticked yet" from "is not working".
        guessLogStatus =
          integrity.indexedGuesses > GUESS_LOG_LAG_WARNING ? 'error' : 'warning';
        // The other branches lose their diagnosis in this state, so carry the
        // two things that say WHY nothing landed: a broken index sequence, and
        // a contract that already holds leaves the local table does not know
        // about.
        const brokenSequence =
          integrity.duplicateIndexes.length > 0 || integrity.missingIndexes.length > 0
            ? ` The index sequence is broken (${integrity.duplicateIndexes.length} duplicate, ` +
              `${integrity.missingIndexes.length} missing), which is what the checkpointer refuses on.`
            : '';
        const contractSays =
          onchainLeaves === null
            ? ' The contract could not be read.'
            : onchainLeaves > 0
              ? ` The contract already holds ${onchainLeaves} leaves the checkpoint table has no row for.`
              : '';
        guessLogMessage =
          `GuessLog is configured but no checkpoint has ever landed, for any round - ` +
          `${integrity.indexedGuesses} guesses in the live round are uncommitted.` +
          brokenSequence +
          contractSays;
      } else {
        guessLogStatus = 'warning';
        guessLogMessage =
          'GuessLog has never committed a checkpoint for any round, so whether this round ' +
          'predates the log or the log has never worked cannot be told apart';
      }
    } else if (roundId < firstLoggedRound) {
      // Zero checkpoints because the log never covered this round, not because
      // it broke. Without this the whole ETH era would read as a permanent error.
      guessLogMessage = 'Round predates the onchain guess log';
    } else if (integrity.duplicateIndexes.length > 0 || integrity.missingIndexes.length > 0) {
      guessLogStatus = 'error';
      guessLogMessage =
        `Guess index sequence is broken (${integrity.duplicateIndexes.length} duplicate, ` +
        `${integrity.missingIndexes.length} missing) - the checkpointer refuses to commit past it`;
    } else if (onchainLeaves !== null && onchainLeaves !== integrity.committedLeaves) {
      guessLogStatus = 'error';
      guessLogMessage =
        `Checkpoint table and contract disagree: contract holds ${onchainLeaves} leaves, ` +
        `local table holds ${integrity.committedLeaves} - nothing commits until this is reconciled`;
    } else if (isResolved && integrity.uncommittedGuesses > 0) {
      guessLogStatus = 'error';
      guessLogMessage =
        `Round resolved with ${integrity.uncommittedGuesses} guesses never committed, ` +
        `including the winning one`;
    } else if (integrity.uncommittedGuesses > GUESS_LOG_LAG_WARNING) {
      guessLogStatus = 'warning';
      guessLogMessage =
        `${integrity.uncommittedGuesses} guesses uncommitted - more than a checkpoint ` +
        `interval’s worth, so the checkpointer has probably stopped`;
    } else if (onchainLeaves === null) {
      // Half the comparison did not run. Green here would mean "the local table
      // looks fine", which is not the same claim as "the table and the contract
      // agree" - and the disagreement is the failure this check was added for.
      guessLogStatus = 'warning';
      guessLogMessage =
        `Local table holds ${integrity.committedLeaves} of ${integrity.indexedGuesses} guesses in ` +
        `${integrity.checkpointCount} checkpoints, but the contract could not be read, so the two ` +
        `halves were not compared (${onchainReadError ?? 'no reason reported'})`;
    } else {
      guessLogMessage =
        `${integrity.committedLeaves} of ${integrity.indexedGuesses} guesses committed ` +
        `in ${integrity.checkpointCount} checkpoints`;
    }

    // Overall health. Collected into an array rather than chained comparisons:
    // TypeScript narrows each of these to the values actually assigned to it,
    // so `top10Status === 'error'` read as a comparison with no overlap and
    // never type-checked. (The old `hasWarnings` was computed and never used.)
    const statuses = [legacyStatus, userStatus, top10Status, guessLogStatus];
    const hasErrors = statuses.includes('error');

    return res.status(200).json({
      ok: !hasErrors,
      roundId,
      prizeCurrency: targetRound.prizeCurrency,
      checks: {
        legacyGuesses: {
          status: legacyStatus,
          message: legacyMessage,
          details: {
            totalGuesses: guessStats.total,
            indexedGuesses: guessStats.indexed,
            legacyGuesses: guessStats.legacy,
            hasIndexedGuesses,
          },
        },
        userRecords: {
          status: userStatus,
          message: userMessage,
          details: {
            uniqueGuessers: fidList.length,
            missingUserRecords: missingFids.length,
            missingFids: missingFids.slice(0, 10), // Limit to first 10
          },
        },
        top10Eligibility: {
          status: top10Status,
          message: top10Message,
          details: {
            eligibleGuesses: eligibleStats.count,
            top10LockThreshold: TOP10_LOCK_AFTER_GUESSES,
            isLocked,
          },
        },
        guessLog: {
          status: guessLogStatus,
          message: guessLogMessage,
          details: {
            configured: guessLogConfigured,
            totalGuesses: integrity.totalGuesses,
            indexedGuesses: integrity.indexedGuesses,
            committedLeaves: integrity.committedLeaves,
            uncommittedGuesses: integrity.uncommittedGuesses,
            checkpointCount: integrity.checkpointCount,
            onchainLeaves,
            onchainCheckpoints,
            onchainReadError,
            // Counts first, then a sample: which indices are broken is the
            // diagnosis, but a wrecked round must not return megabytes of them.
            duplicateIndexCount: integrity.duplicateIndexes.length,
            duplicateIndexes: integrity.duplicateIndexes.slice(0, INDEX_SAMPLE_LIMIT),
            missingIndexCount: integrity.missingIndexes.length,
            missingIndexes: integrity.missingIndexes.slice(0, INDEX_SAMPLE_LIMIT),
          },
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[round-health] Error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

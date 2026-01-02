/**
 * Round Health Check API
 *
 * Checks for potential issues that could affect round resolution:
 * - Legacy guesses without guessIndexInRound
 * - Users missing from users table
 * - Other data integrity issues
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../../src/db';
import { guesses, users, rounds } from '../../../../src/db/schema';
import { eq, isNull, isNotNull, and, sql } from 'drizzle-orm';
import { isAdminFid } from '../me';
import { TOP10_LOCK_AFTER_GUESSES } from '../../../../src/lib/top10-lock';

interface RoundHealthResponse {
  ok: boolean;
  roundId: number | null;
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
  };
  timestamp: string;
}

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

  try {
    // Get active round
    const [activeRound] = await db
      .select({ id: rounds.id })
      .from(rounds)
      .where(isNull(rounds.resolvedAt))
      .limit(1);

    if (!activeRound) {
      return res.status(200).json({
        ok: true,
        roundId: null,
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
        },
        timestamp: new Date().toISOString(),
      });
    }

    const roundId = activeRound.id;

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
        .where(sql`${users.fid} = ANY(${fidList})`);

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

    // Overall health
    const hasErrors = legacyStatus === 'error' || userStatus === 'error' || top10Status === 'error';
    const hasWarnings = legacyStatus === 'warning' || userStatus === 'warning' || top10Status === 'warning';

    return res.status(200).json({
      ok: !hasErrors,
      roundId,
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
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[round-health] Error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

/**
 * Admin endpoint to manually archive a specific round
 *
 * GET: Show archive status for a round
 * POST: Archive the round
 *
 * Use when a round was resolved but not archived (e.g., before auto-archive was added)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from '../me';
import { archiveRound, getArchivedRound } from '../../../../src/lib/archive';
import { db } from '../../../../src/db';
import { rounds } from '../../../../src/db/schema';
import { eq } from 'drizzle-orm';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Verify admin authentication
  const devFid = req.query.devFid as string;
  if (!devFid || !isAdminFid(parseInt(devFid, 10))) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const roundId = parseInt(req.query.roundId as string || req.body?.roundId, 10);

  if (!roundId || isNaN(roundId)) {
    return res.status(400).json({ error: 'roundId is required' });
  }

  if (req.method === 'GET') {
    // Check archive status
    try {
      const [round] = await db
        .select()
        .from(rounds)
        .where(eq(rounds.id, roundId))
        .limit(1);

      if (!round) {
        return res.status(404).json({ error: `Round ${roundId} not found` });
      }

      const existingArchive = await getArchivedRound(roundId);

      return res.status(200).json({
        roundId,
        status: round.status,
        resolvedAt: round.resolvedAt,
        isResolved: !!round.resolvedAt,
        isArchived: !!existingArchive,
        archive: existingArchive ? {
          targetWord: existingArchive.targetWord,
          totalGuesses: existingArchive.totalGuesses,
          uniquePlayers: existingArchive.uniquePlayers,
          winnerFid: existingArchive.winnerFid,
          createdAt: existingArchive.createdAt,
        } : null,
        message: existingArchive
          ? `Round ${roundId} is already archived`
          : round.resolvedAt
            ? `Round ${roundId} is resolved but NOT archived - POST to archive it`
            : `Round ${roundId} is not resolved yet`,
      });
    } catch (error) {
      console.error('[archive-round] Error checking status:', error);
      return res.status(500).json({
        error: 'Failed to check archive status',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  if (req.method === 'POST') {
    const force = req.body?.force === true;

    try {
      console.log(`[archive-round] Admin FID ${devFid} archiving round ${roundId}${force ? ' (FORCE)' : ''}`);

      const result = await archiveRound({ roundId, force });

      if (result.success) {
        if (result.alreadyArchived) {
          return res.status(200).json({
            success: true,
            alreadyArchived: true,
            message: `Round ${roundId} was already archived`,
            archive: {
              targetWord: result.archived?.targetWord,
              totalGuesses: result.archived?.totalGuesses,
              uniquePlayers: result.archived?.uniquePlayers,
            },
          });
        }

        console.log(`[archive-round] ✅ Round ${roundId} archived successfully`);
        return res.status(200).json({
          success: true,
          message: `Round ${roundId} archived successfully`,
          archive: {
            targetWord: result.archived?.targetWord,
            totalGuesses: result.archived?.totalGuesses,
            uniquePlayers: result.archived?.uniquePlayers,
            winnerFid: result.archived?.winnerFid,
            finalJackpotEth: result.archived?.finalJackpotEth,
          },
        });
      } else {
        return res.status(400).json({
          success: false,
          error: result.error,
        });
      }
    } catch (error) {
      console.error('[archive-round] Error archiving round:', error);
      return res.status(500).json({
        error: 'Failed to archive round',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

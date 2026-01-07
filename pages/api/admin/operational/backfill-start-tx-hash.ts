/**
 * POST /api/admin/operational/backfill-start-tx-hash
 *
 * Backfill startTxHash for existing rounds.
 *
 * Requires admin authentication via devFid query param.
 *
 * Body:
 * - rounds: Array of { roundId: number, startTxHash: string }
 * - dryRun: If true, only show what would be updated without making changes
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db, rounds } from '../../../../src/db';
import { eq } from 'drizzle-orm';
import { isAdminFid } from '../../admin/me';

interface BackfillItem {
  roundId: number;
  startTxHash: string;
}

interface BackfillRequest {
  rounds: BackfillItem[];
  dryRun?: boolean;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Admin authentication via devFid
  let fid: number | undefined;
  if (req.query.devFid) {
    fid = parseInt(req.query.devFid as string, 10);
  } else if (req.cookies.siwn_fid) {
    fid = parseInt(req.cookies.siwn_fid, 10);
  }

  if (!fid || isNaN(fid)) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (!isAdminFid(fid)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const body = req.body as BackfillRequest;
    const { rounds: roundsToUpdate, dryRun = false } = body;

    if (!roundsToUpdate || !Array.isArray(roundsToUpdate) || roundsToUpdate.length === 0) {
      return res.status(400).json({ error: 'rounds array is required' });
    }

    // Validate all tx hashes
    for (const item of roundsToUpdate) {
      if (!item.roundId || typeof item.roundId !== 'number') {
        return res.status(400).json({ error: `Invalid roundId: ${item.roundId}` });
      }
      if (!item.startTxHash || !/^0x[a-fA-F0-9]{64}$/.test(item.startTxHash)) {
        return res.status(400).json({ error: `Invalid startTxHash for round ${item.roundId}: ${item.startTxHash}` });
      }
    }

    console.log(`🔄 Starting startTxHash backfill (${roundsToUpdate.length} rounds, dryRun=${dryRun})...`);

    const results: Array<{ roundId: number; status: string; startTxHash?: string }> = [];

    for (const item of roundsToUpdate) {
      // Check if round exists
      const [existingRound] = await db
        .select({ id: rounds.id, startTxHash: rounds.startTxHash })
        .from(rounds)
        .where(eq(rounds.id, item.roundId))
        .limit(1);

      if (!existingRound) {
        results.push({ roundId: item.roundId, status: 'not_found' });
        continue;
      }

      if (existingRound.startTxHash) {
        results.push({
          roundId: item.roundId,
          status: 'already_set',
          startTxHash: existingRound.startTxHash
        });
        continue;
      }

      if (dryRun) {
        results.push({
          roundId: item.roundId,
          status: 'would_update',
          startTxHash: item.startTxHash
        });
      } else {
        await db
          .update(rounds)
          .set({ startTxHash: item.startTxHash })
          .where(eq(rounds.id, item.roundId));

        results.push({
          roundId: item.roundId,
          status: 'updated',
          startTxHash: item.startTxHash
        });
        console.log(`✅ Updated round ${item.roundId} with startTxHash: ${item.startTxHash}`);
      }
    }

    const summary = {
      total: roundsToUpdate.length,
      updated: results.filter(r => r.status === 'updated').length,
      wouldUpdate: results.filter(r => r.status === 'would_update').length,
      alreadySet: results.filter(r => r.status === 'already_set').length,
      notFound: results.filter(r => r.status === 'not_found').length,
    };

    console.log(`✅ Backfill complete:`, summary);

    return res.status(200).json({
      success: true,
      dryRun,
      summary,
      results,
    });
  } catch (error) {
    console.error('❌ Backfill error:', error);
    return res.status(500).json({
      error: 'Backfill failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

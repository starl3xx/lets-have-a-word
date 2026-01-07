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
import { eq, sql } from 'drizzle-orm';
import { isAdminFid } from '../../admin/me';
import { cacheDel, CacheKeys } from '../../../../src/lib/redis';

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
      // Check if round exists and get current startTxHash via raw SQL
      // (column may not exist yet if migration 0015 hasn't been applied)
      const existingResult = await db.execute(
        sql`SELECT id, start_tx_hash FROM rounds WHERE id = ${item.roundId} LIMIT 1`
      );
      const rows = Array.isArray(existingResult) ? existingResult : existingResult.rows || [];
      const existingRound = rows[0] as { id: number; start_tx_hash: string | null } | undefined;

      if (!existingRound) {
        results.push({ roundId: item.roundId, status: 'not_found' });
        continue;
      }

      if (existingRound.start_tx_hash) {
        results.push({
          roundId: item.roundId,
          status: 'already_set',
          startTxHash: existingRound.start_tx_hash
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
        await db.execute(
          sql`UPDATE rounds SET start_tx_hash = ${item.startTxHash} WHERE id = ${item.roundId}`
        );

        // Clear archive cache so the new tx hash shows up immediately
        await cacheDel(CacheKeys.archiveRound(item.roundId));

        results.push({
          roundId: item.roundId,
          status: 'updated',
          startTxHash: item.startTxHash
        });
        console.log(`✅ Updated round ${item.roundId} with startTxHash: ${item.startTxHash} (cache cleared)`);
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

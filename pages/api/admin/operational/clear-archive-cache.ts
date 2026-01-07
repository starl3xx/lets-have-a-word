/**
 * POST /api/admin/operational/clear-archive-cache
 *
 * Clear the archive cache for specific rounds.
 * Useful when data has been backfilled but cache has stale data.
 *
 * Requires admin authentication via devFid query param.
 *
 * Body:
 * - roundIds: Array of round IDs to clear cache for
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from '../../admin/me';
import { cacheDel, CacheKeys } from '../../../../src/lib/redis';

interface ClearCacheRequest {
  roundIds: number[];
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
    const body = req.body as ClearCacheRequest;
    const { roundIds } = body;

    if (!roundIds || !Array.isArray(roundIds) || roundIds.length === 0) {
      return res.status(400).json({ error: 'roundIds array is required' });
    }

    console.log(`🗑️ Clearing archive cache for rounds: ${roundIds.join(', ')}`);

    const results: Array<{ roundId: number; status: string }> = [];

    for (const roundId of roundIds) {
      if (typeof roundId !== 'number' || isNaN(roundId)) {
        results.push({ roundId, status: 'invalid' });
        continue;
      }

      await cacheDel(CacheKeys.archiveRound(roundId));
      results.push({ roundId, status: 'cleared' });
      console.log(`✅ Cleared cache for round ${roundId}`);
    }

    return res.status(200).json({
      success: true,
      cleared: results.filter(r => r.status === 'cleared').length,
      results,
    });
  } catch (error) {
    console.error('❌ Clear cache error:', error);
    return res.status(500).json({
      error: 'Failed to clear cache',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * List Archived Rounds API
 * Milestone 5.4: Round archive
 *
 * Returns a paginated list of archived rounds
 *
 * GET /api/archive/list
 * Query params:
 *   - limit: number (default: 20, max: 100)
 *   - offset: number (default: 0)
 *   - order: 'asc' | 'desc' (default: 'desc')
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getArchivedRounds, getArchiveStats } from '../../../src/lib/archive';
import type { RoundArchiveRow } from '../../../src/db/schema';
import { cacheAside, CacheKeys, CacheTTL } from '../../../src/lib/redis';

export interface ArchiveListResponse {
  rounds: RoundArchiveRow[];
  total: number;
  limit: number;
  offset: number;
  stats?: {
    totalRounds: number;
    totalGuessesAllTime: number;
    uniqueWinners: number;
    totalJackpotDistributed: string;
    avgGuessesPerRound: number;
    avgPlayersPerRound: number;
    avgRoundLengthMinutes: number;
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ArchiveListResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Parse query params
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const orderBy = (req.query.order as 'asc' | 'desc') === 'asc' ? 'asc' : 'desc';
    const includeStats = req.query.stats === 'true';

    // Cache key includes pagination params
    const cacheKey = CacheKeys.archiveList(limit, offset);
    const cachedResponse = await cacheAside<ArchiveListResponse>(
      cacheKey,
      CacheTTL.archiveList,
      async () => {
        // Get archived rounds
        const { rounds, total } = await getArchivedRounds({ limit, offset, orderBy });

        // Serialize decimal/date values
        const serializedRounds = rounds.map(serializeArchiveRow);

        // Optionally include stats
        let stats;
        if (includeStats) {
          stats = await getArchiveStats();
        }

        return {
          rounds: serializedRounds,
          total,
          limit,
          offset,
          stats,
        };
      }
    );

    return res.status(200).json(cachedResponse);
  } catch (error) {
    console.error('[api/archive/list] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Serialize archive row for JSON response
 */
function serializeArchiveRow(row: RoundArchiveRow): any {
  return {
    ...row,
    seedEth: row.seedEth.toString(),
    finalJackpotEth: row.finalJackpotEth.toString(),
    startTime: row.startTime.toISOString(),
    endTime: row.endTime.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

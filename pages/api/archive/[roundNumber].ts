/**
 * Get Archived Round by Number API
 * Milestone 5.4: Round archive
 *
 * Returns a specific archived round by its number
 *
 * GET /api/archive/:roundNumber
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getArchivedRoundWithUsernames, getRoundGuessDistribution, type ArchivedRoundWithUsernames } from '../../../src/lib/archive';
import { cacheAside, CacheKeys, CacheTTL } from '../../../src/lib/redis';

export interface ArchiveDetailResponse {
  round: ArchivedRoundWithUsernames | null;
  distribution?: {
    distribution: Array<{ hour: number; count: number }>;
    byPlayer: Array<{ fid: number; count: number }>;
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ArchiveDetailResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { roundNumber } = req.query;
    const includeDistribution = req.query.distribution === 'true';
    const noCache = req.query.nocache === 'true';

    if (!roundNumber || typeof roundNumber !== 'string') {
      return res.status(400).json({ error: 'Round number is required' });
    }

    const roundNum = parseInt(roundNumber, 10);
    if (isNaN(roundNum) || roundNum < 1) {
      return res.status(400).json({ error: 'Invalid round number' });
    }

    // Use cache for immutable archive data (1 hour TTL)
    // Pass TTL of 0 to bypass cache when nocache=true
    const cacheKey = CacheKeys.archiveRound(roundNum);
    const cacheTTL = noCache ? 0 : CacheTTL.archiveRound;
    const cachedRound = await cacheAside<ArchiveDetailResponse>(
      cacheKey,
      cacheTTL,
      async () => {
        const round = await getArchivedRoundWithUsernames(roundNum);

        if (!round) {
          return { round: null };
        }

        // Serialize decimal/date values
        const serialized = serializeArchiveRow(round);

        // Optionally include guess distribution
        let distribution;
        if (includeDistribution) {
          distribution = await getRoundGuessDistribution(roundNum);
        }

        return { round: serialized, distribution };
      }
    );

    if (!cachedRound.round) {
      return res.status(404).json({ error: `Round ${roundNum} not found in archive` });
    }

    return res.status(200).json(cachedRound);
  } catch (error) {
    console.error('[api/archive/[roundNumber]] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Serialize archive row for JSON response
 */
function serializeArchiveRow(row: ArchivedRoundWithUsernames): any {
  return {
    ...row,
    seedEth: row.seedEth.toString(),
    finalJackpotEth: row.finalJackpotEth.toString(),
    startTime: row.startTime.toISOString(),
    endTime: row.endTime.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

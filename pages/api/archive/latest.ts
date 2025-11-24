/**
 * Get Latest Archived Round API
 * Milestone 5.4: Round archive
 *
 * Returns the most recently archived round
 *
 * GET /api/archive/latest
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getLatestArchivedRound } from '../../../src/lib/archive';
import type { RoundArchiveRow } from '../../../src/db/schema';

export interface LatestArchiveResponse {
  round: RoundArchiveRow | null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<LatestArchiveResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const round = await getLatestArchivedRound();

    // Serialize decimal/date values
    const serialized = round ? serializeArchiveRow(round) : null;

    return res.status(200).json({ round: serialized });
  } catch (error) {
    console.error('[api/archive/latest] Error:', error);
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

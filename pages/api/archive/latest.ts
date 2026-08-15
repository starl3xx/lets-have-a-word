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
    // Nullable since migration 0022, and actually null from round 34: a $WORD
    // round records its prize in seed_word / final_jackpot_word and leaves the
    // ETH pair empty. Calling .toString() on that threw, so the endpoint 500'd
    // on the whole page rather than the one row. Null passes through as null;
    // the read side already branches on `currency`.
    seedEth: row.seedEth?.toString() ?? null,
    finalJackpotEth: row.finalJackpotEth?.toString() ?? null,
    startTime: row.startTime.toISOString(),
    endTime: row.endTime.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Bonus & Burn Word Status API
 * Milestone 14: Returns per-round discovery counts for both bonus and burn words
 *
 * GET /api/bonus-burn-status?roundId=N
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../src/db';
import { roundBonusWords, roundBurnWords } from '../../src/db/schema';
import { eq, sql } from 'drizzle-orm';
import { isDevModeEnabled } from '../../src/lib/devGameState';

export interface BonusBurnStatusResponse {
  roundId: number;
  bonusWords: {
    total: number;
    found: number;
    remaining: number;
  };
  burnWords: {
    total: number;
    found: number;
    remaining: number;
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<BonusBurnStatusResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const roundId = parseInt(req.query.roundId as string, 10);
  if (!roundId || isNaN(roundId)) {
    return res.status(400).json({ error: 'Valid roundId required' });
  }

  // Dev mode: return synthetic data
  if (isDevModeEnabled()) {
    return res.status(200).json({
      roundId,
      bonusWords: { total: 10, found: 3, remaining: 7 },
      burnWords: { total: 5, found: 1, remaining: 4 },
    });
  }

  try {
    const [bonusStats, burnStats] = await Promise.all([
      // Bonus words: count total and found (finderFid is set when found)
      db.select({
        total: sql<number>`count(*)`,
        found: sql<number>`count(${roundBonusWords.finderFid})`,
      }).from(roundBonusWords).where(eq(roundBonusWords.roundId, roundId)),

      // Burn words: count total and found (finderFid is set when found)
      db.select({
        total: sql<number>`count(*)`,
        found: sql<number>`count(${roundBurnWords.finderFid})`,
      }).from(roundBurnWords).where(eq(roundBurnWords.roundId, roundId)),
    ]);

    const bonusTotal = Number(bonusStats[0]?.total ?? 0);
    const bonusFound = Number(bonusStats[0]?.found ?? 0);
    const burnTotal = Number(burnStats[0]?.total ?? 0);
    const burnFound = Number(burnStats[0]?.found ?? 0);

    return res.status(200).json({
      roundId,
      bonusWords: {
        total: bonusTotal,
        found: bonusFound,
        remaining: bonusTotal - bonusFound,
      },
      burnWords: {
        total: burnTotal,
        found: burnFound,
        remaining: burnTotal - burnFound,
      },
    });
  } catch (error) {
    console.error('[bonus-burn-status] Error:', error);
    return res.status(500).json({ error: 'Failed to fetch status' });
  }
}

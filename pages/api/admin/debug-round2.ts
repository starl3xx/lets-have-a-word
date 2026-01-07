/**
 * Debug Round - Check what's in the database
 * GET /api/admin/debug-round2?devFid=XXX&roundId=2
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../src/db';
import { rounds } from '../../../src/db/schema';
import { eq } from 'drizzle-orm';
import { isAdminFid } from './me';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const fid = parseInt(req.query.devFid as string || req.cookies.siwn_fid || '', 10);
  if (!fid || !isAdminFid(fid)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const roundId = parseInt(req.query.roundId as string || '2', 10);

  try {
    const [round] = await db.select().from(rounds).where(eq(rounds.id, roundId));

    if (!round) {
      return res.status(404).json({ error: `Round ${roundId} not found` });
    }

    // Check ALL fields for type issues
    const fieldAnalysis: Record<string, any> = {};
    for (const [key, value] of Object.entries(round)) {
      fieldAnalysis[key] = {
        type: typeof value,
        isDate: value instanceof Date,
        constructorName: value?.constructor?.name,
        value: value instanceof Date ? value.toISOString() : value,
        length: typeof value === 'string' ? value.length : null,
      };
    }

    return res.status(200).json({
      roundId: round.id,
      status: round.status,
      fieldAnalysis,
      // Quick summary of problem fields
      problemFields: Object.entries(fieldAnalysis)
        .filter(([key, info]) => {
          // Fields that should be strings but are Dates
          const stringFields = ['answer', 'salt', 'commitHash', 'prizePoolEth', 'seedNextRoundEth'];
          return stringFields.includes(key) && info.isDate;
        })
        .map(([key, info]) => ({ field: key, ...info })),
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

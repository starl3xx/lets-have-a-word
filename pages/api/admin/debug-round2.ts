/**
 * Debug Round 2 - Check what's in the database
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

  try {
    const [round] = await db.select().from(rounds).where(eq(rounds.id, 2));

    if (!round) {
      return res.status(404).json({ error: 'Round 2 not found' });
    }

    return res.status(200).json({
      roundId: round.id,
      status: round.status,
      answerType: typeof round.answer,
      answerValue: round.answer,
      answerIsDate: round.answer instanceof Date,
      answerConstructorName: round.answer?.constructor?.name,
      answerStringified: JSON.stringify(round.answer),
      answerLength: typeof round.answer === 'string' ? round.answer.length : null,
      startedAt: round.startedAt,
      resolvedAt: round.resolvedAt,
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

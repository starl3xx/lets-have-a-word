/**
 * Fix Round Field API Endpoint
 *
 * POST /api/admin/fix-round-field
 *
 * Fixes a round's corrupted field (e.g., salt that became a Date).
 *
 * Body: { roundId: number, field: string, value: string }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from './me';
import { db } from '../../../src/db';
import { rounds } from '../../../src/db/schema';
import { eq, sql } from 'drizzle-orm';

// Fields that can be fixed with this endpoint
const FIXABLE_FIELDS = ['salt', 'commitHash', 'prizePoolEth', 'seedNextRoundEth', 'txHash'];

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Auth check
    let fid: number | null = null;
    if (req.query.devFid) {
      fid = parseInt(req.query.devFid as string, 10);
    } else if (req.cookies.siwn_fid) {
      fid = parseInt(req.cookies.siwn_fid, 10);
    } else if (req.body?.fid) {
      fid = parseInt(req.body.fid, 10);
    }

    if (!fid || isNaN(fid)) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!isAdminFid(fid)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { roundId, field, value } = req.body;

    if (!roundId || isNaN(parseInt(roundId, 10))) {
      return res.status(400).json({ error: 'roundId (number) is required' });
    }

    if (!field || typeof field !== 'string') {
      return res.status(400).json({ error: 'field (string) is required' });
    }

    if (!FIXABLE_FIELDS.includes(field)) {
      return res.status(400).json({
        error: `Field "${field}" is not fixable. Allowed: ${FIXABLE_FIELDS.join(', ')}`,
        hint: 'Use /api/admin/fix-round-answer to fix the answer field'
      });
    }

    if (value === undefined) {
      return res.status(400).json({ error: 'value is required' });
    }

    const roundIdNum = parseInt(roundId, 10);

    // Check round exists
    const [round] = await db.select().from(rounds).where(eq(rounds.id, roundIdNum));
    if (!round) {
      return res.status(404).json({ error: `Round ${roundIdNum} not found` });
    }

    // Log current state
    const currentValue = (round as any)[field];
    console.log(`[fix-round-field] Round ${roundIdNum} field "${field}" current type: ${typeof currentValue}`);
    console.log(`[fix-round-field] Round ${roundIdNum} field "${field}" current value: ${currentValue}`);
    console.log(`[fix-round-field] Round ${roundIdNum} field "${field}" isDate: ${currentValue instanceof Date}`);

    // Update using raw SQL to avoid type issues
    await db.execute(sql`
      UPDATE rounds
      SET ${sql.identifier(camelToSnake(field))} = ${value}
      WHERE id = ${roundIdNum}
    `);

    // Verify
    const [updatedRound] = await db.select().from(rounds).where(eq(rounds.id, roundIdNum));
    const newValue = (updatedRound as any)[field];

    console.log(`[fix-round-field] ✅ Round ${roundIdNum} field "${field}" fixed. New type: ${typeof newValue}`);

    return res.status(200).json({
      success: true,
      roundId: roundIdNum,
      field,
      oldValue: currentValue instanceof Date ? currentValue.toISOString() : currentValue,
      oldType: typeof currentValue,
      oldWasDate: currentValue instanceof Date,
      newValue,
      newType: typeof newValue,
      newIsDate: newValue instanceof Date,
    });

  } catch (error) {
    console.error('[fix-round-field] Error:', error);
    return res.status(500).json({
      error: 'Failed to fix round field',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

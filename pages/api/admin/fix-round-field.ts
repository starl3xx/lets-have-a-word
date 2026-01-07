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
  // GET: Show a simple form for admin to fix a field
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Fix Round Field</title></head>
      <body style="font-family: system-ui; max-width: 500px; margin: 50px auto; padding: 20px;">
        <h2>Fix Round Field</h2>
        <p style="color: #666;">Fix a corrupted field (e.g., salt that became a Date object).</p>
        <form method="POST">
          <div style="margin-bottom: 15px;">
            <label>Your Admin FID:</label><br/>
            <input type="number" name="fid" required style="width: 100%; padding: 8px; margin-top: 5px;" placeholder="e.g. 12345" />
          </div>
          <div style="margin-bottom: 15px;">
            <label>Round ID:</label><br/>
            <input type="number" name="roundId" required style="width: 100%; padding: 8px; margin-top: 5px;" placeholder="e.g. 2" />
          </div>
          <div style="margin-bottom: 15px;">
            <label>Field to fix:</label><br/>
            <select name="field" required style="width: 100%; padding: 8px; margin-top: 5px;">
              <option value="">-- Select field --</option>
              <option value="salt">salt</option>
              <option value="commitHash">commitHash</option>
              <option value="prizePoolEth">prizePoolEth</option>
              <option value="seedNextRoundEth">seedNextRoundEth</option>
              <option value="txHash">txHash</option>
            </select>
          </div>
          <div style="margin-bottom: 15px;">
            <label>New value (string):</label><br/>
            <input type="text" name="value" required style="width: 100%; padding: 8px; margin-top: 5px;" placeholder="The correct string value" />
          </div>
          <button type="submit" style="width: 100%; padding: 10px; background: #dc2626; color: white; border: none; cursor: pointer;">Fix Field</button>
        </form>
        <p style="margin-top: 20px; color: #666; font-size: 12px;">For the answer field, use <a href="/api/admin/fix-round-answer">/api/admin/fix-round-answer</a> instead.</p>
      </body>
      </html>
    `);
  }

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

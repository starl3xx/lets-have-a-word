/**
 * POST /api/admin/operational/apply-migration
 *
 * Apply a specific migration by name.
 * Used when migrations can't be run via CLI.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../../src/db';
import { sql } from 'drizzle-orm';
import { isAdminFid } from '../../admin/me';

const MIGRATIONS: Record<string, string> = {
  '0015_start_tx_hash': `
    ALTER TABLE rounds
    ADD COLUMN IF NOT EXISTS start_tx_hash VARCHAR(66);
  `,
};

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
    const { migration } = req.body;

    if (!migration || typeof migration !== 'string') {
      return res.status(400).json({
        error: 'migration name required',
        available: Object.keys(MIGRATIONS),
      });
    }

    const migrationSql = MIGRATIONS[migration];
    if (!migrationSql) {
      return res.status(400).json({
        error: `Unknown migration: ${migration}`,
        available: Object.keys(MIGRATIONS),
      });
    }

    console.log(`🔄 Applying migration: ${migration}`);
    await db.execute(sql.raw(migrationSql));
    console.log(`✅ Migration applied: ${migration}`);

    return res.status(200).json({
      success: true,
      migration,
      message: `Migration ${migration} applied successfully`,
    });
  } catch (error) {
    console.error('❌ Migration error:', error);
    return res.status(500).json({
      error: 'Migration failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

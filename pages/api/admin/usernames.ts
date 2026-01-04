/**
 * Admin API to lookup usernames for FIDs
 *
 * GET /api/admin/usernames?fids=123,456,789
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from './me';
import { db } from '../../../src/db';
import { users } from '../../../src/db/schema';
import { sql } from 'drizzle-orm';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth check
  const devFid = req.query.devFid ? parseInt(req.query.devFid as string, 10) : null;
  const fidFromCookie = req.cookies.siwn_fid ? parseInt(req.cookies.siwn_fid, 10) : null;
  const fid = devFid || fidFromCookie;

  if (!fid || !isAdminFid(fid)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const fidsParam = req.query.fids as string;
  if (!fidsParam) {
    return res.status(400).json({ error: 'fids parameter required' });
  }

  const fids = fidsParam.split(',').map(f => parseInt(f, 10)).filter(f => !isNaN(f));
  if (fids.length === 0) {
    return res.status(400).json({ error: 'No valid FIDs provided' });
  }

  try {
    const userRows = await db
      .select({ fid: users.fid, username: users.username })
      .from(users)
      .where(sql`${users.fid} IN (${sql.join(fids.map(f => sql`${f}`), sql`, `)})`);

    const usernames: Record<number, string> = {};
    for (const row of userRows) {
      if (row.username) {
        usernames[row.fid] = row.username;
      }
    }

    return res.status(200).json({ usernames });
  } catch (error) {
    console.error('[usernames] Error:', error);
    return res.status(500).json({ error: 'Failed to fetch usernames' });
  }
}

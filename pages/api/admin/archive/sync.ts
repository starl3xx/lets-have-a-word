/**
 * Sync Archive API (Admin Only)
 * Milestone 5.4: Round archive
 *
 * Archives all unarchived resolved rounds
 *
 * POST /api/admin/archive/sync
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from '../me';
import { syncAllRounds, archiveRound } from '../../../../src/lib/archive';

export interface ArchiveSyncResponse {
  archived: number;
  alreadyArchived: number;
  failed: number;
  errors: string[];
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ArchiveSyncResponse | { error: string }>
) {
  // GET: Show a simple form for admin to trigger sync
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Archive Sync</title></head>
      <body style="font-family: system-ui; max-width: 500px; margin: 50px auto; padding: 20px;">
        <h2>Archive Sync</h2>
        <p style="color: #666;">Sync all resolved rounds to the archive.</p>
        <form method="POST">
          <div style="margin-bottom: 15px;">
            <label>Your Admin FID:</label><br/>
            <input type="number" name="fid" required style="width: 100%; padding: 8px; margin-top: 5px;" placeholder="e.g. 12345" />
          </div>
          <div style="margin-bottom: 15px;">
            <label>Round ID (optional - leave blank to sync all):</label><br/>
            <input type="number" name="roundId" style="width: 100%; padding: 8px; margin-top: 5px;" placeholder="e.g. 2" />
          </div>
          <div style="margin-bottom: 15px;">
            <label style="display: flex; align-items: center; gap: 8px;">
              <input type="checkbox" name="force" value="true" />
              Force re-archive (delete and recreate existing archives)
            </label>
          </div>
          <button type="submit" style="width: 100%; padding: 10px; background: #2563eb; color: white; border: none; cursor: pointer;">Run Archive Sync</button>
        </form>
      </body>
      </html>
    `);
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get FID from dev mode, session, or form body
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

    // Check admin status
    if (!isAdminFid(fid)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Check if syncing a specific round
    const { roundId, force } = req.body || {};

    if (roundId) {
      // Archive specific round
      const roundNum = parseInt(roundId, 10);
      if (isNaN(roundNum)) {
        return res.status(400).json({ error: 'Invalid roundId' });
      }

      const result = await archiveRound({ roundId: roundNum, force: !!force });

      return res.status(200).json({
        archived: result.success && !result.alreadyArchived ? 1 : 0,
        alreadyArchived: result.alreadyArchived ? 1 : 0,
        failed: result.success ? 0 : 1,
        errors: result.error ? [`Round ${roundNum}: ${result.error}`] : [],
      });
    }

    // Sync all rounds
    const result = await syncAllRounds({ force: !!force });

    return res.status(200).json(result);
  } catch (error) {
    console.error('[api/admin/archive/sync] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

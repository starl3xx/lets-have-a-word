/**
 * Resolve Archive Error API (Admin Only)
 *
 * POST /api/admin/archive/resolve-error
 *
 * Marks an archive error as resolved after manual intervention.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from '../me';
import { db } from '../../../../src/db';
import { roundArchiveErrors } from '../../../../src/db/schema';
import { eq } from 'drizzle-orm';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get FID from dev mode or session
    let fid: number | null = null;

    if (req.query.devFid) {
      fid = parseInt(req.query.devFid as string, 10);
    } else if (req.cookies.siwn_fid) {
      fid = parseInt(req.cookies.siwn_fid, 10);
    }

    if (!fid || isNaN(fid)) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Check admin status
    if (!isAdminFid(fid)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { errorId } = req.body;
    if (!errorId || typeof errorId !== 'number') {
      return res.status(400).json({ error: 'errorId is required' });
    }

    // Mark the error as resolved
    const [updated] = await db
      .update(roundArchiveErrors)
      .set({
        resolved: true,
        resolvedAt: new Date(),
        resolvedBy: fid,
      })
      .where(eq(roundArchiveErrors.id, errorId))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: 'Error not found' });
    }

    return res.status(200).json({
      success: true,
      error: {
        id: updated.id,
        roundNumber: updated.roundNumber,
        resolved: updated.resolved,
        resolvedAt: updated.resolvedAt?.toISOString(),
        resolvedBy: updated.resolvedBy,
      },
    });
  } catch (error) {
    console.error('[api/admin/archive/resolve-error] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

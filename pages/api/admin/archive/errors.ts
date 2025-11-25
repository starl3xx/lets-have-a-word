/**
 * Archive Errors API (Admin Only)
 * Milestone 5.4: Round archive
 *
 * Returns archive errors for admin review
 *
 * GET /api/admin/archive/errors
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from '../me';
import { getArchiveErrors } from '../../../../src/lib/archive';

export interface ArchiveErrorsResponse {
  errors: any[];
  total: number;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ArchiveErrorsResponse | { error: string }>
) {
  if (req.method !== 'GET') {
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

    const unresolvedOnly = req.query.unresolved !== 'false';
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    const { errors, total } = await getArchiveErrors({ unresolvedOnly, limit });

    // Serialize dates
    const serializedErrors = errors.map(e => ({
      ...e,
      createdAt: e.createdAt?.toISOString(),
      resolvedAt: e.resolvedAt?.toISOString(),
    }));

    return res.status(200).json({ errors: serializedErrors, total });
  } catch (error) {
    console.error('[api/admin/archive/errors] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

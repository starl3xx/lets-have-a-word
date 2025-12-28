/**
 * Admin Check API
 * Milestone 5.2: Analytics system
 *
 * Verifies if the authenticated user is an admin
 * Uses SIWN session to get FID and checks against LHAW_ADMIN_USER_IDS
 */

import type { NextApiRequest, NextApiResponse } from 'next';

export interface AdminCheckResponse {
  isAdmin: boolean;
  fid?: number;
}

/**
 * Default admin FIDs - fallback when LHAW_ADMIN_USER_IDS env var is not set
 * Keep in sync with components/admin/AdminAuthWrapper.tsx
 */
const DEFAULT_ADMIN_FIDS = [
  6500,      // Primary admin
  1477413,   // Secondary admin
];

/**
 * Get list of admin FIDs from environment variable (with fallback to defaults)
 */
function getAdminFids(): number[] {
  const adminFidsStr = process.env.LHAW_ADMIN_USER_IDS || '';
  if (!adminFidsStr) {
    // Fallback to hardcoded admin FIDs when env var not set
    return DEFAULT_ADMIN_FIDS;
  }

  return adminFidsStr
    .split(',')
    .map(fid => parseInt(fid.trim(), 10))
    .filter(fid => !isNaN(fid));
}

/**
 * Check if a FID is an admin
 * Handles both string and number FIDs (Neynar SIWN can return FID as string)
 */
function isAdminFid(fid: number | string): boolean {
  const adminFids = getAdminFids();
  const numericFid = typeof fid === 'string' ? parseInt(fid, 10) : fid;
  return adminFids.includes(numericFid);
}

/**
 * GET /api/admin/me
 *
 * Returns admin status for the authenticated user
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AdminCheckResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get FID from query params or session
    // For now, we'll support a devFid query param for testing
    // In production, this should come from SIWN session
    let fid: number | null = null;

    // Check for dev FID (development mode)
    if (req.query.devFid) {
      fid = parseInt(req.query.devFid as string, 10);
      console.log(`[admin/me] Using dev FID: ${fid}`);
    }
    // Check for FID from SIWN session (via Authorization header or cookie)
    else if (req.headers.authorization) {
      // Parse Bearer token or session token
      // This would integrate with Neynar's session verification
      // For now, we'll extract FID from a simple JWT-like structure
      const authHeader = req.headers.authorization;
      const match = authHeader.match(/fid=(\d+)/);
      if (match) {
        fid = parseInt(match[1], 10);
      }
    }
    // Check cookies for SIWN session
    else if (req.cookies.siwn_fid) {
      fid = parseInt(req.cookies.siwn_fid, 10);
    }

    if (!fid || isNaN(fid)) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Check if admin
    const isAdmin = isAdminFid(fid);

    return res.status(200).json({
      isAdmin,
      fid,
    });
  } catch (error) {
    console.error('[admin/me] Error checking admin status:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export { isAdminFid, getAdminFids };

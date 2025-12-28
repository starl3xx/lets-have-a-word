/**
 * OG Hunter Status API
 * GET /api/og-hunter/status
 *
 * Returns the user's OG Hunter campaign status including:
 * - Whether prelaunch mode is enabled
 * - Mini app add verification status
 * - Cast share verification status
 * - Eligibility and award status
 * - Share URL and text for casting
 *
 * CONTRACT:
 * Always returns ALL fields defined in OgHunterStatus interface.
 * Never returns undefined values - use null for missing data.
 * On error: returns fail-closed status (all verifications = false).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getOgHunterStatus, isPrelaunchMode, getShareUrl, getShareText, OG_HUNTER_XP_AMOUNT, OgHunterStatus } from '../../../src/lib/og-hunter';

/**
 * Get a fail-closed status response
 * Used when verification is unavailable or errors occur
 */
function getFailClosedStatus(): OgHunterStatus {
  return {
    prelaunchModeEnabled: isPrelaunchMode(),
    addedMiniAppVerified: false,
    addedMiniAppAt: null,
    sharedCastVerified: false,
    sharedCastAt: null,
    castHash: null,
    isEligible: false,
    isAwarded: false,
    awardedAt: null,
    xpAwardAmount: OG_HUNTER_XP_AMOUNT,
    shareUrl: getShareUrl(),
    shareText: getShareText(),
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only accept GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get FID from query parameter
  const fidParam = req.query.fid;
  if (!fidParam || typeof fidParam !== 'string') {
    // Fail closed: return unverified status for missing fid
    return res.status(200).json(getFailClosedStatus());
  }

  const fid = parseInt(fidParam, 10);
  if (isNaN(fid) || fid <= 0) {
    // Fail closed: return unverified status for invalid fid
    return res.status(200).json(getFailClosedStatus());
  }

  try {
    // If prelaunch mode is disabled, return complete status with all fields
    if (!isPrelaunchMode()) {
      return res.status(200).json(getFailClosedStatus());
    }

    // Get full status
    const status = await getOgHunterStatus(fid);

    return res.status(200).json(status);
  } catch (error) {
    console.error('[OgHunter/status] Error:', error);
    // Fail closed: return unverified status on any error
    return res.status(200).json(getFailClosedStatus());
  }
}

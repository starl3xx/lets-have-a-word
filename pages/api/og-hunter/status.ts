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
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getOgHunterStatus, isPrelaunchMode, getShareUrl, getShareText, OG_HUNTER_XP_AMOUNT } from '../../../src/lib/og-hunter';

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
    return res.status(400).json({ error: 'Missing fid parameter' });
  }

  const fid = parseInt(fidParam, 10);
  if (isNaN(fid) || fid <= 0) {
    return res.status(400).json({ error: 'Invalid fid parameter' });
  }

  try {
    // If prelaunch mode is disabled, return minimal response
    if (!isPrelaunchMode()) {
      return res.status(200).json({
        prelaunchModeEnabled: false,
        addedMiniAppVerified: false,
        sharedCastVerified: false,
        isEligible: false,
        isAwarded: false,
        xpAwardAmount: OG_HUNTER_XP_AMOUNT,
        shareUrl: getShareUrl(),
        shareText: getShareText(),
      });
    }

    // Get full status
    const status = await getOgHunterStatus(fid);

    return res.status(200).json(status);
  } catch (error) {
    console.error('[OgHunter/status] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * OG Hunter Verify Cast API
 * POST /api/og-hunter/verify-cast
 *
 * Verifies that the user has shared the game via Farcaster cast.
 * Uses Neynar API to search for recent casts containing the game URL.
 *
 * Request body:
 * - fid: number (required)
 *
 * Returns updated OG Hunter status on success.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyOgHunterCast, isPrelaunchMode } from '../../../src/lib/og-hunter';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check if prelaunch mode is enabled
  if (!isPrelaunchMode()) {
    return res.status(400).json({
      success: false,
      error: 'OG Hunter campaign is not active',
    });
  }

  // Get FID from request body
  const { fid } = req.body;

  if (!fid || typeof fid !== 'number' || fid <= 0) {
    return res.status(400).json({
      success: false,
      error: 'Invalid or missing fid',
    });
  }

  try {
    const result = await verifyOgHunterCast(fid);

    if (result.success) {
      return res.status(200).json({
        success: true,
        status: result.status,
      });
    } else {
      return res.status(400).json({
        success: false,
        error: result.error,
      });
    }
  } catch (error) {
    console.error('[OgHunter/verify-cast] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
}

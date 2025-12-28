/**
 * OG Hunter Claim Badge API
 * POST /api/og-hunter/claim
 *
 * Claims the OG Hunter badge and XP reward.
 * Requires both:
 * 1. Mini app added (users.addedMiniAppAt IS NOT NULL)
 * 2. Cast shared and verified (og_hunter_cast_proofs record exists)
 *
 * Idempotent - will not double-award.
 *
 * Request body:
 * - fid: number (required)
 *
 * Returns updated OG Hunter status on success.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { claimOgHunterBadge, isPrelaunchMode } from '../../../src/lib/og-hunter';

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
    const result = await claimOgHunterBadge(fid);

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
    console.error('[OgHunter/claim] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
}

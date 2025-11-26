/**
 * User XP API
 * Milestone 6.7: XP tracking system
 *
 * Returns total XP for a user computed from xp_events table.
 * In dev mode, also returns recent XP events for debugging.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getTotalXpForFid, getRecentXpEventsForFid, getXpBreakdownForFid } from '../../../src/lib/xp';
import { isDevModeEnabled } from '../../../src/lib/devGameState';
import type { XpSummaryResponse, XpEvent } from '../../../src/types';

interface XpResponse extends XpSummaryResponse {
  breakdown?: Record<string, number>;
}

interface ErrorResponse {
  error: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<XpResponse | ErrorResponse>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get FID from query params
    const fidParam = req.query.fid || req.query.devFid;
    if (!fidParam) {
      return res.status(400).json({ error: 'Missing fid parameter' });
    }

    const fid = typeof fidParam === 'string' ? parseInt(fidParam, 10) : parseInt(fidParam[0], 10);
    if (isNaN(fid)) {
      return res.status(400).json({ error: 'Invalid fid parameter' });
    }

    // Get total XP from xp_events table
    const totalXp = await getTotalXpForFid(fid);

    const response: XpResponse = {
      fid,
      totalXp,
    };

    // In dev mode, include recent events and breakdown for debugging
    if (isDevModeEnabled()) {
      const [recentEvents, breakdown] = await Promise.all([
        getRecentXpEventsForFid(fid, 20),
        getXpBreakdownForFid(fid),
      ]);

      response.recentEvents = recentEvents;
      response.breakdown = breakdown;
    }

    return res.status(200).json(response);
  } catch (error) {
    console.error('[user/xp] Error fetching XP:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch XP',
    });
  }
}

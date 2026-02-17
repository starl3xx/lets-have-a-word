/**
 * Burn Word Finders API
 * Milestone 14: Burn word finder display
 *
 * Returns the burn word finders for display in UI components
 *
 * GET /api/round/burn-word-finders
 * GET /api/round/burn-word-finders?roundId=123
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
import { getBurnWordFinders, type BurnWordFinder } from '../../../src/lib/burn-words';
import { getActiveRound } from '../../../src/lib/rounds';
import { checkRateLimit, RateLimiters } from '../../../src/lib/redis';
import { isDevModeEnabled } from '../../../src/lib/devGameState';

interface BurnWordFindersResponse {
  roundId: number;
  finders: BurnWordFinder[];
}

interface BurnWordFindersErrorResponse {
  error: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<BurnWordFindersResponse | BurnWordFindersErrorResponse>
) {
  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Rate limiting (by IP)
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0] ||
      req.socket.remoteAddress ||
      'unknown';
    const rateCheck = await checkRateLimit(RateLimiters.general, `burn-finders:${clientIp}`);
    if (!rateCheck.success) {
      res.setHeader('X-RateLimit-Limit', rateCheck.limit?.toString() || '60');
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', rateCheck.reset?.toString() || '');
      return res.status(429).json({ error: 'Too many requests' });
    }

    // Dev mode: return empty (no mock burn word data needed)
    if (isDevModeEnabled()) {
      console.log('[DEV MODE] Returning empty burn word finders');
      return res.status(200).json({ roundId: 999, finders: [] });
    }

    // Check if specific roundId was requested
    const { roundId } = req.query;
    let targetRoundId: number;

    if (roundId && typeof roundId === 'string') {
      targetRoundId = parseInt(roundId, 10);
      if (isNaN(targetRoundId)) {
        return res.status(400).json({ error: 'Invalid roundId parameter' });
      }
    } else {
      // Get active round
      const activeRound = await getActiveRound();
      if (!activeRound) {
        return res.status(204).end();
      }
      targetRoundId = activeRound.id;
    }

    const finders = await getBurnWordFinders(targetRoundId);

    // Set cache headers
    res.setHeader('Cache-Control', 'public, s-maxage=5, stale-while-revalidate=10');

    return res.status(200).json({
      roundId: targetRoundId,
      finders,
    });
  } catch (error: any) {
    console.error('Error in /api/round/burn-word-finders:', error);
    Sentry.captureException(error, {
      tags: { endpoint: 'round-burn-word-finders' },
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

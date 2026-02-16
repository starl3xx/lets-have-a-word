/**
 * Bonus Word Winners API
 * Bonus Words Feature
 *
 * Returns the bonus word winners for display in UI components
 *
 * GET /api/round/bonus-word-winners
 * Response:
 * {
 *   "roundId": 123,
 *   "winners": [
 *     {
 *       "fid": 123,
 *       "username": "alice",
 *       "pfpUrl": "...",
 *       "word": "LUCKY",
 *       "wordIndex": 2,
 *       "claimedAt": "2025-01-04T12:00:00Z",
 *       "txHash": "0x...",
 *       "tokenRewardAmount": "5000000"
 *     }
 *   ]
 * }
 *
 * GET /api/round/bonus-word-winners?roundId=123
 * Returns winners for a specific round (for archive display)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
import { getBonusWordWinners, type BonusWordWinner } from '../../../src/lib/bonus-words';
import { getActiveRound } from '../../../src/lib/rounds';
import { checkRateLimit, RateLimiters } from '../../../src/lib/redis';
import { isDevModeEnabled } from '../../../src/lib/devGameState';

interface BonusWordWinnersResponse {
  roundId: number;
  winners: BonusWordWinner[];
}

interface BonusWordWinnersErrorResponse {
  error: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<BonusWordWinnersResponse | BonusWordWinnersErrorResponse>
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
    const rateCheck = await checkRateLimit(RateLimiters.general, `bonus-winners:${clientIp}`);
    if (!rateCheck.success) {
      res.setHeader('X-RateLimit-Limit', rateCheck.limit?.toString() || '60');
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', rateCheck.reset?.toString() || '');
      return res.status(429).json({ error: 'Too many requests' });
    }

    // Dev mode: return mock data
    if (isDevModeEnabled()) {
      console.log('🎮 Dev mode: Returning mock bonus word winners');
      const mockResponse: BonusWordWinnersResponse = {
        roundId: 999,
        winners: [
          {
            fid: 123,
            username: 'testuser',
            pfpUrl: 'https://avatar.vercel.sh/123',
            word: 'LUCKY',
            wordIndex: 3,
            claimedAt: new Date(Date.now() - 3600000).toISOString(),
            txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
            tokenRewardAmount: '5000000',
          },
          {
            fid: 456,
            username: 'player2',
            pfpUrl: 'https://avatar.vercel.sh/456',
            word: 'BONUS',
            wordIndex: 7,
            claimedAt: new Date(Date.now() - 1800000).toISOString(),
            txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
            tokenRewardAmount: '5000000',
          },
        ],
      };
      return res.status(200).json(mockResponse);
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

    const winners = await getBonusWordWinners(targetRoundId);

    // Set cache headers
    res.setHeader('Cache-Control', 'public, s-maxage=5, stale-while-revalidate=10');

    return res.status(200).json({
      roundId: targetRoundId,
      winners,
    });
  } catch (error: any) {
    console.error('Error in /api/round/bonus-word-winners:', error);
    Sentry.captureException(error, {
      tags: { endpoint: 'round-bonus-word-winners' },
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

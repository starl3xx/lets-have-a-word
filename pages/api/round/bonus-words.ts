/**
 * Bonus Words API
 * Bonus Words Feature
 *
 * Returns the bonus word status for the current active round
 *
 * GET /api/round/bonus-words
 * Response:
 * {
 *   "roundId": 123,
 *   "totalBonusWords": 10,
 *   "claimedCount": 3,
 *   "remainingCount": 7,
 *   "claimedWords": [
 *     {
 *       "word": "LUCKY",
 *       "wordIndex": 2,
 *       "claimedBy": { "fid": 123, "username": "alice", "pfpUrl": "..." },
 *       "claimedAt": "2025-01-04T12:00:00Z",
 *       "txHash": "0x..."
 *     }
 *   ]
 * }
 *
 * GET /api/round/bonus-words?roundId=123
 * Returns bonus word status for a specific round (for archive display)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
import { getActiveBonusWordStatus, getBonusWordStatus, type BonusWordStatus } from '../../../src/lib/bonus-words';
import { checkRateLimit, RateLimiters } from '../../../src/lib/redis';
import { isDevModeEnabled } from '../../../src/lib/devGameState';

interface BonusWordsErrorResponse {
  error: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<BonusWordStatus | BonusWordsErrorResponse | null>
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
    const rateCheck = await checkRateLimit(RateLimiters.general, `bonus-words:${clientIp}`);
    if (!rateCheck.success) {
      res.setHeader('X-RateLimit-Limit', rateCheck.limit?.toString() || '60');
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', rateCheck.reset?.toString() || '');
      return res.status(429).json({ error: 'Too many requests' });
    }

    // Dev mode: return mock data
    if (isDevModeEnabled()) {
      console.log('🎮 Dev mode: Returning mock bonus word status');
      const mockStatus: BonusWordStatus = {
        roundId: 999,
        totalBonusWords: 10,
        claimedCount: 2,
        remainingCount: 8,
        claimedWords: [
          {
            word: 'LUCKY',
            wordIndex: 3,
            claimedBy: {
              fid: 123,
              username: 'testuser',
              pfpUrl: 'https://avatar.vercel.sh/123',
            },
            claimedAt: new Date(Date.now() - 3600000).toISOString(),
            txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
          },
          {
            word: 'BONUS',
            wordIndex: 7,
            claimedBy: {
              fid: 456,
              username: 'player2',
              pfpUrl: 'https://avatar.vercel.sh/456',
            },
            claimedAt: new Date(Date.now() - 1800000).toISOString(),
            txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
          },
        ],
      };
      return res.status(200).json(mockStatus);
    }

    // Check if specific roundId was requested
    const { roundId } = req.query;

    let status: BonusWordStatus | null;

    if (roundId && typeof roundId === 'string') {
      const roundIdNum = parseInt(roundId, 10);
      if (isNaN(roundIdNum)) {
        return res.status(400).json({ error: 'Invalid roundId parameter' });
      }
      status = await getBonusWordStatus(roundIdNum);
    } else {
      // Get active round bonus word status
      status = await getActiveBonusWordStatus();
    }

    if (!status) {
      // No bonus words for this round (legacy round or no active round)
      return res.status(204).end();
    }

    // Set cache headers
    res.setHeader('Cache-Control', 'public, s-maxage=5, stale-while-revalidate=10');

    return res.status(200).json(status);
  } catch (error: any) {
    console.error('Error in /api/round/bonus-words:', error);
    Sentry.captureException(error, {
      tags: { endpoint: 'round-bonus-words' },
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

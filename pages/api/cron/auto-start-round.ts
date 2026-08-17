import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
import { checkAutoStartEligibility, ensureActiveRound } from '../../../src/lib/rounds';

/**
 * POST /api/cron/auto-start-round
 *
 * Starts the next round once the between-rounds cooldown has passed
 * (ROUND_COOLDOWN_HOURS after the last resolution, default 6). This replaced
 * the ETH era's resolve-time immediate auto-start, which rarely worked — the
 * treasury usually failed the seed minimum — and which left no breathing room
 * between rounds when it did.
 *
 * Era-gated inside checkAutoStartEligibility: the cooldown anchor must be a
 * resolved $WORD round, so nothing fires during the paused ETH tail and the
 * Round 34 launch itself stays a manual act. A manual admin Start Round
 * bypasses the cooldown entirely (it never consults this path).
 *
 * Uses ensureActiveRound(), whose active/blocked guards close the race
 * against a concurrent manual start — worst case it returns the round the
 * admin just created instead of making a second one.
 *
 * Security: same CRON_SECRET bearer check as the other cron endpoints.
 *
 * Schedule (vercel.json): every 5 minutes, so a round starts within
 * cooldown + 5 minutes of the previous resolution.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;

  if (process.env.NODE_ENV === 'production') {
    if (!cronSecret) {
      console.error('[auto-start-round] CRON_SECRET not configured');
      return res.status(500).json({ error: 'Cron not configured' });
    }
    if (authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const check = await checkAutoStartEligibility();

    if (!check.eligible) {
      return res.status(200).json({
        started: false,
        reason: check.reason,
        eligibleAt: check.reason === 'cooldown' ? check.eligibleAt?.toISOString() : undefined,
      });
    }

    const round = await ensureActiveRound();
    console.log(
      `[auto-start-round] ✅ Round ${round.id} live (cooldown after round ${check.sinceRoundId} elapsed)`
    );
    return res.status(200).json({ started: true, roundId: round.id });
  } catch (error) {
    console.error('[auto-start-round] Failed to start round:', error);
    Sentry.captureException(error, {
      tags: { type: 'auto_start_round_failed' },
    });
    return res.status(500).json({
      started: false,
      reason: 'create_failed',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

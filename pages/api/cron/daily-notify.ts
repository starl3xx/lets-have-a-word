import type { NextApiRequest, NextApiResponse } from 'next';
import { getActiveRound } from '../../../src/lib/rounds';
import { getCurrentJackpotOnChain } from '../../../src/lib/jackpot-contract';
import { notifyDailyReset } from '../../../src/lib/notifications';
import { formatEth } from '../../../src/lib/announcer';

/**
 * GET/POST /api/cron/daily-notify
 *
 * Sends a randomized "daily reset" push notification to mini app users.
 * Only fires when an active round exists (no point notifying without a round).
 *
 * Schedule (vercel.json): daily at 11:00 UTC (matches free-guess reset time)
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify authorization in production
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;

  if (process.env.NODE_ENV === 'production') {
    if (!cronSecret) {
      console.error('[CRON] CRON_SECRET not configured');
      return res.status(500).json({ error: 'Cron not configured' });
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[CRON] Unauthorized daily-notify attempt');
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  console.log(`[CRON] Daily notify started at ${new Date().toISOString()}`);

  try {
    // Only send notification if there's an active round
    const activeRound = await getActiveRound();

    if (!activeRound) {
      console.log('[CRON] No active round, skipping daily reset notification');
      return res.status(200).json({
        ok: true,
        skipped: true,
        reason: 'No active round',
      });
    }

    const roundNumber = activeRound.id;

    // Reads WordJackpot for a $WORD round and JackpotManagerV3 otherwise, and
    // returns the amount with its unit attached. The old path read the ETH
    // contract unconditionally and fell back to prizePoolEth, which is 0 on a
    // $WORD round — so a $WORD round would have pushed "0 ETH" to every player.
    const { getRoundPrize } = await import('../../../src/lib/round-prize');
    const prize = await getRoundPrize(activeRound);
    const jackpotEth = prize.display;

    const result = await notifyDailyReset(roundNumber, prize.display);

    console.log('[CRON] Daily notify result:', result);

    return res.status(200).json({
      ok: true,
      roundNumber,
      jackpotEth,
      notification: result,
    });
  } catch (error) {
    console.error('[CRON] Daily notify failed:', error);
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

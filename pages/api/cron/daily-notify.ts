import type { NextApiRequest, NextApiResponse } from 'next';
import { getActiveRound } from '../../../src/lib/rounds';
import { notifyDailyReset } from '../../../src/lib/notifications';

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

    // The pool as it stands right now, with its unit attached.
    //
    // getLivePoolPrize, not getRoundPrize: for a $WORD round the live pool is
    // the database column, because pack and Superguess purchases do not reach
    // WordJackpot until the single top-up before resolve. Reading the contract
    // here pushed the SEED every morning for the whole round — round 34's pool
    // grew $20.00 -> $26.65, so the last push understated it by 25%. An ETH
    // round still reads JackpotManagerV3, which takes each purchase
    // immediately and is the live number there.
    //
    // getActiveRound() returns the currency columns (prizeCurrency,
    // prizePoolWord, seedPriceE18); without them this would take the ETH branch
    // and push an ETH figure for a $WORD round.
    const { getLivePoolPrize } = await import('../../../src/lib/round-prize');
    const prize = await getLivePoolPrize(activeRound);

    const result = await notifyDailyReset(roundNumber, prize.display);

    console.log('[CRON] Daily notify result:', result);

    return res.status(200).json({
      ok: true,
      roundNumber,
      // `prize` and `currency`, not `jackpotEth`: the value carries its own
      // unit and is $WORD from round 34 on. Nothing but the Vercel scheduler
      // reads this body, and a field named for the wrong asset is how an
      // operator ends up reading a $WORD figure as ETH.
      prize: prize.display,
      currency: prize.currency,
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

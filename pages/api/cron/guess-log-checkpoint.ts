import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
import { getActiveRound } from '../../../src/lib/rounds';
import { postNextCheckpoint, isGuessLogConfigured } from '../../../src/lib/guess-log-contract';

/**
 * POST /api/cron/guess-log-checkpoint
 *
 * Commits a Merkle root over the guesses made since the last checkpoint, so
 * the ordering that decides the winner and the top-10 becomes immutable while
 * the round is still running rather than only being asserted afterwards.
 *
 * Runs on an interval rather than per guess: one transaction every few minutes
 * costs almost nothing on Base and needs no wallet interaction from players,
 * whereas committing per guess would put a signature prompt in front of every
 * word typed. The tradeoff is a window — guesses made since the last checkpoint
 * are not yet committed — which is why the interval wants to be short.
 *
 * Also posts a final checkpoint for a round that has just resolved: the last
 * guesses of a round, including the winning one, land after the previous tick
 * and would otherwise never be committed.
 *
 * Security: same CRON_SECRET bearer check as the other cron endpoints.
 *
 * Schedule (vercel.json): every 5 minutes.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;

  if (process.env.NODE_ENV === 'production') {
    if (!cronSecret) {
      console.error('[guess-log] CRON_SECRET not configured');
      return res.status(500).json({ error: 'Cron not configured' });
    }
    if (authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  if (!isGuessLogConfigured()) {
    return res.status(200).json({
      ok: true,
      skipped: 'GuessLog not configured — set GUESS_LOG_ADDRESS to enable',
    });
  }

  try {
    // An explicit roundId lets the operator close out a round that resolved
    // between ticks; otherwise follow the active round.
    const explicit = req.query.roundId ? parseInt(String(req.query.roundId), 10) : null;

    let roundId: number | null = explicit;
    if (roundId === null) {
      const active = await getActiveRound();
      roundId = active?.id ?? null;
    }

    if (roundId === null) {
      return res.status(200).json({ ok: true, skipped: 'No active round' });
    }

    const result = await postNextCheckpoint(roundId);
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[guess-log] Checkpoint failed:', error);
    Sentry.captureException(error, {
      tags: { component: 'guess-log', operation: 'checkpoint' },
    });
    // 200 with ok:false — a failed checkpoint must not mark the cron job as
    // broken and stop the schedule; the next tick retries the same range.
    return res.status(200).json({ ok: false, error: message });
  }
}

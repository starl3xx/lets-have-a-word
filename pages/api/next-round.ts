import type { NextApiRequest, NextApiResponse } from 'next';
import { checkAutoStartEligibility } from '../../src/lib/rounds';

/**
 * GET /api/next-round
 *
 * When is the next round expected? Public and read-only; the between-rounds
 * info bar uses it to show a countdown during the cooldown window
 * (ROUND_COOLDOWN_HOURS after a resolution) instead of the indefinite
 * "Update in progress" copy.
 *
 * Response:
 * - active: whether a round is live right now
 * - nextRoundAt: ISO timestamp when the next round is expected, or null when
 *   no start is scheduled (a round is live, the game is paused, or the $WORD
 *   era has not begun). An "eligible now" state reports the current time —
 *   the cron fires within five minutes of it.
 */
export interface NextRoundResponse {
  active: boolean;
  nextRoundAt: string | null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<NextRoundResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const check = await checkAutoStartEligibility();

    if (!check.eligible && check.reason === 'active_round') {
      return res.status(200).json({ active: true, nextRoundAt: null });
    }

    let nextRoundAt: string | null = null;
    if (check.eligible) {
      nextRoundAt = new Date().toISOString();
    } else if (check.reason === 'cooldown' && check.eligibleAt) {
      nextRoundAt = check.eligibleAt.toISOString();
    }

    return res.status(200).json({ active: false, nextRoundAt });
  } catch (error) {
    console.error('[api/next-round] Error:', error);
    return res.status(500).json({ error: 'Failed to check next round' });
  }
}

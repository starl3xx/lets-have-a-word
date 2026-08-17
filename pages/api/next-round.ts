import type { NextApiRequest, NextApiResponse } from 'next';
import { checkAutoStartEligibility } from '../../src/lib/rounds';

/**
 * GET /api/next-round
 *
 * Is a next round on the way? Public and read-only; the between-rounds info
 * bar uses it to choose between "Next round soon" (cooldown running) and the
 * indefinite "Update in progress" copy (dead day, pre-launch).
 *
 * DELIBERATELY no timestamp. The exact start time is withheld so nobody can
 * squat the first second of a round to snipe the Trailblazer Wordmark (#1
 * global guess). The bar hiding its countdown would mean nothing if this
 * endpoint kept handing the timestamp to anyone who polls it.
 *
 * Response:
 * - active: whether a round is live right now
 * - nextRoundPending: a next round is expected (cooldown running or start
 *   imminent), timing unspecified
 */
export interface NextRoundResponse {
  active: boolean;
  nextRoundPending: boolean;
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
      return res.status(200).json({ active: true, nextRoundPending: false });
    }

    const nextRoundPending = check.eligible || check.reason === 'cooldown';
    return res.status(200).json({ active: false, nextRoundPending });
  } catch (error) {
    console.error('[api/next-round] Error:', error);
    return res.status(500).json({ error: 'Failed to check next round' });
  }
}

import type { NextApiRequest, NextApiResponse } from 'next';
import { logAnalyticsEvent, AnalyticsEventTypes } from '../../../src/lib/analytics';

/**
 * POST /api/analytics/log
 * Milestone 6.3
 *
 * Client-side analytics event logging endpoint.
 * Allows frontend components to log analytics events.
 *
 * Body:
 * - eventType: string (required)
 * - userId: string (optional)
 * - roundId: string (optional)
 * - data: object (optional)
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { eventType, userId, roundId, data } = req.body;

    if (!eventType || typeof eventType !== 'string') {
      return res.status(400).json({ error: 'eventType is required' });
    }

    // Log the event (fire and forget - this is async but we don't wait)
    logAnalyticsEvent(eventType, {
      userId: userId?.toString(),
      roundId: roundId?.toString(),
      data,
    });

    // Return immediately - don't wait for DB write
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[analytics/log] Error:', error);
    // Still return 200 - analytics should never block UI
    return res.status(200).json({ ok: true });
  }
}

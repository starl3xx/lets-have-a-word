/**
 * Raw Events Analytics API
 * Milestone 5.2: Analytics system
 *
 * Returns raw analytics events with pagination
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../../src/db';
import { analyticsEvents } from '../../../../src/db/schema';
import { desc } from 'drizzle-orm';
import { isAdminFid } from '../me';

export interface AnalyticsEvent {
  id: number;
  event_type: string;
  user_id: string | null;
  round_id: string | null;
  data: any;
  created_at: string;
}

export interface EventsResponse {
  events: AnalyticsEvent[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * GET /api/admin/analytics/events
 *
 * Returns raw analytics events with pagination (requires admin access)
 * Query params:
 * - page: page number (default 1)
 * - pageSize: events per page (default 50, max 100)
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<EventsResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check if analytics is enabled
  if (process.env.ANALYTICS_ENABLED !== 'true') {
    return res.status(200).json({
      events: [],
      total: 0,
      page: 1,
      pageSize: 50,
    });
  }

  try {
    // Get FID from query params (dev mode)
    let fid: number | null = null;
    if (req.query.devFid) {
      fid = parseInt(req.query.devFid as string, 10);
    } else if (req.cookies.siwn_fid) {
      fid = parseInt(req.cookies.siwn_fid, 10);
    }

    if (!fid || !isAdminFid(fid)) {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }

    // Parse pagination params
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize as string) || 50, 100);
    const offset = (page - 1) * pageSize;

    // Get events with pagination
    const events = await db
      .select()
      .from(analyticsEvents)
      .orderBy(desc(analyticsEvents.createdAt))
      .limit(pageSize)
      .offset(offset);

    // Get total count
    const totalResult = await db
      .select()
      .from(analyticsEvents);
    const total = totalResult.length;

    return res.status(200).json({
      events: events.map(e => ({
        id: e.id,
        event_type: e.eventType,
        user_id: e.userId,
        round_id: e.roundId,
        data: e.data,
        created_at: e.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    });
  } catch (error) {
    console.error('[analytics/events] Error fetching events:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

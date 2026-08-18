/**
 * Free/Paid Ratio Analytics API
 * Milestone 5.2: Analytics system
 *
 * Returns free vs paid guess data
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../../src/db';
import { sql } from 'drizzle-orm';
import { centralDayTz } from '../../../../src/lib/reporting-time';
import { isAdminFid } from '../me';
import { cacheAside, CacheKeys, CacheTTL } from '../../../../src/lib/redis';

export interface FreePaidDataPoint {
  day: string;
  free_guesses: number;
  paid_guesses: number;
  free_to_paid_ratio: number | null;
}

/**
 * GET /api/admin/analytics/free-paid
 *
 * Returns free/paid ratio data (requires admin access)
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<FreePaidDataPoint[] | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check if analytics is enabled
  if (process.env.ANALYTICS_ENABLED !== 'true') {
    console.log('[analytics/free-paid] Analytics disabled: ANALYTICS_ENABLED not set to "true"');
    return res.status(503).json({ error: 'Analytics not enabled. Set ANALYTICS_ENABLED=true in environment variables.' });
  }

  try {
    // Get FID from query params (dev mode)
    let fid: number | null = null;
    if (req.query.devFid) {
      fid = parseInt(req.query.devFid as string, 10);
      console.log('[analytics/free-paid] Using devFid:', fid);
    } else if (req.cookies.siwn_fid) {
      fid = parseInt(req.cookies.siwn_fid, 10);
      console.log('[analytics/free-paid] Using cookie FID:', fid);
    }

    if (!fid) {
      console.log('[analytics/free-paid] No FID provided');
      return res.status(401).json({ error: 'Authentication required: No FID provided' });
    }

    if (!isAdminFid(fid)) {
      console.log('[analytics/free-paid] FID is not admin:', fid);
      return res.status(403).json({ error: `Forbidden: FID ${fid} is not an admin. Set LHAW_ADMIN_USER_IDS environment variable.` });
    }

    // Inlined rather than read from view_free_paid_ratio, for the same reason as
    // analytics/dau: the view's date(created_at) buckets in the SESSION's
    // timezone. The ratio is per-day, so a misplaced guess changes both the
    // numerator and the denominator of the wrong bar.
    const result = await db.execute<FreePaidDataPoint>(
      sql`SELECT ${centralDayTz('created_at')} as day,
                 COUNT(*) FILTER (WHERE event_type = 'free_guess_used') as free_guesses,
                 COUNT(*) FILTER (WHERE event_type = 'paid_guess_used') as paid_guesses,
                 CASE
                   WHEN COUNT(*) FILTER (WHERE event_type = 'paid_guess_used') > 0
                   THEN ROUND(
                     COUNT(*) FILTER (WHERE event_type = 'free_guess_used')::numeric
                     / COUNT(*) FILTER (WHERE event_type = 'paid_guess_used')::numeric, 2)
                   ELSE 0::numeric
                 END as free_to_paid_ratio
          FROM analytics_events
          WHERE event_type IN ('free_guess_used', 'paid_guess_used')
          GROUP BY day
          ORDER BY day DESC
          LIMIT 30`
    );

    console.log('[analytics/free-paid] Raw result:', JSON.stringify(result).substring(0, 300));

    // db.execute returns the array directly, not an object with rows property
    const rows = Array.isArray(result) ? result : [];

    // Ensure proper serialization
    const serializedData = rows.map(row => ({
      day: row.day?.toString() || '',
      free_guesses: Number(row.free_guesses) || 0,
      paid_guesses: Number(row.paid_guesses) || 0,
      free_to_paid_ratio: row.free_to_paid_ratio !== null ? Number(row.free_to_paid_ratio) : 0
    }));

    console.log('[analytics/free-paid] Returning data:', JSON.stringify(serializedData).substring(0, 200));
    return res.status(200).json(serializedData);
  } catch (error) {
    console.error('[analytics/free-paid] Error fetching free/paid data:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Arrival Analytics API
 *
 * GET /api/admin/analytics/arrivals?hours=24
 *
 * WHAT QUESTION THIS EXISTS TO ANSWER. When a burst of attention arrives (a
 * retweet, a listing, a launch) the only number visible from outside is the
 * round's unique guesser count, and that number sits at the BOTTOM of the
 * funnel. When it does not move, three completely different things look
 * identical from there:
 *
 *   1. Nobody arrived.            -> walletSignups ~ 0
 *   2. They arrived and bounced.  -> walletSignups > 0, mostly neverGuessed
 *   3. They arrived and played.   -> walletSignups > 0, mostly guessed
 *
 * Those call for opposite responses, so guessing between them is worse than
 * not knowing. This endpoint separates them, hour by hour, and does it
 * RETROACTIVELY: it reads users.created_at, so it can answer for a spike that
 * already happened rather than only instrumenting the next one.
 *
 * WHAT IT DELIBERATELY DOES NOT REPORT: sign-in failures. Those are only
 * console.warn in pages/api/auth/siwe.ts and reach Vercel's logs, not the
 * database, so no query can recover them. Adding that instrumentation means
 * editing the live authentication path, which is not a thing to do in the
 * middle of the traffic you are trying to measure. It belongs in a separate
 * change once the spike is over.
 *
 * A wallet signup with no guess is therefore ambiguous between "bounced at
 * sign-in" and "signed in, then stopped at the $3 reward gate". The split
 * between signups and guessers still tells you WHERE to look, which is what
 * was missing.
 *
 * Grew nothing existing: onboarding.ts is event-sourced, cohorts.ts is weekly
 * retention, dashboard-summary.ts is today's KPIs. None of them answer "who
 * arrived in the last few hours, and did they play".
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../../src/db';
import { sql } from 'drizzle-orm';
import { isAdminFid } from '../me';

export interface ArrivalBucket {
  /** ISO hour, UTC. */
  hour: string;
  walletSignups: number;
  farcasterSignups: number;
  /** Of that hour's wallet signups, how many have ever made a guess. */
  walletGuessed: number;
  /** The rest. Bounced at sign-in, or stopped at the reward gate. */
  walletNeverGuessed: number;
}

export interface ArrivalAnalytics {
  hours: number;
  buckets: ArrivalBucket[];
  totals: {
    walletSignups: number;
    farcasterSignups: number;
    walletGuessed: number;
    walletNeverGuessed: number;
    /** Null rather than 0 when nobody signed up: no arrivals is not 0% conversion. */
    walletConversionPct: number | null;
  };
  /** Stated in the payload so a reader does not infer more than this can show. */
  caveats: string[];
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ArrivalAnalytics | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (process.env.ANALYTICS_ENABLED !== 'true') {
    return res
      .status(503)
      .json({ error: 'Analytics not enabled. Set ANALYTICS_ENABLED=true.' });
  }

  try {
    let fid: number | null = null;
    if (req.query.devFid) {
      fid = parseInt(req.query.devFid as string, 10);
    } else if (req.cookies.siwn_fid) {
      fid = parseInt(req.cookies.siwn_fid, 10);
    }
    if (!fid) {
      return res.status(401).json({ error: 'Authentication required: No FID provided' });
    }
    if (!isAdminFid(fid)) {
      return res.status(403).json({ error: `Forbidden: FID ${fid} is not an admin` });
    }

    // Bounded so a stray ?hours=100000 cannot ask for a full table scan.
    const requested = parseInt(String(req.query.hours ?? '24'), 10);
    const hours = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 168) : 24;

    /**
     * generate_series produces every hour in the window, so an hour with no
     * arrivals appears as a zero row rather than vanishing. A missing hour and
     * a zero hour mean opposite things here and a sparse result would read as
     * the wrong one.
     *
     * EXISTS rather than a join to guesses: a player has many guesses, and
     * joining would count each signup once per guess and inflate the very
     * number the endpoint exists to report. Checked against a seeded player
     * with three guesses, who counts once.
     *
     * The coalesce on identity_origin is belt and braces only. The column is
     * NOT NULL with a 'farcaster' default, so it cannot actually be null; this
     * matches what farm-monitor.ts does and costs nothing.
     */
    const rows = await db.execute<{
      hour: string;
      wallet_signups: number;
      farcaster_signups: number;
      wallet_guessed: number;
    }>(sql`
      WITH window_hours AS (
        SELECT generate_series(
          date_trunc('hour', now()) - (${hours - 1} || ' hours')::interval,
          date_trunc('hour', now()),
          '1 hour'
        ) AS hour
      ),
      arrivals AS (
        SELECT
          date_trunc('hour', u.created_at) AS hour,
          coalesce(u.identity_origin, 'farcaster') = 'wallet' AS is_wallet,
          EXISTS (SELECT 1 FROM guesses g WHERE g.fid = u.fid) AS has_guessed
        FROM users u
        WHERE u.created_at >= date_trunc('hour', now()) - (${hours - 1} || ' hours')::interval
      )
      SELECT
        to_char(w.hour, 'YYYY-MM-DD"T"HH24:00:00"Z"') AS hour,
        count(*) FILTER (WHERE a.is_wallet)                                AS wallet_signups,
        count(*) FILTER (WHERE a.is_wallet IS FALSE)                       AS farcaster_signups,
        count(*) FILTER (WHERE a.is_wallet AND a.has_guessed)              AS wallet_guessed
      FROM window_hours w
      LEFT JOIN arrivals a ON a.hour = w.hour
      GROUP BY w.hour
      ORDER BY w.hour
    `);

    const list = Array.isArray(rows) ? rows : [];
    const buckets: ArrivalBucket[] = list.map((r) => {
      const walletSignups = Number(r.wallet_signups) || 0;
      const walletGuessed = Number(r.wallet_guessed) || 0;
      return {
        hour: String(r.hour),
        walletSignups,
        farcasterSignups: Number(r.farcaster_signups) || 0,
        walletGuessed,
        walletNeverGuessed: walletSignups - walletGuessed,
      };
    });

    const sum = (pick: (b: ArrivalBucket) => number) =>
      buckets.reduce((acc, b) => acc + pick(b), 0);

    const walletSignups = sum((b) => b.walletSignups);
    const walletGuessed = sum((b) => b.walletGuessed);

    return res.status(200).json({
      hours,
      buckets,
      totals: {
        walletSignups,
        farcasterSignups: sum((b) => b.farcasterSignups),
        walletGuessed,
        walletNeverGuessed: walletSignups - walletGuessed,
        walletConversionPct:
          walletSignups > 0 ? Math.round((walletGuessed / walletSignups) * 1000) / 10 : null,
      },
      caveats: [
        'Sign-in FAILURES are not included: siwe.ts only console.warns them, so they never reach the database.',
        'A wallet signup with no guess is ambiguous between bouncing at sign-in and stopping at the $3 reward gate.',
        'walletGuessed counts a guess EVER, not one inside this window, so a returning player reads as converted.',
        'Hours are UTC, unlike cohorts.ts and dau.ts which report in US Central.',
      ],
    });
  } catch (error) {
    console.error('[analytics/arrivals] Query failed:', error);
    return res.status(500).json({ error: 'Failed to load arrival analytics' });
  }
}

/**
 * POST /api/admin/operational/backfill-first-guess-round?devFid=XXX
 *   body: { dryRun?: boolean }
 *
 * One-time backfill of users.first_guess_round from MIN(guesses.round_id) per
 * fid — the reward gate's grandfather column. First guess in rounds 1–27
 * (before the round-28 farm) exempts an account from the play bar forever.
 *
 * Idempotent and re-runnable: the UPDATE writes the same values every run,
 * and only touches rows whose value is missing or wrong. A dry run reports
 * the counts the real run would produce, including the grandfathered total —
 * expect ≈4,432 against the 2026-08-15 production data.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from 'drizzle-orm';
import { db } from '../../../../src/db';
import { isAdminFid } from '../me';
import { REWARD_GATE_GRANDFATHER_LAST_ROUND } from '../../../../config/economy';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const devFid = parseInt(req.query.devFid as string, 10);
  if (!devFid || !isAdminFid(devFid)) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const dryRun = req.body?.dryRun === true;

  // postgres-js returns a bare array from db.execute (no {rows}); the update
  // result carries the affected count on `count`. Same defensive shape the
  // archive module uses.
  const firstRow = (result: any): Record<string, unknown> => {
    if (Array.isArray(result)) return result[0] ?? {};
    if (result && Array.isArray(result.rows)) return result.rows[0] ?? {};
    return {};
  };

  try {
    const stats = await db.execute(sql`
      SELECT
        COUNT(*)::int AS users_with_guesses,
        COUNT(*) FILTER (WHERE min_round <= ${REWARD_GATE_GRANDFATHER_LAST_ROUND})::int AS grandfathered
      FROM (
        SELECT fid, MIN(round_id) AS min_round FROM guesses GROUP BY fid
      ) firsts
    `);

    if (dryRun) {
      return res.status(200).json({ dryRun: true, ...firstRow(stats) });
    }

    const result = await db.execute(sql`
      UPDATE users u
      SET first_guess_round = firsts.min_round
      FROM (
        SELECT fid, MIN(round_id) AS min_round FROM guesses GROUP BY fid
      ) firsts
      WHERE u.fid = firsts.fid
        AND (u.first_guess_round IS DISTINCT FROM firsts.min_round)
    `);

    const updated =
      (result as any)?.count ?? (result as any)?.rowCount ?? null;

    return res.status(200).json({
      dryRun: false,
      updated,
      ...firstRow(stats),
    });
  } catch (error) {
    console.error('[backfill-first-guess-round] Failed:', error);
    return res.status(500).json({ error: 'Backfill failed' });
  }
}

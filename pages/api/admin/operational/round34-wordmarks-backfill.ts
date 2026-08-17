/**
 * Round 34 Wordmarks Backfill — one-incident launch tool
 *
 * POST /api/admin/operational/round34-wordmarks-backfill?devFid=XXX
 * Body: { "dryRun": false } to write. Anything else (including no body)
 * reports counts without writing.
 *
 * Awards the two launch marks for the historical eras:
 *  - EARLY_ADOPTER: every FID whose first guess landed in rounds 1–18
 *    (users.first_guess_round, frozen by the reward-gate backfill; see
 *    EARLY_ADOPTER_LAST_ROUND in src/lib/wordmarks.ts for why the cutoff
 *    is 18 and not 27).
 *  - TRAILBLAZER: the maker of each round's #1 global guess. Basis is
 *    MIN(guesses.id) per round — guess_index_in_round is NULL on pre-2026-08
 *    burn rows, so id order is the truthful basis. Ineligible-winner audit
 *    rows are excluded, matching the live guess path.
 *
 * Idempotent: ON CONFLICT (fid, badge_type) DO NOTHING. Safe to re-run.
 * The marks stay invisible to players until a $WORD round exists (see
 * /api/user/wordmarks), so this can run any time before launch.
 *
 * Expiry: delete this endpoint once Round 34 has launched and the backfill
 * has run (per the "Before You Write New Code" ladder in CLAUDE.md).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from 'drizzle-orm';
import { isAdminFid } from '../me';
import { db } from '../../../../src/db';
import { EARLY_ADOPTER_LAST_ROUND } from '../../../../src/lib/wordmarks';

const TRAILBLAZER_FIRSTS = sql`
  SELECT DISTINCT ON (round_id) round_id, fid
  FROM guesses
  WHERE is_ineligible_winner IS NOT TRUE
  ORDER BY round_id, id
`;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const devFid = parseInt(req.query.devFid as string, 10);
  if (!devFid || !isAdminFid(devFid)) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const dryRun = req.body?.dryRun !== false;

  try {
    if (dryRun) {
      const [earlyAdopter] = await db.execute<{ eligible: number; to_insert: number }>(sql`
        SELECT
          COUNT(*)::int AS eligible,
          COUNT(*) FILTER (WHERE NOT EXISTS (
            SELECT 1 FROM user_badges b
            WHERE b.fid = users.fid AND b.badge_type = 'EARLY_ADOPTER'
          ))::int AS to_insert
        FROM users
        WHERE first_guess_round <= ${EARLY_ADOPTER_LAST_ROUND}
      `);

      const [trailblazer] = await db.execute<{ eligible: number; to_insert: number }>(sql`
        WITH firsts AS (${TRAILBLAZER_FIRSTS})
        SELECT
          COUNT(DISTINCT fid)::int AS eligible,
          COUNT(DISTINCT fid) FILTER (WHERE NOT EXISTS (
            SELECT 1 FROM user_badges b
            WHERE b.fid = firsts.fid AND b.badge_type = 'TRAILBLAZER'
          ))::int AS to_insert
        FROM firsts
      `);

      return res.status(200).json({
        dryRun: true,
        earlyAdopter: { cutoffRound: EARLY_ADOPTER_LAST_ROUND, eligible: earlyAdopter?.eligible ?? 0, toInsert: earlyAdopter?.to_insert ?? 0 },
        trailblazer: { eligible: trailblazer?.eligible ?? 0, toInsert: trailblazer?.to_insert ?? 0 },
      });
    }

    const earlyAdopterInserted = await db.execute<{ fid: number }>(sql`
      INSERT INTO user_badges (fid, badge_type, metadata)
      SELECT fid, 'EARLY_ADOPTER',
             jsonb_build_object('firstGuessRound', first_guess_round, 'backfill', true)
      FROM users
      WHERE first_guess_round <= ${EARLY_ADOPTER_LAST_ROUND}
      ON CONFLICT (fid, badge_type) DO NOTHING
      RETURNING fid
    `);

    // DISTINCT ON (fid) keeps the earliest round a player went first, so the
    // metadata records their original moment.
    const trailblazerInserted = await db.execute<{ fid: number }>(sql`
      INSERT INTO user_badges (fid, badge_type, metadata)
      SELECT DISTINCT ON (f.fid) f.fid, 'TRAILBLAZER',
             jsonb_build_object('roundId', f.round_id, 'backfill', true)
      FROM (${TRAILBLAZER_FIRSTS}) f
      ORDER BY f.fid, f.round_id
      ON CONFLICT (fid, badge_type) DO NOTHING
      RETURNING fid
    `);

    console.log(
      `🏅 Round 34 wordmarks backfill by FID ${devFid}: ` +
      `EARLY_ADOPTER +${earlyAdopterInserted.length}, TRAILBLAZER +${trailblazerInserted.length}`
    );

    return res.status(200).json({
      dryRun: false,
      earlyAdopter: { cutoffRound: EARLY_ADOPTER_LAST_ROUND, inserted: earlyAdopterInserted.length },
      trailblazer: { inserted: trailblazerInserted.length },
    });
  } catch (error) {
    console.error('[round34-wordmarks-backfill] Failed:', error);
    return res.status(500).json({ error: 'Backfill failed', detail: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Fix and Archive Round - Emergency endpoint
 *
 * Fixes corrupted round data and archives it in one operation.
 * Uses Drizzle's raw SQL to bypass ORM type coercion.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { randomBytes, createDecipheriv } from 'crypto';
import { db } from '../../../../src/db';
import { sql } from 'drizzle-orm';
import { isAdminFid } from '../me';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  let roundId = req.query.roundId ? parseInt(req.query.roundId as string, 10) : null;
  const adminFid = req.query.devFid as string;

  if (!adminFid || !isAdminFid(parseInt(adminFid, 10))) {
    return res.status(403).json({ error: 'Unauthorized - need admin devFid' });
  }

  try {
    // If no roundId specified, find the first unarchived resolved round
    if (!roundId) {
      console.log(`[fix-and-archive] No roundId specified, finding unarchived resolved rounds...`);

      // First, get full diagnostic data
      const allRoundsResult = await db.execute(sql`
        SELECT
          r.id,
          r.status::text as status,
          r.resolved_at,
          r.resolved_at IS NOT NULL as is_resolved
        FROM rounds r
        ORDER BY r.id
      `);

      const allArchivesResult = await db.execute(sql`
        SELECT round_number FROM round_archive ORDER BY round_number
      `);

      const archivedRoundNumbers = (allArchivesResult.rows as any[]).map(r => r.round_number);

      console.log(`[fix-and-archive] All rounds:`, allRoundsResult.rows);
      console.log(`[fix-and-archive] Archived round numbers:`, archivedRoundNumbers);

      // Find rounds that are resolved but not in archive
      const resolvedRounds = (allRoundsResult.rows as any[]).filter(r => r.is_resolved);
      const unarchivedResolved = resolvedRounds.filter(r => !archivedRoundNumbers.includes(r.id));

      console.log(`[fix-and-archive] Resolved rounds:`, resolvedRounds.map(r => r.id));
      console.log(`[fix-and-archive] Unarchived resolved:`, unarchivedResolved.map(r => r.id));

      if (unarchivedResolved.length === 0) {
        return res.status(404).json({
          error: 'No unarchived resolved rounds found',
          diagnostic: {
            allRounds: allRoundsResult.rows,
            archivedRoundNumbers,
            resolvedRoundIds: resolvedRounds.map(r => r.id),
            message: 'All resolved rounds are already archived, or no rounds have been resolved yet'
          }
        });
      }

      roundId = unarchivedResolved[0].id;
      console.log(`[fix-and-archive] Found unarchived round: ${roundId}`);
    }

    console.log(`[fix-and-archive] ========== STARTING FIX FOR ROUND ${roundId} ==========`);

    // Step 1: Get the raw round data - SELECT only specific columns as strings
    const roundResult = await db.execute(sql`
      SELECT
        id,
        answer::text as answer,
        salt::text as salt,
        commit_hash::text as commit_hash,
        prize_pool_eth::text as prize_pool_eth,
        seed_next_round_eth::text as seed_next_round_eth,
        winner_fid,
        referrer_fid,
        started_at,
        resolved_at,
        status::text as status
      FROM rounds
      WHERE id = ${roundId}
    `);

    if (!roundResult.rows || roundResult.rows.length === 0) {
      return res.status(404).json({ error: `Round ${roundId} not found` });
    }

    const rawRound = roundResult.rows[0] as any;

    // Log ALL field types with extreme detail
    console.log(`[fix-and-archive] Raw round ${roundId} data:`);
    for (const [key, value] of Object.entries(rawRound)) {
      const valueStr = value === null ? 'NULL' : String(value).substring(0, 100);
      console.log(`  ${key}: type=${typeof value}, isDate=${value instanceof Date}, isNull=${value === null}, value="${valueStr}"`);
    }

    // Step 2: Check and fix the salt field
    let salt = rawRound.salt;
    let saltFixed = false;
    let originalSalt = salt;

    // Check if salt needs fixing
    const saltNeedsFix = (
      salt === null ||
      salt === undefined ||
      typeof salt !== 'string' ||
      salt instanceof Date ||
      salt.length !== 64 ||
      !/^[a-f0-9]+$/i.test(salt)
    );

    if (saltNeedsFix) {
      console.log(`[fix-and-archive] Salt needs fixing:`);
      console.log(`  - type: ${typeof salt}`);
      console.log(`  - isDate: ${salt instanceof Date}`);
      console.log(`  - length: ${salt?.length}`);
      console.log(`  - isHex: ${salt ? /^[a-f0-9]+$/i.test(String(salt)) : 'N/A'}`);
      console.log(`  - value: ${String(salt).substring(0, 50)}`);

      // Generate new salt
      salt = randomBytes(32).toString('hex');
      saltFixed = true;

      // Update in database using raw SQL
      await db.execute(sql`UPDATE rounds SET salt = ${salt} WHERE id = ${roundId}`);
      console.log(`[fix-and-archive] ✅ Salt fixed: ${salt.substring(0, 16)}...`);
    } else {
      console.log(`[fix-and-archive] Salt is OK: ${salt.substring(0, 16)}...`);
    }

    // Step 3: Delete existing archive if present
    await db.execute(sql`DELETE FROM round_archive WHERE round_number = ${roundId}`);
    console.log(`[fix-and-archive] Cleared any existing archive for round ${roundId}`);

    // Step 4: Get statistics
    const guessStats = await db.execute(sql`
      SELECT COUNT(*) as total, COUNT(DISTINCT fid) as unique_players
      FROM guesses
      WHERE round_id = ${roundId}
    `);
    const totalGuesses = parseInt(String((guessStats.rows[0] as any)?.total || 0), 10);
    const uniquePlayers = parseInt(String((guessStats.rows[0] as any)?.unique_players || 0), 10);

    // Step 5: Get payouts
    const payoutsResult = await db.execute(sql`
      SELECT fid, amount_eth, role FROM round_payouts WHERE round_id = ${roundId}
    `);

    const payoutsJson: any = { topGuessers: [] };
    for (const payout of payoutsResult.rows as any[]) {
      if (payout.role === 'winner' && payout.fid) {
        payoutsJson.winner = { fid: payout.fid, amountEth: payout.amount_eth };
      } else if (payout.role === 'referrer' && payout.fid) {
        payoutsJson.referrer = { fid: payout.fid, amountEth: payout.amount_eth };
      } else if (payout.role === 'seed') {
        payoutsJson.seed = { amountEth: payout.amount_eth };
      } else if (payout.role === 'top_guesser' && payout.fid) {
        payoutsJson.topGuessers.push({
          fid: payout.fid,
          amountEth: payout.amount_eth,
          rank: payoutsJson.topGuessers.length + 1
        });
      }
    }

    // Step 6: Get previous round seed
    let seedEth = '0';
    if (roundId > 1) {
      const prevRound = await db.execute(sql`
        SELECT seed_next_round_eth::text as seed FROM rounds WHERE id = ${roundId - 1}
      `);
      if (prevRound.rows.length > 0) {
        seedEth = (prevRound.rows[0] as any)?.seed || '0';
      }
    }

    // Step 7: Decrypt answer
    let targetWord = String(rawRound.answer);
    console.log(`[fix-and-archive] Answer value: ${targetWord.substring(0, 50)}...`);

    if (targetWord.includes(':')) {
      // Encrypted format: iv:tag:ciphertext
      try {
        const [iv, tag, ciphertext] = targetWord.split(':');
        const key = Buffer.from(process.env.ANSWER_ENCRYPTION_KEY!, 'hex');
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
        decipher.setAuthTag(Buffer.from(tag, 'hex'));
        targetWord = decipher.update(ciphertext, 'hex', 'utf8') + decipher.final('utf8');
        console.log(`[fix-and-archive] Decrypted answer: ${targetWord}`);
      } catch (e) {
        console.error('[fix-and-archive] Failed to decrypt answer:', e);
        return res.status(500).json({ error: 'Failed to decrypt answer', details: String(e) });
      }
    }

    // Step 8: Insert archive record using raw SQL
    await db.execute(sql`
      INSERT INTO round_archive (
        round_number, target_word, seed_eth, final_jackpot_eth,
        total_guesses, unique_players, winner_fid, winner_guess_number,
        start_time, end_time, referrer_fid, payouts_json, salt,
        clankton_bonus_count, referral_bonus_count
      ) VALUES (
        ${roundId},
        ${targetWord},
        ${seedEth},
        ${rawRound.prize_pool_eth},
        ${totalGuesses},
        ${uniquePlayers},
        ${rawRound.winner_fid},
        ${null},
        ${rawRound.started_at},
        ${rawRound.resolved_at},
        ${rawRound.referrer_fid},
        ${JSON.stringify(payoutsJson)},
        ${salt},
        ${0},
        ${0}
      )
    `);

    console.log(`[fix-and-archive] ✅ Round ${roundId} archived successfully!`);

    return res.status(200).json({
      success: true,
      roundId,
      saltFixed,
      originalSalt: originalSalt ? String(originalSalt).substring(0, 30) + '...' : null,
      newSalt: saltFixed ? salt.substring(0, 30) + '...' : null,
      targetWord,
      totalGuesses,
      uniquePlayers,
      payouts: payoutsJson,
    });

  } catch (error) {
    console.error('[fix-and-archive] Error:', error);
    return res.status(500).json({
      error: 'Failed to fix and archive round',
      details: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

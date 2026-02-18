/**
 * Purge Test Round API Endpoint
 *
 * Safely deletes a test/phantom round and its associated data so the
 * round ID can be reused. Validates that the round only contains test
 * FIDs (>= 9000000) before allowing deletion.
 *
 * GET  - Diagnose: show what would be deleted
 * POST - Execute: delete guesses, round row, and reset sequence
 *
 * POST /api/admin/operational/purge-test-round
 * Body: { devFid: number, roundId: number }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from '../me';
import { db } from '../../../../src/db';
import { rounds, guesses, roundBonusWords, roundBurnWords, wordRewards, roundPayouts } from '../../../../src/db/schema';
import { eq, sql } from 'drizzle-orm';
import { invalidateOnRoundTransition } from '../../../../src/lib/redis';

const TEST_FID_THRESHOLD = 9_000_000;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Auth check
    const devFid = req.method === 'GET'
      ? parseInt(req.query.devFid as string, 10)
      : req.body.devFid;

    if (!devFid || !isAdminFid(devFid)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const roundId = req.method === 'GET'
      ? parseInt(req.query.roundId as string, 10)
      : req.body.roundId;

    if (!roundId || isNaN(roundId)) {
      return res.status(400).json({ error: 'roundId is required' });
    }

    // Fetch round
    const [round] = await db.select().from(rounds).where(eq(rounds.id, roundId));
    if (!round) {
      return res.status(404).json({ error: `Round ${roundId} not found` });
    }

    // Count associated data
    const [guessStats] = await db.select({
      total: sql<number>`cast(count(*) as int)`,
      paid: sql<number>`cast(count(*) filter (where ${guesses.isPaid} = true) as int)`,
      distinctFids: sql<number>`cast(count(distinct ${guesses.fid}) as int)`,
      minFid: sql<number>`min(${guesses.fid})`,
      realUserCount: sql<number>`cast(count(distinct ${guesses.fid}) filter (where ${guesses.fid} < ${TEST_FID_THRESHOLD}) as int)`,
    }).from(guesses).where(eq(guesses.roundId, roundId));

    const [bonusCount] = await db.select({ count: sql<number>`cast(count(*) as int)` }).from(roundBonusWords).where(eq(roundBonusWords.roundId, roundId));
    const [burnCount] = await db.select({ count: sql<number>`cast(count(*) as int)` }).from(roundBurnWords).where(eq(roundBurnWords.roundId, roundId));
    const [rewardCount] = await db.select({ count: sql<number>`cast(count(*) as int)` }).from(wordRewards).where(eq(wordRewards.roundId, roundId));
    const [payoutCount] = await db.select({ count: sql<number>`cast(count(*) as int)` }).from(roundPayouts).where(eq(roundPayouts.roundId, roundId));

    const [seqResult] = await db.execute(sql`SELECT last_value::int as last_value FROM rounds_id_seq`);
    const currentSeq = Number(seqResult.last_value);

    const hasRealUsers = guessStats.realUserCount > 0;
    const hasPayouts = payoutCount.count > 0;
    const hasRewards = rewardCount.count > 0;

    const diagnosis = {
      roundId,
      status: round.status,
      startedAt: round.startedAt?.toISOString() ?? null,
      resolvedAt: round.resolvedAt?.toISOString() ?? null,
      winnerFid: round.winnerFid,
      prizePoolEth: round.prizePoolEth,
      guesses: {
        total: guessStats.total,
        paid: guessStats.paid,
        distinctFids: guessStats.distinctFids,
        realUserCount: guessStats.realUserCount,
      },
      bonusWords: bonusCount.count,
      burnWords: burnCount.count,
      wordRewards: rewardCount.count,
      payouts: payoutCount.count,
      currentSequence: currentSeq,
      canPurge: !hasRealUsers && !hasPayouts && !hasRewards,
      blockReason: hasRealUsers ? 'Round has guesses from real users (FID < 9000000)'
        : hasPayouts ? 'Round has existing payouts'
        : hasRewards ? 'Round has existing word rewards'
        : null,
    };

    // GET: Diagnose only
    if (req.method === 'GET') {
      return res.status(200).json({ diagnosis });
    }

    // POST: Execute purge
    if (!diagnosis.canPurge) {
      return res.status(400).json({
        error: 'Cannot purge this round',
        reason: diagnosis.blockReason,
        diagnosis,
      });
    }

    console.log(`[purge-test-round] Admin FID ${devFid} purging round ${roundId}`);

    // Delete all FK-dependent rows before deleting the round itself
    await db.delete(guesses).where(eq(guesses.roundId, roundId));
    await db.delete(roundBonusWords).where(eq(roundBonusWords.roundId, roundId));
    await db.delete(roundBurnWords).where(eq(roundBurnWords.roundId, roundId));
    await db.delete(wordRewards).where(eq(wordRewards.roundId, roundId));
    await db.delete(roundPayouts).where(eq(roundPayouts.roundId, roundId));
    // Tables without Drizzle schema exports — use raw SQL
    await db.execute(sql`DELETE FROM announcer_events WHERE round_id = ${roundId}`);
    await db.execute(sql`DELETE FROM operational_events WHERE round_id = ${roundId}`);
    await db.execute(sql`DELETE FROM pack_purchases WHERE round_id = ${roundId}`);
    await db.execute(sql`DELETE FROM refunds WHERE round_id = ${roundId}`);
    await db.execute(sql`DELETE FROM round_economics_config WHERE round_id = ${roundId}`);
    await db.execute(sql`DELETE FROM round_seed_words WHERE round_id = ${roundId}`);
    // Now safe to delete the round
    await db.delete(rounds).where(eq(rounds.id, roundId));

    // Reset sequence so next insert gets this round ID
    await db.execute(sql`SELECT setval('rounds_id_seq', ${roundId - 1}, true)`);

    // Invalidate caches
    try {
      await invalidateOnRoundTransition();
    } catch (err) {
      console.warn('[purge-test-round] Cache invalidation failed:', err);
    }

    const [newSeq] = await db.execute(sql`SELECT last_value::int as last_value FROM rounds_id_seq`);

    console.log(`[purge-test-round] Round ${roundId} purged. Sequence reset to ${Number(newSeq.last_value)}`);

    return res.status(200).json({
      success: true,
      purged: {
        roundId,
        guessesDeleted: guessStats.total,
        bonusWordsDeleted: bonusCount.count,
        burnWordsDeleted: burnCount.count,
      },
      sequenceResetTo: Number(newSeq.last_value),
      nextRoundWillBe: Number(newSeq.last_value) + 1,
    });
  } catch (error) {
    console.error('[purge-test-round] Error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to purge round',
    });
  }
}

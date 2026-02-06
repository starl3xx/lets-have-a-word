/**
 * Recover Stuck Round API Endpoint
 *
 * Handles the "zombie round" scenario where Phase 1 (DB lock) succeeded
 * but Phase 2 (onchain resolution + payouts) failed. The round has
 * winnerFid set but resolvedAt is null, no payouts, no onchain tx.
 *
 * This bypasses getActiveRound() which can't find zombie rounds
 * (it filters on isNull(winnerFid)).
 *
 * GET  - Diagnose: show round state, contract state, and what recovery would do
 * POST - Execute: complete the onchain resolution and payouts
 *
 * POST /api/admin/operational/recover-stuck-round
 * Body: { devFid: number, roundId: number }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
import { isAdminFid } from '../me';
import { db } from '../../../../src/db';
import { rounds, roundPayouts, guesses } from '../../../../src/db/schema';
import { eq, count } from 'drizzle-orm';
import { resolveRoundAndCreatePayouts } from '../../../../src/lib/economics';
import { getContractRoundInfo, getMainnetContractBalance } from '../../../../src/lib/jackpot-contract';
import { getPlaintextAnswer } from '../../../../src/lib/encryption';
import { invalidateOnRoundTransition } from '../../../../src/lib/redis';
import { enableDeadDay } from '../../../../src/lib/operational';

interface StuckRoundDiagnosis {
  round: {
    id: number;
    status: string;
    winnerFid: number | null;
    resolvedAt: string | null;
    txHash: string | null;
    prizePoolEth: string;
    answer: string;
  };
  contract: {
    roundNumber: string;
    isActive: boolean;
    jackpotEth: string;
    balanceEth: string;
  } | null;
  payoutsExist: boolean;
  payoutCount: number;
  totalGuesses: number;
  isStuck: boolean;
  stuckReason: string | null;
}

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

    // ================================================================
    // Load round directly by ID (bypasses getActiveRound filters)
    // ================================================================
    const [round] = await db
      .select()
      .from(rounds)
      .where(eq(rounds.id, roundId))
      .limit(1);

    if (!round) {
      return res.status(404).json({ error: `Round ${roundId} not found` });
    }

    // Check existing payouts
    const [payoutResult] = await db
      .select({ count: count() })
      .from(roundPayouts)
      .where(eq(roundPayouts.roundId, roundId));
    const payoutCount = payoutResult?.count ?? 0;

    // Check guess count
    const [guessResult] = await db
      .select({ count: count() })
      .from(guesses)
      .where(eq(guesses.roundId, roundId));
    const totalGuesses = guessResult?.count ?? 0;

    // Query contract state
    let contractState: StuckRoundDiagnosis['contract'] = null;
    try {
      const roundInfo = await getContractRoundInfo();
      const balance = await getMainnetContractBalance();
      contractState = {
        roundNumber: roundInfo.roundNumber.toString(),
        isActive: roundInfo.isActive,
        jackpotEth: (Number(roundInfo.jackpot) / 1e18).toFixed(6),
        balanceEth: balance,
      };
    } catch (error) {
      console.error('[recover-stuck-round] Failed to query contract:', error);
    }

    // Determine if round is stuck
    let isStuck = false;
    let stuckReason: string | null = null;

    if (round.winnerFid && !round.resolvedAt) {
      isStuck = true;
      stuckReason = 'Phase 1 completed (winnerFid set) but Phase 2 failed (resolvedAt is null, no onchain resolution)';
    } else if (round.resolvedAt && !round.txHash) {
      isStuck = true;
      stuckReason = 'Round marked resolved in DB but no onchain tx hash — payouts may not have been sent';
    } else if (!round.winnerFid && !round.resolvedAt && round.status === 'active') {
      stuckReason = 'Round is still active with no winner — not a stuck round, use force-resolve instead';
    }

    // Decrypt answer for admin display
    let answer = '[encrypted]';
    try {
      answer = getPlaintextAnswer(round.answer);
    } catch {
      answer = '[decryption failed]';
    }

    const diagnosis: StuckRoundDiagnosis = {
      round: {
        id: round.id,
        status: round.status ?? 'unknown',
        winnerFid: round.winnerFid,
        resolvedAt: round.resolvedAt?.toISOString() ?? null,
        txHash: round.txHash ?? null,
        prizePoolEth: round.prizePoolEth,
        answer,
      },
      contract: contractState,
      payoutsExist: payoutCount > 0,
      payoutCount,
      totalGuesses,
      isStuck,
      stuckReason,
    };

    // ================================================================
    // GET: Diagnose only
    // ================================================================
    if (req.method === 'GET') {
      return res.status(200).json({
        ok: true,
        action: 'diagnose',
        diagnosis,
        message: isStuck
          ? 'Round is stuck. POST to this endpoint with { devFid, roundId } to recover.'
          : 'Round does not appear to be stuck.',
      });
    }

    // ================================================================
    // POST: Execute recovery
    // ================================================================
    if (!isStuck) {
      return res.status(400).json({
        ok: false,
        error: 'Round is not in a recoverable stuck state',
        diagnosis,
      });
    }

    if (!round.winnerFid) {
      return res.status(400).json({
        ok: false,
        error: 'Round has no winner — cannot recover. Use force-resolve to end the round first.',
        diagnosis,
      });
    }

    console.log(`[recover-stuck-round] Admin ${devFid} recovering round ${roundId}`);
    console.log(`[recover-stuck-round] Winner: FID ${round.winnerFid}, Prize: ${round.prizePoolEth} ETH`);

    // Attempt to complete Phase 2: onchain resolution + payouts
    try {
      await resolveRoundAndCreatePayouts(roundId, round.winnerFid);

      console.log(`[recover-stuck-round] ✅ Round ${roundId} recovery complete!`);

      // Invalidate all caches
      await invalidateOnRoundTransition(roundId).catch(err => {
        console.error('[recover-stuck-round] Cache invalidation failed:', err);
      });

      // Fetch final round state
      const [recoveredRound] = await db
        .select()
        .from(rounds)
        .where(eq(rounds.id, roundId))
        .limit(1);

      // Enable dead day to prevent auto-starting a new round
      // Admin can manually disable dead day and start next round when ready
      let deadDayEnabled = false;
      try {
        const deadDayResult = await enableDeadDay({
          adminFid: devFid,
          reason: `Auto-enabled after recovering stuck round ${roundId}. Disable when ready to start next round.`,
        });
        deadDayEnabled = deadDayResult.success;
        if (deadDayEnabled) {
          console.log(`[recover-stuck-round] ✅ Dead day enabled after recovery`);
        } else {
          console.log(`[recover-stuck-round] Dead day not enabled: ${deadDayResult.error}`);
        }
      } catch (deadDayError) {
        console.error('[recover-stuck-round] Failed to enable dead day:', deadDayError);
      }

      // Report to Sentry
      Sentry.captureMessage('Stuck round recovered', {
        level: 'info',
        tags: { type: 'admin-action', action: 'recover_stuck_round' },
        extra: { roundId, winnerFid: round.winnerFid, adminFid: devFid, deadDayEnabled },
      });

      return res.status(200).json({
        ok: true,
        action: 'recovered',
        roundId,
        winnerFid: round.winnerFid,
        resolvedAt: recoveredRound?.resolvedAt?.toISOString() ?? null,
        txHash: recoveredRound?.txHash ?? null,
        deadDayEnabled,
        message: `Round ${roundId} recovered! Winner FID ${round.winnerFid} should receive payouts.${deadDayEnabled ? ' Dead day enabled — disable it when ready to start the next round.' : ''}`,
      });

    } catch (resolveError: any) {
      console.error(`[recover-stuck-round] ❌ Recovery failed:`, resolveError);

      Sentry.captureException(resolveError, {
        tags: { endpoint: 'recover-stuck-round', roundId: roundId.toString() },
        extra: { winnerFid: round.winnerFid, adminFid: devFid },
      });

      return res.status(500).json({
        ok: false,
        error: `Recovery failed: ${resolveError.message}`,
        diagnosis,
        hint: resolveError.message.includes('balance')
          ? 'Contract balance may be insufficient. Check contract state on Basescan.'
          : resolveError.message.includes('not active')
            ? 'Contract says round is not active. The contract state may need manual intervention.'
            : 'Check server logs for full error details.',
      });
    }

  } catch (error) {
    console.error('[admin/operational/recover-stuck-round] Error:', error);
    Sentry.captureException(error, {
      tags: { endpoint: 'admin-recover-stuck-round' },
    });
    const message = error instanceof Error ? error.message : 'Internal server error';
    return res.status(500).json({ error: message });
  }
}

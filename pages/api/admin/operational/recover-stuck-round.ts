/**
 * Recover Stuck Round API Endpoint
 *
 * Handles both ends of a round that half-happened.
 *
 * RESOLVE-SIDE ZOMBIE (the original): Phase 1 (DB lock) succeeded but Phase 2
 * (onchain resolution + payouts) failed. The round has winnerFid set but
 * resolvedAt is null, no payouts, no onchain tx. This bypasses getActiveRound()
 * which can't find zombie rounds (it filters on isNull(winnerFid)).
 *
 * START-SIDE ZOMBIE (added after round 35's auto-start): WordJackpot is still
 * holding a round id the database has given up on, so every subsequent start
 * fails the contract's own "round N is still active" preflight — forever,
 * because the public round number IS rounds.id. Three ways in, all cleared the
 * same way:
 *   - startRound mined but createRound's tx.wait() threw, so the row was
 *     marked 'cancelled' while the contract kept activeRoundId set;
 *   - the invocation died mid-start and the row is still 'pending';
 *   - THE KILL SWITCH. It now attempts this same release on its way out
 *     (src/lib/operational.ts), but that attempt is time-boxed and soft: it
 *     never blocks the cancellation, so a slow or unreachable RPC still leaves
 *     the round wedged onchain with all of its guesses on it. The guess count
 *     is therefore not a condition of this recovery; the pool it releases was
 *     never owed to those players, who are refunded in ETH through the refund
 *     path.
 * A round id with NO database row is handled too (handleOrphanOnchainRound):
 * nothing else can reach it, because force-resolve and emergency-resolve both
 * work through getActiveRound(), which needs a row.
 * WordJackpot.resolveRound(roundId, [], [], pool) is the whole fix: it passes
 * the total != pool check, returns the pool as carry for the next round and
 * sets activeRoundId = 0. One operator transaction, no DB surgery.
 *
 * GET  - Diagnose: show round state, contract state, and what recovery would do
 * POST - Execute: complete the onchain resolution and payouts, or clear the
 *        onchain round (the latter needs an explicit `confirm` string)
 *
 * POST /api/admin/operational/recover-stuck-round
 * Body: { devFid: number, roundId: number }
 *       { devFid: number, roundId: number, confirm: 'CLEAR_ONCHAIN_ROUND_<id>' }
 *
 * WHICH RESOLUTION TOOL IS FOR WHAT (the three overlap by design):
 * - force-resolve: a LIVE round you want ended now (test rounds, launch drills).
 * - emergency-resolve: winner FOUND but the automatic resolution threw —
 *   finishes payout for a round that already has its winner.
 * - recover-stuck-round: winnerFid recorded but NO payout and NO onchain tx
 *   ("zombie round"), or a round the contract still holds that the DB has
 *   given up on — diagnoses first, then executes.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
import { isAdminFid } from '../me';
import { db } from '../../../../src/db';
import { rounds, roundPayouts, guesses } from '../../../../src/db/schema';
import { eq, count } from 'drizzle-orm';
import { resolveRoundAndCreatePayouts } from '../../../../src/lib/economics';
import { getContractRoundInfo, getMainnetContractBalance } from '../../../../src/lib/jackpot-contract';
import { formatPrize } from '../../../../src/lib/prize-display';
import { getPlaintextAnswer } from '../../../../src/lib/encryption';
import { invalidateOnRoundTransition } from '../../../../src/lib/redis';
import { enableDeadDay } from '../../../../src/lib/operational';
import { getActiveRound } from '../../../../src/lib/rounds';

interface StuckRoundDiagnosis {
  /**
   * Null in exactly one case: WordJackpot is holding a round id the database
   * has no row for. Every UI reader already guards on this object's presence.
   */
  round: {
    id: number;
    status: string;
    winnerFid: number | null;
    resolvedAt: string | null;
    txHash: string | null;
    prizePoolEth: string;
    prizeCurrency: string | null;
    prizePoolWord: string | null;
    /** Prize with its unit ("0.02 ETH" / "78,125,000 $WORD"). */
    prizeDisplay: string;
    answer: string;
  } | null;
  contract: {
    /** Which contract these numbers come from — era-dependent. */
    contractName: string;
    roundNumber: string;
    isActive: boolean;
    jackpotEth?: string;
    balanceEth?: string;
    poolWord?: string;
    balanceWord?: string;
  } | null;
  payoutsExist: boolean;
  payoutCount: number;
  totalGuesses: number;
  isStuck: boolean;
  stuckReason: string | null;
  /**
   * Which arm a POST would take. 'payout' finishes a resolution that has a
   * winner; 'clear_onchain_round' releases a round the contract still holds
   * and the DB has abandoned. Null means POST will refuse.
   */
  recovery: 'payout' | 'clear_onchain_round' | null;
}

/** The confirmation string a start-side clear requires, carrying the round id. */
function clearConfirmation(roundId: number): string {
  return `CLEAR_ONCHAIN_ROUND_${roundId}`;
}

/**
 * Row statuses a start-side clear may act on.
 *
 * 'pending' is a start whose seeding never confirmed. 'cancelled' is either
 * the same start after createRound's catch retired the row, OR a round the
 * kill switch cancelled (src/lib/operational.ts) — whose own release attempt
 * is time-boxed and may not have landed, leaving the contract holding the id
 * while the DB row is dead. That second case carries guesses, which is why the
 * guess count is NOT one of the conditions below.
 *
 * Everything else stays out: 'active' is a live round, and a resolved round is
 * excluded by resolvedAt/winnerFid/payouts anyway.
 */
const CLEARABLE_STATUSES = new Set(['pending', 'cancelled']);

interface ClearedOnchainRound {
  ok: true;
  txHash: string;
  poolWei: bigint;
  carriedDisplay: string;
  activeRoundIdAfter: bigint;
  blockNumber: number | null;
}

/**
 * Release a round WordJackpot is still holding: resolveRound(id, [], [], pool).
 *
 * Shared by the two doors into this recovery — a DB row the game gave up on,
 * and an id with no row at all — because the transaction and its guards are
 * identical either way.
 *
 * The guard and the send are `releaseHeldWordRound` in src/lib/operational.ts,
 * because the kill switch now takes the same transaction on the way out: one
 * re-read, one definition of "safe to send". What stays here is the part an
 * operator-initiated recovery wants and the kill switch cannot afford — it
 * WAITS for the receipt, so the response says what actually happened onchain.
 */
async function clearOnchainRound(
  roundId: number,
  adminFid: number
): Promise<ClearedOnchainRound | { ok: false; activeRoundIdNow: number; reason: string }> {
  const { formatWordAmount, getWordJackpotReadOnly } = await import(
    '../../../../src/lib/word-jackpot-contract'
  );
  const { releaseHeldWordRound } = await import('../../../../src/lib/operational');

  const released = await releaseHeldWordRound(roundId);
  if (!released.ok) return released;

  const { tx, poolWei } = released;
  console.log(
    `[recover-stuck-round] Admin ${adminFid} clearing onchain round ${roundId} — ` +
      `pool ${formatWordAmount(poolWei)} $WORD returns as carry (tx ${tx.hash})`
  );

  const receipt = await tx.wait();
  const activeRoundIdAfter = (await getWordJackpotReadOnly().activeRoundId()) as bigint;

  Sentry.captureMessage('Onchain round cleared after failed start', {
    level: 'warning',
    tags: { type: 'admin-action', action: 'clear_onchain_round' },
    extra: {
      roundId,
      adminFid,
      txHash: tx.hash,
      poolWei: poolWei.toString(),
      activeRoundIdAfter: activeRoundIdAfter.toString(),
    },
  });

  console.log(
    `[recover-stuck-round] ✅ Onchain round ${roundId} cleared — block ${receipt?.blockNumber}, ` +
      `activeRoundId now ${activeRoundIdAfter}`
  );

  return {
    ok: true,
    txHash: tx.hash,
    poolWei,
    carriedDisplay: `${formatWordAmount(poolWei)} $WORD`,
    activeRoundIdAfter,
    blockNumber: receipt?.blockNumber ?? null,
  };
}

/**
 * The wedge with no database row behind it.
 *
 * WordJackpot holds round N and `rounds` has nothing for N — an id that was
 * hard-deleted, or a contract pointed at a different database. createRound's
 * refusal names this endpoint for that case, and until this branch existed the
 * POST it names answered 404 before it ever read the contract: no DB-backed
 * tool could reach the state at all, because force-resolve and
 * emergency-resolve both work through getActiveRound(), which needs a row.
 *
 * Same transaction, same confirmation string, same re-read as the row-backed
 * arm. The only differences are that the counts are trivially zero and there
 * is no row to retire afterwards.
 */
async function handleOrphanOnchainRound(
  req: NextApiRequest,
  res: NextApiResponse,
  roundId: number,
  devFid: number
) {
  let activeRoundIdNow = 0;
  let onchainActive = false;
  let poolDisplay: string | null = null;
  let balanceDisplay: string | null = null;

  try {
    const { getWordJackpotReadOnly, getWordRound, formatWordAmount } = await import(
      '../../../../src/lib/word-jackpot-contract'
    );
    const jackpot = getWordJackpotReadOnly();
    const [activeRoundId, onchainRound, solvency] = await Promise.all([
      jackpot.activeRoundId() as Promise<bigint>,
      getWordRound(roundId),
      jackpot.solvency() as Promise<[bigint, bigint, bigint, bigint, bigint]>,
    ]);
    activeRoundIdNow = Number(activeRoundId);
    onchainActive = onchainRound.active;
    poolDisplay = formatWordAmount(solvency[1]);
    balanceDisplay = formatWordAmount(solvency[0]);
  } catch (error) {
    // An unreadable contract can never justify sending a transaction, so this
    // stays the plain 404 it always was — with the reason attached.
    const message = error instanceof Error ? error.message : String(error);
    return res.status(404).json({
      error:
        `Round ${roundId} not found in the database, and WordJackpot could not be read to ` +
        `check whether it is still holding that id: ${message}`,
    });
  }

  // Another live round while the contract holds this id is a much stranger
  // state than this recovery is for. Read through getActiveRound() so the
  // definition of "active" cannot drift from the game's.
  const wedged =
    activeRoundIdNow === roundId && onchainActive && (await getActiveRound()) === null;

  if (!wedged) {
    return res.status(404).json({
      error: `Round ${roundId} not found`,
      onchainActiveRoundId: activeRoundIdNow,
      hint:
        activeRoundIdNow === 0
          ? 'WordJackpot is holding no round either — nothing to clear.'
          : `WordJackpot is holding round ${activeRoundIdNow}, not ${roundId}.`,
    });
  }

  const stuckReason =
    `WordJackpot still holds round ${roundId} as its active round and the database has no row ` +
    `for it at all. No round can start until the contract lets the id go.`;

  const diagnosis: StuckRoundDiagnosis = {
    round: null,
    contract: {
      contractName: 'WordJackpot',
      roundNumber: activeRoundIdNow.toString(),
      isActive: true,
      poolWord: poolDisplay ?? undefined,
      balanceWord: balanceDisplay ?? undefined,
    },
    payoutsExist: false,
    payoutCount: 0,
    totalGuesses: 0,
    isStuck: true,
    stuckReason,
    recovery: 'clear_onchain_round',
  };

  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      action: 'diagnose',
      diagnosis,
      message:
        `Round ${roundId} is wedged onchain with no database row. POST { devFid, roundId, ` +
        `confirm: '${clearConfirmation(roundId)}' } to release it — the pool returns as carry ` +
        `for the next round and auto-start resumes.`,
    });
  }

  const expectedConfirm = clearConfirmation(roundId);
  if (req.body?.confirm !== expectedConfirm) {
    return res.status(400).json({
      ok: false,
      error:
        `This recovery sends an irreversible operator transaction. Re-POST with ` +
        `confirm: '${expectedConfirm}' to proceed.`,
      diagnosis,
    });
  }

  try {
    const result = await clearOnchainRound(roundId, devFid);
    if (!result.ok) {
      return res.status(409).json({
        ok: false,
        error: `Contract state changed. ${result.reason}`,
        diagnosis,
      });
    }

    return res.status(200).json({
      ok: true,
      action: 'cleared_onchain_round',
      roundId,
      txHash: result.txHash,
      carriedWord: result.poolWei.toString(),
      carriedDisplay: result.carriedDisplay,
      activeRoundIdAfter: result.activeRoundIdAfter.toString(),
      message:
        `WordJackpot round ${roundId} released (no database row existed). ` +
        `${result.carriedDisplay} carried to the next round. Auto-start can run again on its ` +
        `next tick.`,
    });
  } catch (clearError: any) {
    console.error(`[recover-stuck-round] ❌ Clearing orphan round ${roundId} failed:`, clearError);
    Sentry.captureException(clearError, {
      tags: {
        endpoint: 'recover-stuck-round',
        action: 'clear_onchain_round',
        roundId: roundId.toString(),
      },
      extra: { adminFid: devFid, orphan: true },
    });
    return res.status(500).json({
      ok: false,
      error: `Clearing the onchain round failed: ${clearError.message}`,
      diagnosis,
    });
  }
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
      : Number(req.body?.devFid);

    if (!devFid || !isAdminFid(devFid)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Coerced for BOTH methods. The start-side arms compare this strictly
    // against a number read off the contract (`onchainActiveWordRoundId ===
    // roundId`), so a JSON string roundId — which a hand-written curl produces
    // as readily as a number — used to make the endpoint answer "not in a
    // recoverable stuck state" for the one round it exists to recover.
    // `req.body?.` also keeps a POST with no parsed body a 400 rather than a 500.
    const roundId = Number(
      req.method === 'GET' ? req.query.roundId : req.body?.roundId
    );

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
      // No row — but WordJackpot may still be holding this id. createRound's
      // refusal message points an operator here for exactly that state, and it
      // used to 404 before ever reading the contract.
      return await handleOrphanOnchainRound(req, res, roundId, devFid);
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

    // Query contract state — from the contract that ran THIS round. A $WORD
    // round diagnosed against the legacy JackpotManager shows numbers that
    // have nothing to do with the stuck round.
    let contractState: StuckRoundDiagnosis['contract'] = null;
    // Kept as a number rather than read back off the display string above: the
    // start-side arm sends a transaction off this value.
    let onchainActiveWordRoundId: number | null = null;
    try {
      if (round.prizeCurrency === 'word') {
        const { getWordJackpotReadOnly } = await import('../../../../src/lib/word-jackpot-contract');
        const { ethers } = await import('ethers');
        const jackpot = getWordJackpotReadOnly();
        const [solvency, activeRoundId] = await Promise.all([
          jackpot.solvency() as Promise<[bigint, bigint, bigint, bigint, bigint]>,
          jackpot.activeRoundId() as Promise<bigint>,
        ]);
        const [wjBalance, wjPool] = solvency;
        onchainActiveWordRoundId = Number(activeRoundId);
        contractState = {
          contractName: 'WordJackpot',
          roundNumber: activeRoundId.toString(),
          isActive: activeRoundId > 0n,
          poolWord: Math.floor(parseFloat(ethers.formatEther(wjPool))).toLocaleString(),
          balanceWord: Math.floor(parseFloat(ethers.formatEther(wjBalance))).toLocaleString(),
        };
      } else {
        const roundInfo = await getContractRoundInfo();
        const balance = await getMainnetContractBalance();
        contractState = {
          contractName: 'JackpotManager (ETH era)',
          roundNumber: roundInfo.roundNumber.toString(),
          isActive: roundInfo.isActive,
          jackpotEth: (Number(roundInfo.jackpot) / 1e18).toFixed(6),
          balanceEth: balance,
        };
      }
    } catch (error) {
      console.error('[recover-stuck-round] Failed to query contract:', error);
    }

    // The start-side wedge, checked in full before anything is reported as
    // recoverable. Every condition is a reason the contract could legitimately
    // be holding this id, so all of them have to be false for it to be a
    // zombie — and the transaction this unlocks is irreversible.
    const looksLikeStartSideZombie =
      round.prizeCurrency === 'word' &&          // WordJackpot is the only contract with this failure mode
      onchainActiveWordRoundId === roundId &&    // the contract is holding THIS id
      CLEARABLE_STATUSES.has(round.status ?? '') && // ...and the DB has given up on it
      !round.resolvedAt &&                       // never resolved, so the pool is promised to nobody
      !round.winnerFid &&                        // no winner was ever recorded
      payoutCount === 0;                         // and nothing has been paid out of it

    // The guess count is deliberately NOT a condition. It was, and it refused
    // the likeliest real instance of this wedge: the kill switch sets the row
    // to 'cancelled' and makes no onchain call whatsoever, so the classic
    // stuck state is a cancelled round WITH thousands of guesses and a
    // contract still holding the id. Those players are refunded in ETH through
    // the refund path; the $WORD pool this releases was never owed to them,
    // and the conditions above are what keep it from being owed to anyone.

    // The last condition costs a query and a decrypt, so it is only asked once
    // the cheap ones agree. Read through getActiveRound() rather than a local
    // query so the definition of "active" cannot drift from the game's: another
    // live round while the contract holds this id is a much stranger state than
    // this recovery is for.
    const isStartSideZombie =
      looksLikeStartSideZombie && (await getActiveRound()) === null;

    // Determine if round is stuck
    let isStuck = false;
    let stuckReason: string | null = null;

    if (round.winnerFid && !round.resolvedAt) {
      isStuck = true;
      stuckReason = 'Phase 1 completed (winnerFid set) but Phase 2 failed (resolvedAt is null, no onchain resolution)';
    } else if (round.resolvedAt && !round.txHash) {
      isStuck = true;
      stuckReason = 'Round marked resolved in DB but no onchain tx hash — payouts may not have been sent';
    } else if (isStartSideZombie) {
      isStuck = true;
      stuckReason =
        `WordJackpot still holds round ${roundId} as its active round, but the DB row is ` +
        `'${round.status}' with no winner and no payouts` +
        (totalGuesses > 0
          ? ` (${totalGuesses.toLocaleString()} guesses were played before it was ` +
            `${round.status} — they are refunded through the refund path, not from this pool)`
          : '') +
        `. Every new round start fails the contract's "still active onchain" preflight until ` +
        `this is cleared.`;
    } else if (!round.winnerFid && !round.resolvedAt && round.status === 'active') {
      stuckReason = 'Round is still active with no winner — not a stuck round, use force-resolve instead';
    }

    const recovery: StuckRoundDiagnosis['recovery'] = isStartSideZombie
      ? 'clear_onchain_round'
      : isStuck && round.winnerFid
        ? 'payout'
        : null;

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
        prizeCurrency: round.prizeCurrency ?? null,
        prizePoolWord: round.prizePoolWord ?? null,
        prizeDisplay: formatPrize({
          currency: round.prizeCurrency === 'word' ? 'word' : 'eth',
          eth: round.prizePoolEth,
          word: round.prizePoolWord,
        }),
        answer,
      },
      contract: contractState,
      payoutsExist: payoutCount > 0,
      payoutCount,
      totalGuesses,
      isStuck,
      stuckReason,
      recovery,
    };

    // ================================================================
    // GET: Diagnose only
    // ================================================================
    if (req.method === 'GET') {
      return res.status(200).json({
        ok: true,
        action: 'diagnose',
        diagnosis,
        message:
          recovery === 'clear_onchain_round'
            ? `Round ${roundId} is wedged onchain. POST { devFid, roundId, confirm: ` +
              `'${clearConfirmation(roundId)}' } to release it — the seed returns as carry ` +
              `for the next round and auto-start resumes.`
            : isStuck
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

    // ----------------------------------------------------------------
    // START-SIDE ZOMBIE: release the round the contract is still holding
    // ----------------------------------------------------------------
    if (recovery === 'clear_onchain_round') {
      const expectedConfirm = clearConfirmation(roundId);
      if (req.body?.confirm !== expectedConfirm) {
        return res.status(400).json({
          ok: false,
          error:
            `This recovery sends an irreversible operator transaction. Re-POST with ` +
            `confirm: '${expectedConfirm}' to proceed.`,
          diagnosis,
        });
      }

      try {
        // The transaction, its re-read and its Sentry breadcrumb live in
        // clearOnchainRound — the same code the no-DB-row arm above sends.
        const result = await clearOnchainRound(roundId, devFid);
        if (!result.ok) {
          return res.status(409).json({
            ok: false,
            error: `Contract state changed. ${result.reason}`,
            diagnosis,
          });
        }

        // A 'pending' row is the one status nothing in the codebase reads —
        // no query, no sweeper. Retire it explicitly so the row records what
        // happened instead of sitting in a state with no reader. A 'cancelled'
        // row already carries its own reason (the failed seeding, or the kill
        // switch) and must keep it.
        if (round.status === 'pending') {
          await db
            .update(rounds)
            .set({
              status: 'cancelled',
              cancelledAt: new Date(),
              cancelledBy: devFid,
              cancelledReason:
                `Start-side zombie cleared by admin ${devFid}: WordJackpot round ${roundId} ` +
                `released, pool returned as carry (tx ${result.txHash})`.slice(0, 500),
            })
            .where(eq(rounds.id, roundId));
        }

        // Dead day is deliberately NOT enabled here, unlike the payout arm
        // below: the entire point of this recovery is to let auto-start make
        // the next round, and dead day would block exactly that.
        return res.status(200).json({
          ok: true,
          action: 'cleared_onchain_round',
          roundId,
          txHash: result.txHash,
          carriedWord: result.poolWei.toString(),
          carriedDisplay: result.carriedDisplay,
          activeRoundIdAfter: result.activeRoundIdAfter.toString(),
          message:
            `WordJackpot round ${roundId} released. ${result.carriedDisplay} carried to the ` +
            `next round. Auto-start can run again on its next tick.`,
        });
      } catch (clearError: any) {
        console.error(`[recover-stuck-round] ❌ Clearing round ${roundId} failed:`, clearError);
        Sentry.captureException(clearError, {
          tags: { endpoint: 'recover-stuck-round', action: 'clear_onchain_round', roundId: roundId.toString() },
          extra: { adminFid: devFid },
        });
        return res.status(500).json({
          ok: false,
          error: `Clearing the onchain round failed: ${clearError.message}`,
          diagnosis,
        });
      }
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

import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
import { awardPaidPack, getOrCreateDailyState, getTodayUTC, DAILY_LIMITS_RULES } from '../../src/lib/daily-limits';
import { logAnalyticsEvent, AnalyticsEventTypes } from '../../src/lib/analytics';
import { getActiveRound } from '../../src/lib/rounds';
import { logXpEvent } from '../../src/lib/xp';
import { db } from '../../src/db';
import { guesses, packPurchases } from '../../src/db/schema';
import { eq, sql } from 'drizzle-orm';
import {
  getTotalPackCostWei,
  weiToEthString,
  getPricingPhase,
  getVolumeTier,
  getVolumeMultiplier,
  getPacksRemainingAtCurrentTier,
  getNextTierMultiplier,
  getNextResetTime,
  type VolumeTier,
} from '../../src/lib/pack-pricing';
import {
  invalidateRoundStateCache,
  invalidateUserCaches,
} from '../../src/lib/redis';
import { applyGameplayGuard } from '../../src/lib/operational-guard';
import {
  checkPurchaseRateLimit,
  extractRequestMetadata,
} from '../../src/lib/rateLimit';
import { AppErrorCodes } from '../../src/lib/appErrors';
import { isDevModeEnabled, getDevRoundStatus } from '../../src/lib/devGameState';
import { verifyPurchaseTransaction } from '../../src/lib/jackpot-contract';

/**
 * POST /api/purchase-guess-pack
 * Milestone 6.3, Updated Milestone 6.4, 7.1
 *
 * Process guess pack purchase with onchain verification and dynamic late-round pricing.
 *
 * Milestone 6.4 Flow:
 * 1. Frontend initiates wallet transaction via wagmi useWriteContract
 * 2. User signs transaction in their wallet
 * 3. Frontend waits for tx confirmation, then calls this API with txHash
 * 4. This API verifies the transaction onchain before awarding packs
 *
 * Body:
 * - fid: number - Farcaster ID
 * - packCount: number - Number of packs to purchase (1, 2, or 3)
 * - txHash: string - Onchain transaction hash to verify
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Extract request metadata for rate limiting
  const { fid: metadataFid, ip, userAgent } = extractRequestMetadata(req);
  const rateLimitFid = req.body?.fid || metadataFid;

  // Milestone 9.6: Conservative rate limiting (4 requests per 5 minutes)
  const rateCheck = await checkPurchaseRateLimit(rateLimitFid, ip, userAgent);
  if (!rateCheck.allowed) {
    res.setHeader('Retry-After', rateCheck.retryAfterSeconds?.toString() || '300');
    return res.status(429).json({
      ok: false,
      error: AppErrorCodes.RATE_LIMITED,
      message: 'Too many purchase requests — please wait a moment',
      retryAfterSeconds: rateCheck.retryAfterSeconds,
    });
  }

  try {
    const { fid, packCount, txHash } = req.body;

    // Milestone 9.5: Check operational guard (kill switch / dead day)
    const guardBlocked = await applyGameplayGuard(req, res);
    if (guardBlocked) return;

    // Validate inputs
    if (!fid || typeof fid !== 'number') {
      return res.status(400).json({ error: 'Invalid FID' });
    }

    if (!packCount || typeof packCount !== 'number' || packCount < 1 || packCount > 3) {
      return res.status(400).json({ error: 'Invalid pack count. Must be 1, 2, or 3.' });
    }

    // Milestone 6.4: Require onchain transaction hash
    if (!txHash || typeof txHash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
      return res.status(400).json({ error: 'Invalid transaction hash. Must provide valid onchain txHash.' });
    }

    // Check if txHash has already been used (prevent double-claiming)
    const existingPurchase = await db
      .select({ id: packPurchases.id })
      .from(packPurchases)
      .where(eq(packPurchases.txHash, txHash))
      .limit(1);

    if (existingPurchase.length > 0) {
      console.warn(`[purchase-guess-pack] Duplicate txHash attempt: ${txHash} (FID ${fid})`);
      return res.status(400).json({ error: 'Transaction already used for a purchase.' });
    }

    // Get current daily state
    const dateStr = getTodayUTC();
    const currentState = await getOrCreateDailyState(fid, dateStr);

    // Pack purchases are now UNCAPPED - no limit check needed
    // Volume-based pricing tiers apply (1×, 1.5×, 2×)
    const packsPurchasedToday = currentState.paidPacksPurchased;

    // Get active round and calculate dynamic pricing
    const activeRound = await getActiveRound();

    // Get total guesses in current round for dynamic pricing
    let totalGuessesInRound = 0;
    if (isDevModeEnabled()) {
      // In dev mode, use the same display guess count shown in TopTicker
      // This ensures pricing is consistent with what the user sees
      const devStatus = await getDevRoundStatus();
      totalGuessesInRound = devStatus.globalGuessCount;
    } else if (activeRound?.id) {
      const [result] = await db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(guesses)
        .where(eq(guesses.roundId, activeRound.id));
      totalGuessesInRound = result?.count || 0;
    }

    // Calculate expected cost based on current round state AND volume tier
    const expectedCostWei = getTotalPackCostWei(totalGuessesInRound, packCount, packsPurchasedToday);
    const expectedCostEth = weiToEthString(expectedCostWei);
    const pricingPhase = getPricingPhase(totalGuessesInRound);
    const volumeTier = getVolumeTier(packsPurchasedToday);
    const volumeMultiplier = getVolumeMultiplier(packsPurchasedToday);

    // Log analytics event - pack viewed (implicit in purchase flow)
    logAnalyticsEvent(AnalyticsEventTypes.GUESS_PACK_VIEWED, {
      userId: fid.toString(),
      roundId: activeRound?.id?.toString(),
      data: {
        pack_count: packCount,
        packs_already_purchased: packsPurchasedToday,
        pricing_phase: pricingPhase,
        volume_tier: volumeTier,
        volume_multiplier: volumeMultiplier,
        expected_cost_wei: expectedCostWei.toString(),
      },
    });

    // Milestone 6.4: Verify onchain transaction before awarding packs
    const totalGuesses = packCount * DAILY_LIMITS_RULES.paidGuessPackSize;
    const verification = await verifyPurchaseTransaction(txHash, undefined, totalGuesses);

    if (!verification.valid) {
      console.error(`[purchase-guess-pack] Onchain verification failed: ${verification.error}`, {
        txHash,
        fid,
        packCount,
        expectedQuantity: totalGuesses,
      });
      return res.status(400).json({
        error: `Transaction verification failed: ${verification.error}`,
      });
    }

    console.log(`[purchase-guess-pack] Onchain verification passed for txHash ${txHash}`, {
      player: verification.player,
      quantity: verification.quantity,
      ethAmount: verification.ethAmount,
      roundNumber: verification.roundNumber,
    });

    // Award packs one by one (for proper tracking)
    let updatedState = currentState;
    for (let i = 0; i < packCount; i++) {
      updatedState = await awardPaidPack(fid, dateStr);
    }

    // Log analytics event - packs purchased with pricing info
    logAnalyticsEvent(AnalyticsEventTypes.GUESS_PACK_PURCHASED, {
      userId: fid.toString(),
      roundId: activeRound?.id?.toString(),
      data: {
        pack_count: packCount,
        total_packs_today: updatedState.paidPacksPurchased,
        credits_added: packCount * DAILY_LIMITS_RULES.paidGuessPackSize,
        total_credits: updatedState.paidGuessCredits,
        pricing_phase: pricingPhase,
        volume_tier: volumeTier,
        volume_multiplier: volumeMultiplier,
        expected_cost_wei: expectedCostWei.toString(),
        expected_cost_eth: expectedCostEth,
        total_guesses_in_round: totalGuessesInRound,
        tx_hash: txHash, // Milestone 6.4
        verified_eth_amount: verification.ethAmount,
      },
    });

    // Milestone 6.4/9.5: Record purchase with txHash for verification and refund support
    if (activeRound?.id) {
      try {
        await db.insert(packPurchases).values({
          roundId: activeRound.id,
          fid,
          packCount,
          totalPriceEth: verification.ethAmount || expectedCostEth, // Use actual from tx
          totalPriceWei: expectedCostWei.toString(),
          pricingPhase,
          totalGuessesAtPurchase: totalGuessesInRound,
          txHash, // Milestone 6.4: Store verified txHash
        });
      } catch (purchaseLogError) {
        // Don't fail the request if purchase logging fails
        console.error('[purchase-guess-pack] Failed to log purchase for refund tracking:', purchaseLogError);
        Sentry.captureException(purchaseLogError, {
          tags: { endpoint: 'purchase-guess-pack', phase: 'refund-tracking' },
          extra: { fid, packCount, roundId: activeRound.id, txHash },
        });
      }
    }

    // Milestone 6.7: Award PACK_PURCHASE XP (+20 XP per pack, fire-and-forget)
    for (let i = 0; i < packCount; i++) {
      logXpEvent(fid, 'PACK_PURCHASE', {
        roundId: activeRound?.id,
        metadata: {
          pack_number: currentState.paidPacksPurchased + i + 1,
          total_packs_today: updatedState.paidPacksPurchased,
        },
      });
    }

    // Milestone 9.0: Invalidate round state cache (prize pool changed)
    // Milestone 9.2: Also invalidate user caches
    if (activeRound?.id) {
      console.log(`[Cache] Invalidating caches after pack purchase for round ${activeRound.id}`);
      Promise.all([
        invalidateRoundStateCache(activeRound.id),
        invalidateUserCaches(fid, activeRound.id),
      ]).catch((err) => {
        console.error('[Cache] Failed to invalidate after pack purchase:', err);
      });
    }

    // Volume tier info for after this purchase
    const newVolumeTier = getVolumeTier(updatedState.paidPacksPurchased);
    const newVolumeMultiplier = getVolumeMultiplier(updatedState.paidPacksPurchased);
    const packsRemainingAtTier = getPacksRemainingAtCurrentTier(updatedState.paidPacksPurchased);
    const nextTierMult = getNextTierMultiplier(updatedState.paidPacksPurchased);

    console.log(
      `[purchase-guess-pack] FID ${fid} purchased ${packCount} pack(s) @ ${verification.ethAmount || expectedCostEth} ETH (${pricingPhase}, ${volumeTier} ${volumeMultiplier}×). ` +
      `Total today: ${updatedState.paidPacksPurchased} (unlimited). ` +
      `Credits: ${updatedState.paidGuessCredits}. ` +
      `Next tier: ${newVolumeTier} (${newVolumeMultiplier}×). ` +
      `TxHash: ${txHash}`
    );

    return res.status(200).json({
      ok: true,
      packsPurchased: packCount,
      totalPacksToday: updatedState.paidPacksPurchased,
      paidGuessCredits: updatedState.paidGuessCredits,
      // Milestone 7.1: Include pricing info in response
      expectedCostWei: expectedCostWei.toString(),
      expectedCostEth,
      pricingPhase,
      // Volume tier info (unlimited packs with tiered pricing)
      volumeTier: newVolumeTier,
      volumeMultiplier: newVolumeMultiplier,
      packsRemainingAtCurrentTier: packsRemainingAtTier,
      nextTierMultiplier: nextTierMult,
      paidGuessesExpireAt: getNextResetTime(),
      // Milestone 6.4: Include verified transaction info
      txHash,
      verifiedEthAmount: verification.ethAmount,
    });
  } catch (error) {
    console.error('[purchase-guess-pack] Error:', error);

    // Milestone 9.2: Report to Sentry with context
    Sentry.captureException(error, {
      tags: { endpoint: 'purchase-guess-pack' },
      extra: {
        fid: req.body?.fid,
        packCount: req.body?.packCount,
        txHash: req.body?.txHash,
      },
    });

    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to purchase pack',
    });
  }
}

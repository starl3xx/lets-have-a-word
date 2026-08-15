import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
import { awardPaidPack, getOrCreateDailyState, getTodayUTC, DAILY_LIMITS_RULES } from '../../src/lib/daily-limits';
import { creditWordPool } from '../../src/lib/word-pool-credits';
import { logAnalyticsEvent, AnalyticsEventTypes } from '../../src/lib/analytics';
import { getActiveRound } from '../../src/lib/rounds';
import { logXpEvent } from '../../src/lib/xp';
import { db } from '../../src/db';
import { guesses, packPurchases, users } from '../../src/db/schema';
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
import {
  isWordEconomyConfigured,
  verifyPackPurchaseTransaction,
  getWordJackpotConfig,
} from '../../src/lib/word-jackpot-contract';

/**
 * Minimum share of the quoted price a purchase must actually pay, in bps.
 *
 * 40% clears the widest legitimate quote-vs-confirm gap: a pricing-tier step
 * (0.0004 -> 0.0006 ETH) combined with a volume-multiplier step (1x -> 1.5x)
 * leaves an honest payment at ~44% of the recomputed quote. It still rejects
 * the underpayment case by eleven orders of magnitude.
 */
const MIN_PAYMENT_BPS = 4000n;

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

    // Two rails. From round 34 packs are bought through WordPackSales, whose
    // PacksPurchased event records the payer as msg.sender. JackpotManagerV3
    // remains the rail for anything bought before the cutover, and is still
    // tried as a fallback so a transaction confirmed moments before the switch
    // can still be claimed.
    let verification: {
      valid: boolean;
      error?: string;
      weiAmount?: string;
      payer?: string;
      rail: 'word_pack_sales' | 'jackpot_manager';
      salesContractAddress?: string;
      /** Which PacksPurchased event was credited; null on the legacy rail. */
      logIndex?: number;
    };

    if (isWordEconomyConfigured()) {
      // A transaction can hold several purchases once gas sponsorship is on: an
      // ERC-4337 bundler batches user operations from different accounts into
      // one transaction, so two players who buy at the same moment share a
      // hash. Two things keep them apart.
      //
      // The caller's own wallet identifies which event is theirs, and the log
      // indexes already credited for this hash are excluded so a bundle is
      // drawn down one event at a time rather than consumed whole by whoever
      // posts first. Without this the second player was refused as a duplicate
      // after paying, and the amount checked below could have been someone
      // else's.
      const [buyer] = await db
        .select({ wallet: users.signerWalletAddress })
        .from(users)
        .where(eq(users.fid, fid))
        .limit(1);

      const alreadyCredited = await db
        .select({ logIndex: packPurchases.logIndex })
        .from(packPurchases)
        .where(eq(packPurchases.txHash, txHash));

      const claimedIndexes = alreadyCredited
        .map((r) => r.logIndex)
        .filter((i): i is number => i !== null);

      // A legacy row has a NULL log index and stands for the whole
      // transaction, so treat the hash as fully spent rather than letting a
      // real index slip past the composite unique constraint.
      if (alreadyCredited.some((r) => r.logIndex === null)) {
        return res.status(400).json({
          error: 'This transaction has already been credited',
          code: AppErrorCodes.PURCHASE_FAILED,
        });
      }

      const packSales = await verifyPackPurchaseTransaction(
        txHash,
        buyer?.wallet ?? undefined,
        undefined,
        claimedIndexes
      );
      if (packSales.valid) {
        verification = {
          ...packSales,
          rail: 'word_pack_sales',
          salesContractAddress: getWordJackpotConfig().wordPackSalesAddress,
        };
      } else {
        const legacy = await verifyPurchaseTransaction(txHash, undefined, totalGuesses);
        verification = legacy.valid
          ? { ...legacy, payer: legacy.player, rail: 'jackpot_manager' }
          : {
              valid: false,
              // Report the WordPackSales failure: it is the rail the client
              // should have used, so its error is the actionable one.
              error: packSales.error,
              rail: 'word_pack_sales',
            };
      }
    } else {
      const legacy = await verifyPurchaseTransaction(txHash, undefined, totalGuesses);
      verification = { ...legacy, payer: legacy.player, rail: 'jackpot_manager' };
    }

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

    // NOTE: there is still deliberately no payer check here, but the reasoning
    // has changed and is worth restating, because two of the three obstacles
    // are now gone.
    //
    // FIXED (#157): the onchain half. JackpotManagerV3.purchaseGuesses takes
    // `player` as an argument, so its event recorded whatever the caller passed.
    // WordPackSales derives the payer from msg.sender, so on that rail
    // `verification.payer` is not forgeable.
    //
    // FIXED (#152): the database half, almost. `users.signerWalletAddress` used
    // to be written straight from `req.query.walletAddress`. It now only accepts
    // a wallet Neynar confirms belongs to that FID — the insert path falls back
    // to primary/signer/custody otherwise (`user-state.ts:199-219`) and the
    // update path refuses outright (`:270`).
    //
    // STILL OPEN: that verification has one gap. When Neynar has no record of an
    // FID at all, the insert path accepts the client-supplied wallet
    // (`user-state.ts:218`). So an attacker holding a Neynar-unknown FID can
    // still plant a victim's address and race them to claim their txHash.
    // `pack_purchases.tx_hash` is unique, so it is a front-run rather than a
    // duplicate credit — but enforcing a binding on top of that gap would reject
    // honest buyers without closing it.
    //
    // Closing it properly needs an authenticated caller, the way
    // `pages/api/guess.ts:274` verifies a Farcaster QuickAuth JWT. Tracked
    // separately; it is a coordinated client and server change.
    //
    // In the meantime the payer IS recorded below, so a disputed purchase can be
    // reconciled against who actually paid. The amount check remains the defence
    // that does the work.

    // The contract accepts any non-zero msg.value and treats `quantity` as a
    // caller-supplied label, so price is enforced here or nowhere. Without this
    // a 1-wei transaction claiming quantity=3 buys a full pack.
    //
    // The floor is deliberately below the quoted price rather than exact: the
    // quote is recomputed at request time, so a round crossing a pricing tier
    // (or a concurrent purchase moving the volume multiplier) between signing
    // and confirming can make an honest payment look short. Rejecting then
    // would take the user's ETH and give nothing back. Anything under the floor
    // is not a tier race, and any shortfall at all is reported.
    const paidWei = BigInt(verification.weiAmount ?? '0');
    const minAcceptableWei = (expectedCostWei * MIN_PAYMENT_BPS) / 10000n;

    if (paidWei < minAcceptableWei) {
      console.error(`[purchase-guess-pack] Underpayment rejected`, {
        txHash, fid, packCount,
        paidWei: paidWei.toString(),
        expectedCostWei: expectedCostWei.toString(),
        minAcceptableWei: minAcceptableWei.toString(),
      });
      Sentry.captureMessage('[purchase-guess-pack] Underpayment rejected', {
        level: 'error',
        extra: { fid, txHash, paidWei: paidWei.toString(), expectedCostWei: expectedCostWei.toString() },
      });
      return res.status(400).json({
        error: 'Payment below the quoted pack price',
        code: AppErrorCodes.PURCHASE_FAILED,
      });
    }

    if (paidWei < expectedCostWei) {
      console.warn(`[purchase-guess-pack] Accepted short payment within tier-race tolerance`, {
        txHash, fid,
        paidWei: paidWei.toString(),
        expectedCostWei: expectedCostWei.toString(),
      });
      Sentry.captureMessage('[purchase-guess-pack] Short payment accepted within tolerance', {
        level: 'warning',
        extra: { fid, txHash, paidWei: paidWei.toString(), expectedCostWei: expectedCostWei.toString() },
      });
    }

    console.log(`[purchase-guess-pack] Onchain verification passed for txHash ${txHash}`, {
      payer: verification.payer,
      rail: verification.rail,
      weiAmount: verification.weiAmount,
    });

    // Award packs one by one (for proper tracking)
    // Pass roundId so volume tier resets when a new round starts
    let updatedState = currentState;
    for (let i = 0; i < packCount; i++) {
      updatedState = await awardPaidPack(fid, dateStr, activeRound?.id);
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
        verified_wei_amount: verification.weiAmount,
        rail: verification.rail,
      },
    });

    // Milestone 6.4/9.5: Record purchase with txHash for verification and refund support
    if (activeRound?.id) {
      try {
        await db.insert(packPurchases).values({
          roundId: activeRound.id,
          fid,
          packCount,
          totalPriceEth: weiToEthString(paidWei) || expectedCostEth, // Use actual from tx
          salesContractAddress: verification.salesContractAddress ?? null,
          totalPriceWei: expectedCostWei.toString(),
          pricingPhase,
          totalGuessesAtPurchase: totalGuessesInRound,
          txHash, // Milestone 6.4: Store verified txHash
          // Which event in that transaction this row credits. Null on the
          // legacy rail, where a transaction only ever carries one purchase.
          logIndex: verification.logIndex ?? null,
        });
        // Credit 80% of this purchase to the prize pool in $WORD, at the price
        // in force right now. No-ops on an ETH round, where the pool is the
        // contract's own balance and grows onchain.
        //
        // After the guesses have been granted, deliberately. The player has
        // paid and been served by this point, so a stale oracle here is the
        // house's problem — creditWordPool never throws and never rejects, and
        // an uncredited purchase is visible as a pack_purchases row with no
        // matching ledger entry.
        await creditWordPool({
          roundId: activeRound.id,
          source: 'pack',
          sourceRef: `${txHash}:${verification.logIndex ?? 'legacy'}`,
          ethAmountWei: paidWei,
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
      `[purchase-guess-pack] FID ${fid} purchased ${packCount} pack(s) @ ${weiToEthString(paidWei) || expectedCostEth} ETH (${pricingPhase}, ${volumeTier} ${volumeMultiplier}×). ` +
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
      verifiedEthAmount: weiToEthString(paidWei),
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

/**
 * Superguess Purchase API
 * Milestone 15: Handles $WORD token payment and session creation
 *
 * POST /api/superguess/purchase
 * Body: { txHash: string, devFid?: number, signerUuid?: string, frameMessage?: string }
 *
 * Flow:
 * 1. Auth (same pattern as guess.ts)
 * 2. Verify feature enabled, round active, globalGuessCount >= 850
 * 3. Verify no active session or cooldown
 * 4. Determine tier from remaining word pool size
 * 5. Verify onchain txHash (user transferred $WORD to operator wallet)
 * 6. Start session
 * 7. Award SHOWSTOPPER wordmark
 * 8. Return session data
 *
 * NOTE: In dev mode, txHash verification is skipped.
 * Server-side burn/staking split is handled separately (post-purchase).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
import { verifyFrameMessage } from '../../../src/lib/farcaster';
import { isDevModeEnabled, getDevUserId } from '../../../src/lib/devGameState';
import {
  isSuperguessFeatureEnabled,
  getActiveSuperguess,
  isCooldownActive,
  getSuperguessCurrentTier,
  startSuperguessSession,
  hasUsedSuperguessThisRound,
  SUPERGUESS_MIN_GUESS_COUNT,
} from '../../../src/lib/superguess';
import { getActiveRound } from '../../../src/lib/rounds';
import { getTotalGuessCountInRound } from '../../../src/lib/guesses';
import { getGuessWords } from '../../../src/lib/word-lists';
import { awardWordmark } from '../../../src/lib/wordmarks';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 1. Auth
    let fid: number | null = null;

    if (req.body.devFid && isDevModeEnabled()) {
      fid = parseInt(req.body.devFid as string, 10);
    } else if (req.body.signerUuid) {
      // Quick auth via signer UUID (Mini App SDK)
      const { verifySigner } = await import('../../../src/lib/farcaster');
      const signerData = await verifySigner(req.body.signerUuid);
      if (signerData) fid = signerData.fid;
    } else if (req.body.frameMessage) {
      const frameData = await verifyFrameMessage(req.body.frameMessage);
      if (frameData) fid = frameData.fid;
    }

    if (!fid) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // 2. Feature check
    if (!isSuperguessFeatureEnabled()) {
      return res.status(400).json({ error: 'Superguess is not enabled' });
    }

    // 3. Round + threshold check
    const activeRound = await getActiveRound();
    if (!activeRound) {
      return res.status(400).json({ error: 'No active round' });
    }

    const globalGuessCount = await getTotalGuessCountInRound(activeRound.id);
    if (globalGuessCount < SUPERGUESS_MIN_GUESS_COUNT) {
      return res.status(400).json({
        error: `Superguess not available until ${SUPERGUESS_MIN_GUESS_COUNT} guesses`,
        globalGuessCount,
      });
    }

    // 4. No active session or cooldown
    const existingSession = await getActiveSuperguess(activeRound.id);
    if (existingSession) {
      return res.status(409).json({ error: 'A Superguess session is already active' });
    }

    const cooldown = await isCooldownActive(activeRound.id);
    if (cooldown.active) {
      return res.status(400).json({
        error: 'Superguess cooldown is active',
        cooldownEndsAt: cooldown.endsAt,
      });
    }

    // 5. Determine tier
    const totalDictionaryWords = getGuessWords().length;
    const tier = getSuperguessCurrentTier(globalGuessCount, totalDictionaryWords);
    if (!tier) {
      return res.status(400).json({ error: 'Could not determine pricing tier' });
    }

    // 6. Verify txHash (skip in dev mode)
    const { txHash } = req.body;
    const isDevMode = isDevModeEnabled();

    if (!isDevMode && !txHash) {
      return res.status(400).json({ error: 'txHash is required' });
    }

    // 6b. Calculate token amount from tier price and $WORD market price
    let wordAmountPaid = '0';
    let burnedAmount = '0';
    let stakingAmount = '0';

    if (!isDevMode) {
      try {
        const { fetchWordTokenMarketCap } = await import('../../../src/lib/word-oracle');
        const marketData = await fetchWordTokenMarketCap();
        if (marketData && marketData.priceUsd > 0) {
          const { ethers } = await import('ethers');
          const tokensNeeded = tier.usdPrice / marketData.priceUsd;
          const tokensWei = ethers.parseUnits(Math.floor(tokensNeeded).toString(), 18);
          wordAmountPaid = tokensWei.toString();
          // 50/50 split
          const halfWei = tokensWei / 2n;
          burnedAmount = halfWei.toString();
          stakingAmount = (tokensWei - halfWei).toString();
        }
      } catch (err) {
        console.warn('[superguess/purchase] Failed to calculate token amounts:', err);
      }
    }

    // 7. Start session (before burn/staking so the session exists even if onchain fails)
    let session;
    try {
      session = await startSuperguessSession({
        roundId: activeRound.id,
        fid,
        tier: tier.id,
        wordAmountPaid,
        usdEquivalent: tier.usdPrice,
        burnedAmount,
        stakingAmount,
        burnTxHash: txHash || undefined,
      });
    } catch (error: any) {
      // Handle race condition (another session started between our check and insert)
      if (error.code === '23505') {
        return res.status(409).json({
          error: 'Another Superguess session was just started',
        });
      }
      throw error;
    }

    // 8. Execute 50% burn + 50% staking rewards (non-blocking, session already active)
    if (!isDevMode && burnedAmount !== '0') {
      (async () => {
        try {
          const { burnWordOnChain, notifyRewardAmountOnChain } = await import('../../../src/lib/word-manager');
          const { db } = await import('../../../src/db');
          const { superguessSessions, wordRewards } = await import('../../../src/db/schema');
          const { eq } = await import('drizzle-orm');

          // Burn 50% using the contract's burn() mechanic
          const burnTxHash = await burnWordOnChain(activeRound.id, fid, burnedAmount);
          console.log(`🔴 [Superguess] Burned ${burnedAmount} $WORD: ${burnTxHash}`);

          // Send 50% to staking rewards via notifyRewardAmount
          // (tokens must already be in the WordManager contract)
          const stakingTxHash = await notifyRewardAmountOnChain(stakingAmount);
          console.log(`🔴 [Superguess] Staking rewards notified ${stakingAmount} $WORD: ${stakingTxHash}`);

          // Update session with tx hashes
          await db
            .update(superguessSessions)
            .set({
              burnTxHash: burnTxHash || undefined,
              stakingTxHash: stakingTxHash || undefined,
            })
            .where(eq(superguessSessions.id, session.id));

          // Record burn in word_rewards audit trail
          await db.insert(wordRewards).values({
            roundId: activeRound.id,
            fid: null, // Burn — tokens destroyed, not awarded
            rewardType: 'burn',
            amount: burnedAmount,
            txHash: burnTxHash || undefined,
          });

          // Record staking contribution in audit trail
          await db.insert(wordRewards).values({
            roundId: activeRound.id,
            fid: null,
            rewardType: 'staking',
            amount: stakingAmount,
            txHash: stakingTxHash || undefined,
          });
        } catch (err) {
          console.error('[superguess/purchase] Burn/staking failed (session still active):', err);
          // Session continues — burn/staking can be retried manually
        }
      })();
    }

    // 9. Award SHOWSTOPPER wordmark (on purchase, not win)
    awardWordmark(fid, 'SHOWSTOPPER', {
      roundId: activeRound.id,
      tier: tier.id,
      usdPrice: tier.usdPrice,
    }).catch((err) => {
      console.error('[superguess/purchase] Failed to award SHOWSTOPPER:', err);
    });

    // 10. Fire notifications (non-blocking)
    (async () => {
      try {
        const { announceSuperguessStarted } = await import('../../../src/lib/announcer');
        const { notifySuperguessStarted } = await import('../../../src/lib/notifications');
        const { getSuperguessUsername } = await import('../../../src/lib/superguess');
        const username = await getSuperguessUsername(fid);
        await Promise.all([
          announceSuperguessStarted(activeRound.id, fid),
          notifySuperguessStarted(username),
        ]);
      } catch (err) {
        console.error('[superguess/purchase] Announcer/notification failed:', err);
      }
    })();

    console.log(
      `🔴 [Superguess] Purchase complete: FID ${fid}, round ${activeRound.id}, tier ${tier.id}, $${tier.usdPrice}`
    );

    return res.status(200).json({
      success: true,
      session: {
        id: session.id,
        roundId: session.roundId,
        fid: session.fid,
        tier: session.tier,
        guessesAllowed: session.guessesAllowed,
        expiresAt: session.expiresAt.toISOString(),
        startedAt: session.startedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('[superguess/purchase] Error:', error);
    Sentry.captureException(error, {
      tags: { endpoint: 'superguess-purchase' },
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

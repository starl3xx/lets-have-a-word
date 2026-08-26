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
import { creditWordPool } from '../../../src/lib/word-pool-credits';
import { isDevModeEnabled, getDevUserId } from '../../../src/lib/devGameState';
import { resolveRequestFid } from '../../../src/lib/requestAuth';
import {
  isSuperguessFeatureEnabled,
  getActiveSuperguess,
  getSuperguessCurrentTier,
  startSuperguessSession,
  hasUsedSuperguessThisRound,
  SUPERGUESS_MIN_GUESS_COUNT,
} from '../../../src/lib/superguess';
import { getActiveRound } from '../../../src/lib/rounds';
import { getTotalGuessCountInRound } from '../../../src/lib/guesses';
import { getGuessWords } from '../../../src/lib/word-lists';
import { awardWordmark } from '../../../src/lib/wordmarks';
import { db } from '../../../src/db';
import { users, superguessSessions } from '../../../src/db/schema';
import { eq } from 'drizzle-orm';
import { getEthUsdPrice } from '../../../src/lib/prices';
import {
  verifySuperguessPurchaseTransaction,
  isWordEconomyConfigured,
} from '../../../src/lib/word-jackpot-contract';

/**
 * Floor for an accepted Superguess payment, in basis points of the quoted
 * price. Same reasoning as guess packs: the ETH quote is recomputed at request
 * time, so a price move between signing and confirming can make an honest
 * payment look short, and rejecting then would take the player's ETH and give
 * nothing back. Anything under this is not a price move.
 */
const SUPERGUESS_MIN_PAYMENT_BPS = 9000n;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 1. Auth
    //
    // Dev mode, Quick Auth and the wallet-native player session come from
    // resolveRequestFid; signer and frame verification stay here, because they
    // call Neynar and only this endpoint and guess.ts use them.
    //
    // The response contract is deliberately unchanged. This endpoint has always
    // answered a bad token with a bare 401 "Authentication required" — the old
    // code swallowed the verifier's error and fell through to the `!fid` check —
    // so the resolver's more specific message is logged rather than returned.
    // Sharpening a client-visible error is a separate decision from moving the
    // code that produces it.
    let fid: number | null = null;

    const auth = await resolveRequestFid(req, {});
    if (auth.ok) {
      fid = auth.fid;
    } else if (auth.reason === 'invalid_credential') {
      // A token was presented and was bad. The old else-if chain never reached
      // signer/frame in that case either, so this does not fall through.
      console.error(`[superguess/purchase] Credential rejected: ${auth.error}`);
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!fid) {
      if (req.body.signerUuid) {
        // Signer UUID (Mini App SDK fallback)
        const { verifySigner } = await import('../../../src/lib/farcaster');
        const signerData = await verifySigner(req.body.signerUuid);
        if (signerData) fid = signerData.fid;
      } else if (req.body.frameMessage) {
        const frameData = await verifyFrameMessage(req.body.frameMessage);
        if (frameData) fid = frameData.fid;
      }
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

    // 4. No active session, no cooldown, not already used this round
    const existingSession = await getActiveSuperguess(activeRound.id);
    if (existingSession) {
      return res.status(409).json({ error: 'A Superguess session is already active' });
    }

    // One Superguess per round total (any player)
    const anyoneUsed = await hasUsedSuperguessThisRound(activeRound.id);
    if (anyoneUsed) {
      return res.status(400).json({ error: 'Superguess has already been used this round' });
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

    // 6b. Verify the ETH payment (production only)
    //
    // WHAT THIS REPLACES. The old check scanned the receipt for ANY $WORD
    // transfer to the operator wallet of at least 80% of the tier price. It
    // never checked who sent it, and never recorded which payment bought which
    // session — so a historical transfer read off Base, which is public data,
    // could be replayed for a free 25-guess session. The endpoint then spent
    // real operator funds in response, burning $WORD and moving more to
    // staking against a payment that had never been made.
    //
    // Now the payment is our own SuperguessPurchased event: emitted by
    // WordPackSales, payer taken from msg.sender, and claimed once via a
    // unique (tx_hash, log_index).
    //
    // CURRENCY. Superguess is paid in ETH. Players earn $WORD by playing and
    // spend ETH to buy, so a first-time player does not have to acquire the
    // reward token before they can use it — and holders are not pushed to sell
    // the thing staking exists to encourage them to keep.
    let ethAmountPaid = '0';
    let paymentLogIndex: number | null = null;

    if (!isDevMode) {
      if (!isWordEconomyConfigured()) {
        return res.status(503).json({ error: 'Superguess purchases are not available yet' });
      }

      const [buyer] = await db
        .select({ wallet: users.signerWalletAddress })
        .from(users)
        .where(eq(users.fid, fid))
        .limit(1);

      const alreadyClaimed = await db
        .select({ logIndex: superguessSessions.logIndex })
        .from(superguessSessions)
        .where(eq(superguessSessions.txHash, txHash));

      const claimedIndexes = alreadyClaimed
        .map((r) => r.logIndex)
        .filter((i): i is number => i !== null);

      const verification = await verifySuperguessPurchaseTransaction(
        txHash,
        buyer?.wallet ?? undefined,
        claimedIndexes
      );

      if (!verification.valid) {
        console.error(`[superguess/purchase] Payment verification failed: ${verification.error}`);
        return res.status(400).json({ error: `Payment verification failed: ${verification.error}` });
      }

      // Price the tier in ETH at the current rate. A floor rather than an exact
      // match, for the same reason pack purchases use one: the quote is
      // recomputed at request time, so an ETH move between signing and
      // confirming can make an honest payment look short. Rejecting then would
      // take the player's ETH and give nothing back.
      const ethUsd = await getEthUsdPrice();
      if (!ethUsd) {
        return res.status(503).json({ error: 'Could not price the purchase — try again shortly' });
      }

      const expectedWei = BigInt(Math.floor((tier.usdPrice / ethUsd) * 1e18));
      const floorWei = (expectedWei * BigInt(SUPERGUESS_MIN_PAYMENT_BPS)) / 10000n;
      const paidWei = BigInt(verification.weiAmount ?? '0');

      if (paidWei < floorWei) {
        console.error('[superguess/purchase] Underpayment rejected', {
          fid,
          txHash,
          paidWei: paidWei.toString(),
          expectedWei: expectedWei.toString(),
        });
        return res.status(400).json({ error: 'Payment below the quoted Superguess price' });
      }

      ethAmountPaid = paidWei.toString();
      paymentLogIndex = verification.logIndex ?? null;

      console.log(
        `🔴 [Superguess] Verified ${ethAmountPaid} wei from ${verification.payer} (tier ${tier.id}, $${tier.usdPrice})`
      );
    }

    // 7. Start session (before burn/staking so the session exists even if onchain fails)
    let session;
    try {
      session = await startSuperguessSession({
        roundId: activeRound.id,
        fid,
        tier: tier.id,
        currency: 'eth',
        ethAmountPaid,
        usdEquivalent: tier.usdPrice,
        txHash: isDevMode ? null : txHash,
        logIndex: paymentLogIndex,
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

    // Credit 80% of the payment to the prize pool in $WORD, on the same terms
    // as a guess pack. No-ops on an ETH round.
    //
    // Runs after the session exists, so a credit failure can never cost a
    // player the Superguess they just paid for. creditWordPool neither throws
    // nor rejects, and keys on (source, txHash:logIndex), so the retry a client
    // makes after a timeout credits the pool exactly once.
    if (!isDevMode && ethAmountPaid !== '0') {
      await creditWordPool({
        roundId: activeRound.id,
        source: 'superguess',
        sourceRef: `${txHash}:${paymentLogIndex ?? 'legacy'}`,
        ethAmountWei: BigInt(ethAmountPaid),
      });
    }

    // The 50% burn / 50% staking split that used to run here is gone with the
    // currency it operated on: there is no $WORD arriving to split.
    //
    // That removes a per-purchase deflationary sink, which is an economic
    // change and not merely a refactor. ETH now accumulates in WordPackSales
    // alongside pack revenue and is withdrawn to the treasury. If the buy-and-
    // burn effect is wanted, it becomes a batched treasury operation —
    // converting ETH and burning — rather than something that happens inline
    // on a player's request. That is a decision to make deliberately rather
    // than inherit from how the old flow happened to be wired.

    // 9. Award SHOWSTOPPER wordmark (on purchase, not win)
    await awardWordmark(fid, 'SHOWSTOPPER', {
      roundId: activeRound.id,
      tier: tier.id,
      usdPrice: tier.usdPrice,
    }).catch((err) => {
      console.error('[superguess/purchase] Failed to award SHOWSTOPPER:', err);
    });

    // 10. Fire notifications (awaited — Vercel serverless terminates after response)
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

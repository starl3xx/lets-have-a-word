/**
 * Share Callback API
 * Milestone 4.2, Updated Milestone 9.6
 *
 * Handles share bonus verification and award after successful Farcaster cast.
 *
 * Milestone 9.6: Now actually verifies the cast exists on Farcaster
 * before awarding the bonus. This prevents gaming by just opening
 * the composer without actually posting.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
import { awardShareBonus, getOrCreateDailyState, getFreeGuessesRemaining } from '../../src/lib/daily-limits';
import { logAnalyticsEvent, AnalyticsEventTypes } from '../../src/lib/analytics';
import { applyGameplayGuard } from '../../src/lib/operational-guard';
import {
  checkShareRateLimit,
  logShareReplay,
  extractRequestMetadata,
} from '../../src/lib/rateLimit';
import { AppErrorCodes } from '../../src/lib/appErrors';
import { verifyRecentShareCast } from '../../src/lib/farcaster';

export interface ShareCallbackResponse {
  ok: boolean;
  newFreeGuessesRemaining?: number;
  message?: string;
  verified?: boolean;
  castHash?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ShareCallbackResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, message: 'Method not allowed' });
  }

  // Extract request metadata for rate limiting
  const { fid: metadataFid, ip, userAgent } = extractRequestMetadata(req);
  const rateLimitFid = req.body?.fid || metadataFid;

  // Milestone 9.6: Rate limiting (6 requests per 60 seconds)
  const rateCheck = await checkShareRateLimit(rateLimitFid, ip, userAgent);
  if (!rateCheck.allowed) {
    res.setHeader('Retry-After', rateCheck.retryAfterSeconds?.toString() || '60');
    return res.status(429).json({
      ok: false,
      error: AppErrorCodes.RATE_LIMITED,
      message: 'Too many share requests — try again in a moment',
      retryAfterSeconds: rateCheck.retryAfterSeconds,
    } as any);
  }

  // Milestone 9.5: Check operational guard (kill switch / dead day)
  const guardBlocked = await applyGameplayGuard(req, res);
  if (guardBlocked) return;

  console.log('[share-callback] API called with body:', req.body);

  try {
    const { fid } = req.body;

    // Validate inputs
    if (!fid || typeof fid !== 'number') {
      return res.status(400).json({ ok: false, message: 'Invalid FID' });
    }

    // Check if user already has the bonus today (early return for idempotency)
    const existingState = await getOrCreateDailyState(fid);
    if (existingState.hasSharedToday) {
      console.log(`[share-callback] FID ${fid} already claimed share bonus today (replay)`);
      logShareReplay(fid);
      return res.status(200).json({
        ok: true,
        message: 'Share bonus already claimed today',
      });
    }

    // Milestone 9.6: Actually verify the cast exists on Farcaster
    // Look for a cast mentioning letshaveaword.fun in the last 10 minutes
    console.log(`[share-callback] Verifying cast for FID ${fid}...`);
    const verifiedCast = await verifyRecentShareCast(fid, 'letshaveaword.fun', 10);

    if (!verifiedCast) {
      // Cast not found - could be timing issue or user didn't actually post
      console.log(`[share-callback] No verified cast found for FID ${fid}`);
      return res.status(200).json({
        ok: false,
        verified: false,
        message: "Cast not found yet. Make sure you posted and try again in a moment.",
      });
    }

    console.log(`[share-callback] Verified cast ${verifiedCast.castHash} for FID ${fid}`);

    // Award share bonus now that we've verified the cast
    const updated = await awardShareBonus(fid);

    if (!updated) {
      // Race condition: another request already awarded the bonus
      console.log(`[share-callback] FID ${fid} already claimed (race condition)`);
      return res.status(200).json({
        ok: true,
        message: 'Share bonus already claimed today',
      });
    }

    // Get updated state to return new free guesses count
    const dailyState = await getOrCreateDailyState(fid);
    const newFreeGuessesRemaining = getFreeGuessesRemaining(dailyState);

    console.log(`[share-callback] Share bonus awarded to FID ${fid}. New free guesses: ${newFreeGuessesRemaining}`);

    // Milestone 5.3: Log SHARE_SUCCESS event with verified cast hash
    logAnalyticsEvent(AnalyticsEventTypes.SHARE_SUCCESS, {
      userId: fid.toString(),
      data: {
        castHash: verifiedCast.castHash,
        bonusAwarded: true,
        newFreeGuessesRemaining,
        verified: true,
      },
    });

    return res.status(200).json({
      ok: true,
      verified: true,
      castHash: verifiedCast.castHash,
      newFreeGuessesRemaining,
      message: 'Share bonus awarded! You earned +1 free guess.',
    });
  } catch (error) {
    console.error('[share-callback] Error processing share bonus:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[share-callback] Error details:', errorMessage);

    // Report to Sentry with context
    Sentry.captureException(error, {
      tags: { endpoint: 'share-callback' },
      extra: {
        fid: req.body?.fid,
        castHash: req.body?.castHash,
      },
    });

    return res.status(500).json({
      ok: false,
      message: 'Failed to process share bonus',
    });
  }
}

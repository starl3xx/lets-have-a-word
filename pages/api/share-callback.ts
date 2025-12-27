/**
 * Share Callback API
 * Milestone 4.2
 *
 * Handles share bonus verification and award after successful Farcaster cast
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

export interface ShareCallbackResponse {
  ok: boolean;
  newFreeGuessesRemaining?: number;
  message?: string;
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
    const { fid, castHash } = req.body;

    // Validate inputs
    if (!fid || typeof fid !== 'number') {
      return res.status(400).json({ ok: false, message: 'Invalid FID' });
    }

    if (!castHash || typeof castHash !== 'string') {
      return res.status(400).json({ ok: false, message: 'Invalid cast hash' });
    }

    console.log(`[share-callback] Processing share bonus for FID ${fid}, cast ${castHash}`);

    // Award share bonus
    const updated = await awardShareBonus(fid);

    if (!updated) {
      // User already claimed share bonus today - this is idempotent, not an error
      // Log replay for visibility but return success (non-punitive)
      console.log(`[share-callback] FID ${fid} already claimed share bonus today (replay)`);
      logShareReplay(fid);

      // Return ok: true with a calm message - replays are not errors
      return res.status(200).json({
        ok: true,
        message: 'Share bonus already claimed today',
      });
    }

    // Get updated state to return new free guesses count
    const dailyState = await getOrCreateDailyState(fid);
    const newFreeGuessesRemaining = getFreeGuessesRemaining(dailyState);

    console.log(`[share-callback] Share bonus awarded to FID ${fid}. New free guesses: ${newFreeGuessesRemaining}`);

    // Milestone 5.3: Log SHARE_SUCCESS event with cast hash (non-blocking)
    logAnalyticsEvent(AnalyticsEventTypes.SHARE_SUCCESS, {
      userId: fid.toString(),
      data: {
        castHash,
        bonusAwarded: true,
        newFreeGuessesRemaining,
      },
    });

    return res.status(200).json({
      ok: true,
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

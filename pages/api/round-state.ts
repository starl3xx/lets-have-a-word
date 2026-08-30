import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
import { getRoundStatus } from '../../src/lib/wheel';
import type { RoundStatus } from '../../src/lib/wheel';
import { ensureDevMidRound } from '../../src/lib/devMidRound';
import { isDevModeEnabled, getDevRoundStatus } from '../../src/lib/devGameState';
import { getEthUsdPrice } from '../../src/lib/prices';
import { getTop10LockStatus } from '../../src/lib/top10-lock';
import {
  cacheAside,
  CacheKeys,
  CacheTTL,
  checkRateLimit,
  RateLimiters,
} from '../../src/lib/redis';
import { getActiveRoundId } from '../../src/lib/rounds';
import {
  isSuperguessFeatureEnabled,
  isSuperguessActive,
  hasUsedSuperguessThisRound,
  hasUsedSuperguessThisRoundCached,
  SUPERGUESS_MIN_GUESS_COUNT,
} from '../../src/lib/superguess';

/**
 * GET /api/round-state
 *
 * Returns the current active round's status for the top ticker
 * Milestone 2.3: Wheel + Visual State + Top Ticker
 * Milestone 4.12: ETH/USD conversion via CoinGecko (works in dev & prod)
 *
 * Response:
 * {
 *   "roundId": 1,
 *   "prizePoolEth": "0.5",
 *   "prizePoolUsd": "1500.00",  // Live from CoinGecko
 *   "globalGuessCount": 42,
 *   "lastUpdatedAt": "2025-01-15T12:00:00Z"
 * }
 *
 * Automatically creates a round if none exists.
 * In dev mode with NEXT_PUBLIC_TEST_MID_ROUND=true, creates a mid-round test scenario.
 * In dev mode with NEXT_PUBLIC_LHAW_DEV_MODE=true, uses actual dev round from database
 * so pack purchases dynamically affect the prize pool.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<RoundStatus | { error: string }>
) {
  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // The deploy this server is running, for the client's stale-runtime check
  // (src/lib/buildFreshness.ts). A HEADER, set before any branch, because it
  // must ride on the 204 no-active-round response too — deploys land between
  // rounds by design, which is exactly when the body has no room for it.
  res.setHeader('x-lhaw-server-build', process.env.VERCEL_GIT_COMMIT_SHA || 'dev');

  try {
    // Milestone 9.0: Rate limiting (by IP)
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0] ||
      req.socket.remoteAddress ||
      'unknown';
    const rateCheck = await checkRateLimit(RateLimiters.general, `round-state:${clientIp}`);
    if (!rateCheck.success) {
      res.setHeader('X-RateLimit-Limit', rateCheck.limit?.toString() || '60');
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', rateCheck.reset?.toString() || '');
      return res.status(429).json({ error: 'Too many requests' });
    }

    // Milestone 4.8: Check for dev mode first
    if (isDevModeEnabled()) {
      console.log('🎮 Dev mode: Returning dev round status with actual prize pool');

      // Get actual dev round from database (prize pool affected by pack purchases)
      const devStatus = await getDevRoundStatus();
      const prizePoolEthNum = parseFloat(devStatus.prizePoolEth);

      // Fetch live ETH/USD price even in dev mode (Milestone 4.12)
      const ethUsdRate = await getEthUsdPrice();
      const prizePoolUsd = ethUsdRate != null
        ? (prizePoolEthNum * ethUsdRate).toFixed(2)
        : (prizePoolEthNum * 3000).toFixed(2); // Fallback estimate

      // Get Top-10 lock status based on display guess count and round ID
      const top10Status = getTop10LockStatus(devStatus.globalGuessCount, devStatus.roundId);

      // Milestone 15: Superguess eligibility in dev mode
      const { ensureDevRound } = await import('../../src/lib/devGameState');
      const devRoundId = await ensureDevRound();
      const devRoundUsed = await hasUsedSuperguessThisRound(devRoundId);
      const sgEligible = isSuperguessFeatureEnabled() &&
        devStatus.globalGuessCount >= SUPERGUESS_MIN_GUESS_COUNT && !devRoundUsed;

      // Return dev round status with actual prize pool, random display values for round/guesses
      const syntheticStatus: RoundStatus = {
        roundId: devStatus.roundId, // Random 5-300
        prizePoolEth: prizePoolEthNum.toFixed(4), // Actual from database
        prizePoolUsd,
        globalGuessCount: devStatus.globalGuessCount, // Random 100-6000
        lastUpdatedAt: new Date().toISOString(),
        roundStartedAt: devStatus.roundStartedAt, // Random 0-6 days ago
        // Top-10 lock fields (Milestone 7.x)
        top10LockAfterGuesses: top10Status.top10LockAfterGuesses,
        top10GuessesRemaining: top10Status.top10GuessesRemaining,
        top10Locked: top10Status.top10Locked,
        // Milestone 15
        superguessActive: false,
        superguessEligible: sgEligible,
        // Dev mode mocks the ETH economy; it has no WordJackpot to read from.
        prizeCurrency: 'eth' as const,
      };

      return res.status(200).json(syntheticStatus);
    }

    // Production mode: fetch from database with caching
    // Milestone 4.5: Ensure dev mid-round test mode is initialized (dev only, no-op in prod)
    await ensureDevMidRound();

    // Milestone 9.0: Get active round ID first for cache key.
    // getActiveRoundId, not getActiveRound: this endpoint only needs the id,
    // and the id-only read is Redis-cached (5s) — every poll was paying a
    // Postgres query here even when the round-state cache below was hot.
    const activeRoundId = await getActiveRoundId();
    if (activeRoundId === null) {
      // No active round - return 204 No Content
      // TopTicker will show "Round #1 starting soon" splash
      return res.status(204).end();
    }

    // Use cache-aside pattern for round state
    // Cache is keyed by roundId, so round transitions automatically get fresh data
    const roundStatus = await cacheAside<RoundStatus>(
      CacheKeys.roundState(activeRoundId),
      CacheTTL.roundState,
      async () => {
        console.log(`[round-state] Cache miss, fetching from DB for round ${activeRoundId}`);
        // getRoundStatus(id), NEVER getActiveRoundStatus(): that wrapper
        // calls ensureActiveRound(), which CREATES a round when none is
        // active. Under a cached id, a poll landing in the few seconds
        // between a win locking the round and the transition invalidation
        // would otherwise mint a brand-new round — new answer, onchain
        // commit, announcement — from an anonymous request, bypassing the
        // auto-start cooldown. The id we hold is the round this request is
        // about; use it and nothing else.
        return getRoundStatus(activeRoundId);
      }
    );

    // Milestone 15: Append Superguess status (not cached — fast Redis check)
    // Spread to avoid mutating the cached object
    const response = { ...roundStatus };
    if (isSuperguessFeatureEnabled()) {
      const sgActive = await isSuperguessActive(activeRoundId);
      response.superguessActive = sgActive;
      if (!sgActive) {
        // The cached DISPLAY variant — the purchase endpoint keeps its own
        // uncached checks (money points read uncached, always).
        const alreadyUsed = await hasUsedSuperguessThisRoundCached(activeRoundId);
        response.superguessEligible =
          response.globalGuessCount >= SUPERGUESS_MIN_GUESS_COUNT && !alreadyUsed;
      } else {
        response.superguessEligible = false;
      }
    }

    // Set cache headers for client-side caching
    res.setHeader('Cache-Control', 'public, s-maxage=5, stale-while-revalidate=10');

    return res.status(200).json(response);
  } catch (error: any) {
    console.error('Error in /api/round-state:', error);
    Sentry.captureException(error, {
      tags: { endpoint: 'round-state' },
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

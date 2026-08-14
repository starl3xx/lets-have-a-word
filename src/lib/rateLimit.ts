/**
 * Rate Limiting & Spam Protection
 *
 * Lightweight, safety-first rate limiting that is effectively invisible
 * to normal players. Only activates on clearly abusive or buggy behavior.
 *
 * Guiding principles:
 * - Do not break or noticeably affect normal gameplay
 * - Prefer high thresholds and soft blocking
 * - Rate limits are a backstop, not a primary control
 * - All blocked states must be rare, recoverable, and non-punitive
 * - Never consume guess credits on blocked requests
 */

import { redis, CACHE_PREFIX } from './redis';
import { logAnalyticsEvent, AnalyticsEventTypes } from './analytics';

// =============================================================================
// Configuration (via environment variables with generous defaults)
// =============================================================================

export const RateLimitConfig = {
  guess: {
    // Burst limit: 30 requests per 10 seconds (3/sec)
    // Increased to support users with large paid guess packs
    burstRequests: parseInt(process.env.RATE_LIMIT_GUESS_BURST_REQUESTS || '30', 10),
    burstWindowSeconds: parseInt(process.env.RATE_LIMIT_GUESS_BURST_WINDOW || '10', 10),
    // Sustained limit: 180 requests per 60 seconds (3/sec)
    // Guess credits are the real limiter, not rate limits
    sustainedRequests: parseInt(process.env.RATE_LIMIT_GUESS_SUSTAINED_REQUESTS || '180', 10),
    sustainedWindowSeconds: parseInt(process.env.RATE_LIMIT_GUESS_SUSTAINED_WINDOW || '60', 10),
  },
  shareCallback: {
    // 6 requests per 60 seconds
    requests: parseInt(process.env.RATE_LIMIT_SHARE_REQUESTS || '6', 10),
    windowSeconds: parseInt(process.env.RATE_LIMIT_SHARE_WINDOW || '60', 10),
  },
  purchasePack: {
    // 4 requests per 5 minutes (300 seconds)
    requests: parseInt(process.env.RATE_LIMIT_PURCHASE_REQUESTS || '4', 10),
    windowSeconds: parseInt(process.env.RATE_LIMIT_PURCHASE_WINDOW || '300', 10),
  },
  // Duplicate submission detection
  duplicateGuess: {
    // Same word within 30 seconds is considered duplicate
    // Wider window prevents credit drain when frontend times out (12s) and user retries
    windowSeconds: parseInt(process.env.RATE_LIMIT_DUPLICATE_WINDOW || '30', 10),
  },
};

// =============================================================================
// Types
// =============================================================================

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
  reason?: 'burst' | 'sustained' | 'single';
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  lastSubmittedAt?: number;
  /**
   * When isDuplicate, whether the first attempt finished. 'pending' means it is
   * still in flight; 'processed' means it reached a durable outcome.
   */
  state?: 'pending' | 'processed';
}

/**
 * What the dedup key holds.
 *
 * It used to hold a bare timestamp, which could express "someone submitted this
 * word recently" but not "and it actually landed" — the distinction the retry
 * path turns on. See checkDuplicateGuess.
 */
type DuplicateRecord = { state: 'pending' | 'processed'; at: number };

// =============================================================================
// Key Generation
// =============================================================================

/**
 * Generate a rate limit key for FID-first limiting
 * Falls back to IP+UA hash only if FID is not available
 */
function getRateLimitKey(
  endpoint: 'guess' | 'share' | 'purchase',
  fid?: number,
  ip?: string,
  userAgent?: string
): string {
  const prefix = `${CACHE_PREFIX}rl:${endpoint}`;

  if (fid && fid > 0) {
    return `${prefix}:fid:${fid}`;
  }

  // Fallback to IP+UA hash
  const identifier = `${ip || 'unknown'}:${(userAgent || 'unknown').slice(0, 50)}`;
  // Simple hash to avoid storing raw IP/UA
  const hash = simpleHash(identifier);
  return `${prefix}:anon:${hash}`;
}

/**
 * Simple string hash function
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Generate a key for duplicate submission detection
 */
function getDuplicateKey(fid: number, word: string): string {
  return `${CACHE_PREFIX}dup:guess:${fid}:${word.toUpperCase()}`;
}

// =============================================================================
// Sliding Window Rate Limiter (using Redis sorted sets)
// =============================================================================

/**
 * Promise timeout wrapper - fails open after specified ms
 */
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) =>
      setTimeout(() => {
        console.warn(`[RateLimit] Redis operation timed out after ${timeoutMs}ms, failing open`);
        resolve(fallback);
      }, timeoutMs)
    ),
  ]);
}

/**
 * Check rate limit using sliding window algorithm
 * Returns { allowed: true } if Redis is unavailable OR times out (fail open)
 * Timeout: 2 seconds max to prevent request hangs
 */
async function checkSlidingWindowLimit(
  key: string,
  maxRequests: number,
  windowSeconds: number
): Promise<{ allowed: boolean; count: number; retryAfterSeconds?: number }> {
  if (!redis) {
    // Fail open if Redis is unavailable
    return { allowed: true, count: 0 };
  }

  const now = Date.now();
  const windowStart = now - (windowSeconds * 1000);

  // Wrap the entire operation in a timeout (2 seconds max)
  return withTimeout(
    (async () => {
      try {
        // Use a Redis transaction for atomic operations
        const pipeline = redis.pipeline();

        // Remove old entries outside the window
        pipeline.zremrangebyscore(key, 0, windowStart);

        // Count entries in current window
        pipeline.zcard(key);

        // Add current request timestamp
        pipeline.zadd(key, { score: now, member: `${now}:${Math.random()}` });

        // Set expiry on the key
        pipeline.expire(key, windowSeconds + 10);

        const results = await pipeline.exec();

        // zcard result is at index 1
        const currentCount = (results[1] as number) || 0;

        if (currentCount >= maxRequests) {
          // Calculate when the oldest request will expire
          const oldestResult = await redis.zrange(key, 0, 0, { withScores: true });
          let retryAfterSeconds = windowSeconds;

          if (oldestResult && oldestResult.length >= 2) {
            const oldestTimestamp = oldestResult[1] as number;
            retryAfterSeconds = Math.ceil((oldestTimestamp + (windowSeconds * 1000) - now) / 1000);
            retryAfterSeconds = Math.max(1, Math.min(retryAfterSeconds, windowSeconds));
          }

          return { allowed: false, count: currentCount, retryAfterSeconds };
        }

        return { allowed: true, count: currentCount + 1 };
      } catch (error) {
        console.error('[RateLimit] Error checking rate limit:', error);
        // Fail open on errors
        return { allowed: true, count: 0 };
      }
    })(),
    2000, // 2 second timeout
    { allowed: true, count: 0 } // Fail open on timeout
  );
}

// =============================================================================
// Endpoint-Specific Rate Limiters
// =============================================================================

/**
 * Check rate limit for guess endpoint (dual window: burst + sustained)
 */
export async function checkGuessRateLimit(
  fid?: number,
  ip?: string,
  userAgent?: string
): Promise<RateLimitResult> {
  const baseKey = getRateLimitKey('guess', fid, ip, userAgent);
  const config = RateLimitConfig.guess;

  // Check burst limit first (more restrictive window)
  const burstKey = `${baseKey}:burst`;
  const burstResult = await checkSlidingWindowLimit(
    burstKey,
    config.burstRequests,
    config.burstWindowSeconds
  );

  if (!burstResult.allowed) {
    // Log analytics event
    logRateLimitEvent('RATE_LIMITED_GUESS', fid, 'burst');
    return {
      allowed: false,
      retryAfterSeconds: burstResult.retryAfterSeconds,
      reason: 'burst',
    };
  }

  // Check sustained limit
  const sustainedKey = `${baseKey}:sustained`;
  const sustainedResult = await checkSlidingWindowLimit(
    sustainedKey,
    config.sustainedRequests,
    config.sustainedWindowSeconds
  );

  if (!sustainedResult.allowed) {
    // Log analytics event
    logRateLimitEvent('RATE_LIMITED_GUESS', fid, 'sustained');
    return {
      allowed: false,
      retryAfterSeconds: sustainedResult.retryAfterSeconds,
      reason: 'sustained',
    };
  }

  return { allowed: true };
}

/**
 * Check rate limit for share-callback endpoint
 */
export async function checkShareRateLimit(
  fid?: number,
  ip?: string,
  userAgent?: string
): Promise<RateLimitResult> {
  const key = getRateLimitKey('share', fid, ip, userAgent);
  const config = RateLimitConfig.shareCallback;

  const result = await checkSlidingWindowLimit(
    key,
    config.requests,
    config.windowSeconds
  );

  if (!result.allowed) {
    logRateLimitEvent('RATE_LIMITED_SHARE', fid, 'single');
    return {
      allowed: false,
      retryAfterSeconds: result.retryAfterSeconds,
      reason: 'single',
    };
  }

  return { allowed: true };
}

/**
 * Check rate limit for purchase-guess-pack endpoint
 */
export async function checkPurchaseRateLimit(
  fid?: number,
  ip?: string,
  userAgent?: string
): Promise<RateLimitResult> {
  const key = getRateLimitKey('purchase', fid, ip, userAgent);
  const config = RateLimitConfig.purchasePack;

  const result = await checkSlidingWindowLimit(
    key,
    config.requests,
    config.windowSeconds
  );

  if (!result.allowed) {
    logRateLimitEvent('RATE_LIMITED_PURCHASE', fid, 'single');
    return {
      allowed: false,
      retryAfterSeconds: result.retryAfterSeconds,
      reason: 'single',
    };
  }

  return { allowed: true };
}

// =============================================================================
// Duplicate Submission Detection
// =============================================================================

/**
 * Claim the right to process this (fid, word), or report that someone already
 * has.
 *
 * The window is 30s because the frontend gives up at 12s and users retry; the
 * key stops that retry from spending a second credit on a guess the server
 * already recorded.
 *
 * The bug this replaces: the key was written BEFORE the guess was processed and
 * never removed, so it could not tell "already recorded" from "attempted and
 * failed". When submission threw — a DB blip, an RPC hang on the correct-guess
 * path — the row was never written, no credit was spent, and every retry for
 * the next 30 seconds returned `duplicate_ignored`. The frontend renders that
 * status as no banner at all (index.tsx), so the player pressed GUESS and
 * watched nothing happen, with the word silently discarded.
 *
 * So the record carries the outcome. Callers must close it out: mark it
 * processed once the guess is durable, or clear it if nothing was recorded.
 * Leaving a 'pending' record is the old bug, scoped to 30 seconds.
 *
 * Claiming is a single SET NX, which is also a fix in itself — the previous
 * GET-then-SET let two concurrent identical submissions both read an empty key
 * and both proceed, which is the exact double-submit the check exists to catch.
 */
export async function checkDuplicateGuess(
  fid: number,
  word: string
): Promise<DuplicateCheckResult> {
  if (!redis) {
    // Can't check without Redis, assume not duplicate
    return { isDuplicate: false };
  }

  const key = getDuplicateKey(fid, word);
  const config = RateLimitConfig.duplicateGuess;

  try {
    const record: DuplicateRecord = { state: 'pending', at: Date.now() };
    const claimed = await redis.set(key, record, {
      nx: true,
      ex: config.windowSeconds,
    });

    if (claimed) {
      return { isDuplicate: false };
    }

    // Lost the race, or a previous attempt already holds the key.
    const existing = await redis.get<DuplicateRecord | number>(key);

    // A bare number is a record written by the previous version of this
    // function, still inside its 30s TTL during a deploy. It only ever meant
    // "submitted", so treat it as processed — the conservative reading.
    const state =
      typeof existing === 'object' && existing !== null ? existing.state : 'processed';
    const at =
      typeof existing === 'object' && existing !== null
        ? existing.at
        : typeof existing === 'number'
          ? existing
          : undefined;

    console.log(
      `[RateLimit] Duplicate guess detected: FID ${fid}, word "${word}" (${state})`
    );
    logAnalyticsEvent(AnalyticsEventTypes.GUESS_SUBMITTED, {
      userId: fid.toString(),
      data: {
        event_subtype: 'DUPLICATE_SUBMISSION_IGNORED',
        word: word.toUpperCase(),
        last_submitted_at: at,
        duplicate_state: state,
      },
    });

    return { isDuplicate: true, lastSubmittedAt: at, state };
  } catch (error) {
    console.error('[RateLimit] Error checking duplicate guess:', error);
    // Fail open - don't block on errors
    return { isDuplicate: false };
  }
}

/**
 * Mark the guess as durably recorded, so retries inside the window keep being
 * absorbed. Call this when the submission consumed a credit, wrote a guess row,
 * or paid out a reward.
 */
export async function markDuplicateProcessed(fid: number, word: string): Promise<void> {
  if (!redis) return;

  const key = getDuplicateKey(fid, word);
  const record: DuplicateRecord = { state: 'processed', at: Date.now() };
  try {
    await redis.set(key, record, { ex: RateLimitConfig.duplicateGuess.windowSeconds });
  } catch (error) {
    // Non-critical: the key stays 'pending' and expires on its own. A retry
    // inside the window is still absorbed, which is the safe direction.
    console.error('[RateLimit] Error marking duplicate processed:', error);
  }
}

/**
 * Release the claim because nothing was recorded — the submission threw, or it
 * was rejected without spending anything. The player's retry must be allowed to
 * do real work; that is the whole point.
 *
 * Safe even if the guess did land and failed afterwards: the retry runs the
 * round-wide duplicate check in guesses.ts, gets `already_guessed_word`, and
 * spends no credit.
 */
export async function clearDuplicateGuess(fid: number, word: string): Promise<void> {
  if (!redis) return;

  const key = getDuplicateKey(fid, word);
  try {
    await redis.del(key);
  } catch (error) {
    // Non-critical, just log
    console.error('[RateLimit] Error clearing duplicate key:', error);
  }
}

// =============================================================================
// Analytics Logging
// =============================================================================

/**
 * Log rate limit event for analytics
 */
function logRateLimitEvent(
  eventType: 'RATE_LIMITED_GUESS' | 'RATE_LIMITED_SHARE' | 'RATE_LIMITED_PURCHASE',
  fid?: number,
  windowType?: 'burst' | 'sustained' | 'single'
): void {
  console.log(`[RateLimit] ${eventType}: FID ${fid || 'anonymous'}, window: ${windowType}`);

  logAnalyticsEvent(AnalyticsEventTypes.GUESS_SUBMITTED, {
    userId: fid?.toString() || 'anonymous',
    data: {
      event_subtype: eventType,
      window_type: windowType,
    },
  });
}

// =============================================================================
// Share Replay Detection (idempotent handling)
// =============================================================================

/**
 * Check if share bonus was already claimed today
 * This is handled in awardShareBonus but we expose it for explicit checking
 */
export async function wasShareBonusClaimedToday(fid: number): Promise<boolean> {
  // This check is actually done in daily-limits.ts via awardShareBonus
  // We provide this wrapper for explicit early checking if needed
  if (!redis) return false;

  const today = new Date().toISOString().split('T')[0];
  const key = `${CACHE_PREFIX}share:claimed:${fid}:${today}`;

  try {
    const claimed = await redis.get(key);
    return claimed !== null;
  } catch {
    return false;
  }
}

/**
 * Mark share bonus as claimed for idempotency tracking
 */
export async function markShareBonusClaimed(fid: number): Promise<void> {
  if (!redis) return;

  const today = new Date().toISOString().split('T')[0];
  const key = `${CACHE_PREFIX}share:claimed:${fid}:${today}`;

  try {
    // Expires at end of UTC day (max ~24 hours)
    await redis.set(key, Date.now(), { ex: 86400 });
  } catch (error) {
    console.error('[RateLimit] Error marking share claimed:', error);
  }
}

/**
 * Log share replay detection for visibility
 */
export function logShareReplay(fid: number): void {
  console.log(`[RateLimit] SHARE_REPLAY_DETECTED: FID ${fid}`);

  logAnalyticsEvent(AnalyticsEventTypes.SHARE_SUCCESS, {
    userId: fid.toString(),
    data: {
      event_subtype: 'SHARE_REPLAY_DETECTED',
      bonusAwarded: false,
    },
  });
}

// =============================================================================
// Helper: Extract request metadata
// =============================================================================

/**
 * Extract FID, IP, and User-Agent from a Next.js API request
 */
export function extractRequestMetadata(req: {
  body?: { fid?: number; devFid?: number };
  headers: { [key: string]: string | string[] | undefined };
  socket?: { remoteAddress?: string };
}): { fid?: number; ip: string; userAgent: string } {
  // Get FID from body
  const fid = req.body?.fid || req.body?.devFid;

  // Get IP (handle proxies)
  const forwardedFor = req.headers['x-forwarded-for'];
  const ip = typeof forwardedFor === 'string'
    ? forwardedFor.split(',')[0].trim()
    : req.socket?.remoteAddress || 'unknown';

  // Get User-Agent
  const userAgent = (req.headers['user-agent'] as string) || 'unknown';

  return { fid: typeof fid === 'number' ? fid : undefined, ip, userAgent };
}

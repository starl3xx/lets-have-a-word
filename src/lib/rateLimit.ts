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
    // Burst limit: 8 requests per 10 seconds
    burstRequests: parseInt(process.env.RATE_LIMIT_GUESS_BURST_REQUESTS || '8', 10),
    burstWindowSeconds: parseInt(process.env.RATE_LIMIT_GUESS_BURST_WINDOW || '10', 10),
    // Sustained limit: 30 requests per 60 seconds
    sustainedRequests: parseInt(process.env.RATE_LIMIT_GUESS_SUSTAINED_REQUESTS || '30', 10),
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
    // Same word within 10 seconds is considered duplicate
    windowSeconds: parseInt(process.env.RATE_LIMIT_DUPLICATE_WINDOW || '10', 10),
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
}

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
 * Check rate limit using sliding window algorithm
 * Returns { allowed: true } if Redis is unavailable (fail open)
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
 * Check if this is a duplicate guess submission
 * Returns isDuplicate: true if the same FID submitted the same word recently
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
    // Check if key exists
    const lastSubmitted = await redis.get<number>(key);

    if (lastSubmitted) {
      // Log duplicate detection
      console.log(`[RateLimit] Duplicate guess detected: FID ${fid}, word "${word}"`);
      logAnalyticsEvent(AnalyticsEventTypes.GUESS_SUBMITTED, {
        userId: fid.toString(),
        data: {
          event_subtype: 'DUPLICATE_SUBMISSION_IGNORED',
          word: word.toUpperCase(),
          last_submitted_at: lastSubmitted,
        },
      });

      return { isDuplicate: true, lastSubmittedAt: lastSubmitted };
    }

    // Record this submission
    await redis.set(key, Date.now(), { ex: config.windowSeconds });

    return { isDuplicate: false };
  } catch (error) {
    console.error('[RateLimit] Error checking duplicate guess:', error);
    // Fail open - don't block on errors
    return { isDuplicate: false };
  }
}

/**
 * Clear duplicate guess record (call after successful guess processing)
 * This allows the same word to be submitted again after processing
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

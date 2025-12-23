/**
 * Upstash Redis Client & Caching Layer
 * Milestone 9.0
 *
 * Provides:
 * - Redis client with graceful degradation (no-op when unavailable)
 * - Cache utilities with automatic key prefixing
 * - Explicit cache invalidation functions
 * - Rate limiting support
 *
 * Environment Variables:
 * - UPSTASH_REDIS_REST_URL: Upstash Redis REST URL
 * - UPSTASH_REDIS_REST_TOKEN: Upstash Redis REST token
 *
 * Cache Key Strategy:
 * - Include roundId in keys for round-specific data
 * - Use short TTL (5-10s) as safety net for missed invalidations
 * - Explicit invalidation on every state change
 */

import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';

// ============================================================
// Redis Client Initialization
// ============================================================

/**
 * Get Redis configuration from environment
 * Supports both Upstash direct and Vercel KV naming conventions:
 * - UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (Upstash direct)
 * - KV_REST_API_URL / KV_REST_API_TOKEN (Vercel KV)
 */
function getRedisConfig(): { url: string; token: string } | null {
  // Try Upstash direct naming first
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return {
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    };
  }

  // Try Vercel KV naming
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    return {
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    };
  }

  return null;
}

/**
 * Check if Redis is configured
 * Returns true if credentials are present (either naming convention)
 */
export function isRedisConfigured(): boolean {
  return getRedisConfig() !== null;
}

/**
 * Create Redis client if configured, otherwise return null
 * This allows the app to function without Redis (graceful degradation)
 */
function createRedisClient(): Redis | null {
  const config = getRedisConfig();

  if (!config) {
    console.log('[Redis] Not configured - caching disabled');
    return null;
  }

  try {
    const redis = new Redis({
      url: config.url,
      token: config.token,
    });
    console.log('[Redis] Client initialized');
    return redis;
  } catch (error) {
    console.error('[Redis] Failed to initialize client:', error);
    return null;
  }
}

/**
 * Singleton Redis client instance
 * May be null if Redis is not configured
 */
export const redis = createRedisClient();

// ============================================================
// Cache Key Prefixes
// ============================================================

const CACHE_PREFIX = 'lhaw:';

export const CacheKeys = {
  /** Round state for top ticker (includes roundId) */
  roundState: (roundId: number) => `${CACHE_PREFIX}round-state:${roundId}`,

  /** Wheel data (includes roundId) */
  wheel: (roundId: number) => `${CACHE_PREFIX}wheel:${roundId}`,

  /** Current active round ID (changes on round transition) */
  activeRoundId: () => `${CACHE_PREFIX}active-round-id`,

  /** ETH/USD price (global, refreshed every minute) */
  ethPrice: () => `${CACHE_PREFIX}eth-price`,

  /** Rate limit key for a specific identifier */
  rateLimit: (identifier: string) => `${CACHE_PREFIX}rate:${identifier}`,
} as const;

// ============================================================
// Cache TTLs (in seconds)
// ============================================================

export const CacheTTL = {
  /** Round state - short TTL, invalidated on every guess/purchase */
  roundState: 10,

  /** Wheel data - short TTL, invalidated on every guess */
  wheel: 5,

  /** Active round ID - very short, critical for round transitions */
  activeRoundId: 5,

  /** ETH price - longer TTL, updated less frequently */
  ethPrice: 60,
} as const;

// ============================================================
// Cache Operations
// ============================================================

/**
 * Get a value from cache
 * Returns null if Redis is unavailable or key doesn't exist
 *
 * @param key Cache key
 * @returns Cached value or null
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  if (!redis) {
    return null;
  }

  try {
    const value = await redis.get<T>(key);
    if (value !== null) {
      console.log(`[Cache] HIT: ${key}`);
    }
    return value;
  } catch (error) {
    console.error(`[Cache] GET error for ${key}:`, error);
    return null;
  }
}

/**
 * Set a value in cache with TTL
 * No-op if Redis is unavailable
 *
 * @param key Cache key
 * @param value Value to cache
 * @param ttlSeconds TTL in seconds
 */
export async function cacheSet<T>(
  key: string,
  value: T,
  ttlSeconds: number
): Promise<void> {
  if (!redis) {
    return;
  }

  try {
    await redis.set(key, value, { ex: ttlSeconds });
    console.log(`[Cache] SET: ${key} (TTL: ${ttlSeconds}s)`);
  } catch (error) {
    console.error(`[Cache] SET error for ${key}:`, error);
  }
}

/**
 * Delete a key from cache (explicit invalidation)
 * No-op if Redis is unavailable
 *
 * @param key Cache key to delete
 */
export async function cacheDel(key: string): Promise<void> {
  if (!redis) {
    return;
  }

  try {
    await redis.del(key);
    console.log(`[Cache] DEL: ${key}`);
  } catch (error) {
    console.error(`[Cache] DEL error for ${key}:`, error);
  }
}

/**
 * Delete multiple keys from cache
 * No-op if Redis is unavailable
 *
 * @param keys Array of cache keys to delete
 */
export async function cacheDelMultiple(keys: string[]): Promise<void> {
  if (!redis || keys.length === 0) {
    return;
  }

  try {
    await redis.del(...keys);
    console.log(`[Cache] DEL (batch): ${keys.join(', ')}`);
  } catch (error) {
    console.error(`[Cache] DEL batch error:`, error);
  }
}

// ============================================================
// Round-Specific Cache Invalidation
// ============================================================

/**
 * Invalidate all caches for a specific round
 * Call this after any state change (guess, purchase, etc.)
 *
 * @param roundId Round ID to invalidate caches for
 */
export async function invalidateRoundCaches(roundId: number): Promise<void> {
  const keys = [
    CacheKeys.roundState(roundId),
    CacheKeys.wheel(roundId),
  ];

  console.log(`[Cache] Invalidating round ${roundId} caches`);
  await cacheDelMultiple(keys);
}

/**
 * Invalidate all round-related caches on round transition
 * CRITICAL: Call this when a round is won/resolved
 *
 * This invalidates:
 * - The old round's state and wheel
 * - The active round ID cache (forces fresh lookup)
 *
 * @param oldRoundId The round that just ended
 */
export async function invalidateOnRoundTransition(
  oldRoundId: number
): Promise<void> {
  console.log(`[Cache] ROUND TRANSITION: Invalidating round ${oldRoundId}`);

  const keys = [
    CacheKeys.roundState(oldRoundId),
    CacheKeys.wheel(oldRoundId),
    CacheKeys.activeRoundId(),
  ];

  await cacheDelMultiple(keys);
}

/**
 * Invalidate wheel cache for a round
 * Call this after a guess is submitted (wrong guesses update the wheel)
 *
 * @param roundId Round ID
 */
export async function invalidateWheelCache(roundId: number): Promise<void> {
  await cacheDel(CacheKeys.wheel(roundId));
}

/**
 * Invalidate round state cache
 * Call this after prize pool changes (pack purchase, etc.)
 *
 * @param roundId Round ID
 */
export async function invalidateRoundStateCache(
  roundId: number
): Promise<void> {
  await cacheDel(CacheKeys.roundState(roundId));
}

// ============================================================
// Rate Limiting
// ============================================================

/**
 * Create a rate limiter with sliding window algorithm
 * Returns null if Redis is unavailable
 *
 * @param requests Max requests allowed
 * @param window Window duration string (e.g., "10 s", "1 m", "1 h")
 * @returns Ratelimit instance or null
 */
export function createRateLimiter(
  requests: number,
  window: `${number} s` | `${number} m` | `${number} h`
): Ratelimit | null {
  if (!redis) {
    console.log('[RateLimit] Redis unavailable - rate limiting disabled');
    return null;
  }

  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(requests, window),
    prefix: `${CACHE_PREFIX}ratelimit`,
    analytics: true,
  });
}

/**
 * Pre-configured rate limiters for different endpoints
 */
export const RateLimiters = {
  /**
   * Guess endpoint: 30 requests per minute per user
   * Generous limit but prevents spam
   */
  guess: createRateLimiter(30, '1 m'),

  /**
   * Pack purchase: 10 requests per minute per user
   * Lower limit for financial operations
   */
  packPurchase: createRateLimiter(10, '1 m'),

  /**
   * General API: 60 requests per minute per IP
   * Applies to read endpoints like round-state, wheel, etc.
   */
  general: createRateLimiter(60, '1 m'),

  /**
   * Strict limit for sensitive operations: 5 per minute
   */
  strict: createRateLimiter(5, '1 m'),
} as const;

/**
 * Check rate limit for an identifier
 * Returns { success: true } if Redis is unavailable (fail open)
 *
 * @param limiter The rate limiter to use
 * @param identifier Unique identifier (FID, IP, etc.)
 * @returns Rate limit result
 */
export async function checkRateLimit(
  limiter: Ratelimit | null,
  identifier: string
): Promise<{ success: boolean; limit?: number; remaining?: number; reset?: number }> {
  if (!limiter) {
    // Fail open if Redis is unavailable
    return { success: true };
  }

  try {
    const result = await limiter.limit(identifier);
    return {
      success: result.success,
      limit: result.limit,
      remaining: result.remaining,
      reset: result.reset,
    };
  } catch (error) {
    console.error('[RateLimit] Error checking limit:', error);
    // Fail open on errors
    return { success: true };
  }
}

// ============================================================
// Helper: Cache-Aside Pattern
// ============================================================

/**
 * Get from cache or fetch and cache
 * Implements the cache-aside pattern with automatic fallback
 *
 * @param key Cache key
 * @param ttlSeconds Cache TTL
 * @param fetchFn Function to fetch data if not cached
 * @returns Cached or freshly fetched data
 */
export async function cacheAside<T>(
  key: string,
  ttlSeconds: number,
  fetchFn: () => Promise<T>
): Promise<T> {
  // Try to get from cache
  const cached = await cacheGet<T>(key);
  if (cached !== null) {
    return cached;
  }

  // Cache miss - fetch fresh data
  console.log(`[Cache] MISS: ${key}`);
  const data = await fetchFn();

  // Cache the result (fire and forget)
  cacheSet(key, data, ttlSeconds).catch(() => {
    // Ignore cache errors - we have fresh data
  });

  return data;
}

// ============================================================
// Diagnostic Functions
// ============================================================

/**
 * Check Redis health/connectivity
 * Useful for health checks and debugging
 */
export async function checkRedisHealth(): Promise<{
  configured: boolean;
  connected: boolean;
  latencyMs?: number;
}> {
  if (!redis) {
    return { configured: false, connected: false };
  }

  try {
    const start = Date.now();
    await redis.ping();
    const latencyMs = Date.now() - start;

    return {
      configured: true,
      connected: true,
      latencyMs,
    };
  } catch (error) {
    console.error('[Redis] Health check failed:', error);
    return { configured: true, connected: false };
  }
}

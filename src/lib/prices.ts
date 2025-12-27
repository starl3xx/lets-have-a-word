/**
 * ETH/USD Price Fetching
 * Milestone 4.12
 *
 * Implements:
 * - CoinGecko API integration for ETH/USD price
 * - 1-minute client-side caching
 * - Graceful fallback to last known price on error
 * - Analytics logging for failures
 * - No API keys required
 */

import { logAnalyticsEvent, AnalyticsEventTypes } from './analytics';

// =============================================================================
// Cache Configuration
// =============================================================================

let cachedEthUsd: number | null = null;
let cachedAt = 0;
const CACHE_MS = 60_000; // 1 minute
const STALE_CACHE_MS = 15 * 60_000; // 15 minutes - after this, cache is "stale"

// Track failures for analytics (don't spam logs)
let lastFailureLogged = 0;
const FAILURE_LOG_COOLDOWN_MS = 5 * 60_000; // 5 minutes between failure logs

// =============================================================================
// Price Result Type
// =============================================================================

export interface PriceResult {
  /** The ETH/USD price, or null if completely unavailable */
  price: number | null;
  /** Whether this price is from cache (not fresh) */
  isFromCache: boolean;
  /** Whether the price is unavailable (null) */
  isUnavailable: boolean;
  /** Whether the cached price is stale (> 15 min old) */
  isStale: boolean;
  /** Error message if fetch failed */
  error?: string;
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * Get current ETH/USD price from CoinGecko
 * Milestone 4.12: Free API with 1-minute caching
 *
 * Features:
 * - Uses CoinGecko Simple Price API (no auth required)
 * - Caches result for 60 seconds to avoid rate limits
 * - Falls back to last cached price on error
 * - Never throws or blocks UI rendering
 * - Logs failures to analytics (rate-limited)
 *
 * @returns Current ETH/USD price, or null if unavailable
 */
export async function getEthUsdPrice(): Promise<number | null> {
  const result = await getEthUsdPriceWithMeta();
  return result.price;
}

/**
 * Get ETH/USD price with metadata about the source
 * Use this when you need to know if the price is fresh or cached
 */
export async function getEthUsdPriceWithMeta(): Promise<PriceResult> {
  const now = Date.now();

  // Use cached price if valid (within 1 minute)
  if (cachedEthUsd !== null && now - cachedAt < CACHE_MS) {
    return {
      price: cachedEthUsd,
      isFromCache: false, // Within cache window = "fresh"
      isUnavailable: false,
      isStale: false,
    };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
      {
        cache: "no-store",
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errorMsg = `CoinGecko HTTP ${res.status}: ${res.statusText}`;
      console.error("[prices] CoinGecko ETH price error:", errorMsg);

      // Log to analytics (rate-limited)
      logPriceFailure(res.status === 429 ? 'rate_limited' : 'http_error', errorMsg);

      // Fallback to cached price
      return buildCachedResult(errorMsg);
    }

    const data = await res.json();
    const price = data?.ethereum?.usd;

    if (typeof price === "number" && price > 0) {
      cachedEthUsd = price;
      cachedAt = now;
      return {
        price,
        isFromCache: false,
        isUnavailable: false,
        isStale: false,
      };
    }

    // Invalid response format
    const errorMsg = 'Invalid CoinGecko response format';
    console.error("[prices]", errorMsg, data);
    logPriceFailure('invalid_response', errorMsg);

    return buildCachedResult(errorMsg);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    const isTimeout = errorMsg.includes('abort');
    console.error("[prices] CoinGecko ETH price fetch failed:", errorMsg);

    logPriceFailure(isTimeout ? 'timeout' : 'network_error', errorMsg);

    return buildCachedResult(errorMsg);
  }
}

/**
 * Build a result from cached data
 */
function buildCachedResult(error?: string): PriceResult {
  const now = Date.now();
  const isStale = cachedEthUsd === null || (now - cachedAt > STALE_CACHE_MS);

  return {
    price: cachedEthUsd,
    isFromCache: cachedEthUsd !== null,
    isUnavailable: cachedEthUsd === null,
    isStale,
    error,
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Log price fetch failure to analytics (rate-limited)
 */
function logPriceFailure(reason: string, details: string): void {
  const now = Date.now();
  if (now - lastFailureLogged < FAILURE_LOG_COOLDOWN_MS) {
    return; // Don't spam analytics
  }

  lastFailureLogged = now;

  // Fire-and-forget analytics logging
  const eventType = (AnalyticsEventTypes as Record<string, string>).PRICE_USD_UNAVAILABLE || 'price_usd_unavailable';
  logAnalyticsEvent(eventType as any, {
    data: {
      reason,
      details,
      hasCachedPrice: cachedEthUsd !== null,
      cacheAgeMs: cachedEthUsd !== null ? now - cachedAt : null,
    },
  }).catch(() => {
    // Ignore analytics errors
  });
}

/**
 * Get the current cached price without fetching
 * Useful for synchronous access to last known price
 */
export function getCachedEthUsdPrice(): number | null {
  return cachedEthUsd;
}

/**
 * Check if the cached price is stale (older than 15 minutes)
 */
export function isCachedPriceStale(): boolean {
  if (cachedEthUsd === null) return true;
  return Date.now() - cachedAt > STALE_CACHE_MS;
}

/**
 * Get cache age in milliseconds
 */
export function getCacheAgeMs(): number | null {
  if (cachedAt === 0) return null;
  return Date.now() - cachedAt;
}

/**
 * Format ETH amount to USD string
 * Returns null if price is unavailable
 */
export function formatEthToUsd(ethAmount: number | string): string | null {
  const eth = typeof ethAmount === 'string' ? parseFloat(ethAmount) : ethAmount;
  if (isNaN(eth) || cachedEthUsd === null) return null;

  const usd = eth * cachedEthUsd;
  if (usd >= 1000) {
    return `$${usd.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  }
  return `$${usd.toFixed(2)}`;
}

/**
 * Format ETH amount to USD with staleness indicator
 * Returns object with display info
 */
export function formatEthToUsdWithMeta(ethAmount: number | string): {
  display: string | null;
  isEstimate: boolean;
  isUnavailable: boolean;
} {
  const eth = typeof ethAmount === 'string' ? parseFloat(ethAmount) : ethAmount;

  if (isNaN(eth) || cachedEthUsd === null) {
    return {
      display: null,
      isEstimate: false,
      isUnavailable: true,
    };
  }

  const usd = eth * cachedEthUsd;
  const isStale = isCachedPriceStale();
  const formatted = usd >= 1000
    ? `$${usd.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    : `$${usd.toFixed(2)}`;

  return {
    display: isStale ? `~${formatted}` : formatted,
    isEstimate: isStale,
    isUnavailable: false,
  };
}

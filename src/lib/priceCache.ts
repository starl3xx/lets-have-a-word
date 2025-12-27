/**
 * USD Price Cache with Fallback
 * Handles CoinGecko outages gracefully by caching last known prices
 */

// =============================================================================
// Types
// =============================================================================

interface CachedPrice {
  ethUsd: number;
  timestamp: number;
}

// =============================================================================
// Configuration
// =============================================================================

/** Maximum age of cached price before considered stale (15 minutes) */
const CACHE_MAX_AGE_MS = 15 * 60 * 1000;

/** Price is considered "old" but still usable after this time (5 minutes) */
const CACHE_SOFT_STALE_MS = 5 * 60 * 1000;

/** Storage key for localStorage persistence */
const STORAGE_KEY = 'lhaw_eth_usd_cache';

// =============================================================================
// In-Memory Cache
// =============================================================================

let memoryCache: CachedPrice | null = null;

// =============================================================================
// Persistence (Browser Only)
// =============================================================================

function persistToStorage(price: CachedPrice): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(price));
  } catch {
    // localStorage might be full or disabled
  }
}

function loadFromStorage(): CachedPrice | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored) as CachedPrice;
    }
  } catch {
    // Invalid JSON or localStorage disabled
  }
  return null;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Update the cached ETH/USD price
 * Call this when you successfully fetch a new price
 */
export function updatePriceCache(ethUsd: number): void {
  const cached: CachedPrice = {
    ethUsd,
    timestamp: Date.now(),
  };
  memoryCache = cached;
  persistToStorage(cached);
}

/**
 * Get the cached ETH/USD price
 * Returns null if no cache or cache is too old
 */
export function getCachedPrice(): CachedPrice | null {
  // Try memory cache first
  if (memoryCache) {
    return memoryCache;
  }

  // Try localStorage
  const stored = loadFromStorage();
  if (stored) {
    memoryCache = stored;
    return stored;
  }

  return null;
}

/**
 * Check if the cached price is stale (older than 15 minutes)
 * Stale prices should not be displayed
 */
export function isPriceStale(cached: CachedPrice | null): boolean {
  if (!cached) return true;
  return Date.now() - cached.timestamp > CACHE_MAX_AGE_MS;
}

/**
 * Check if the cached price is soft-stale (older than 5 minutes)
 * Soft-stale prices can be displayed with "~" prefix
 */
export function isPriceSoftStale(cached: CachedPrice | null): boolean {
  if (!cached) return true;
  return Date.now() - cached.timestamp > CACHE_SOFT_STALE_MS;
}

/**
 * Format ETH to USD with appropriate fallback handling
 *
 * @param ethAmount - Amount in ETH (as string or number)
 * @param liveEthUsd - Live price if available (null if fetch failed)
 * @returns Formatted USD string or null if unavailable
 */
export function formatEthToUsd(
  ethAmount: string | number,
  liveEthUsd: number | null
): {
  usdString: string | null;
  isEstimate: boolean;
  isUnavailable: boolean;
} {
  const ethNum = typeof ethAmount === 'string' ? parseFloat(ethAmount) : ethAmount;

  // If we have a live price, use it and update cache
  if (liveEthUsd !== null && liveEthUsd > 0) {
    updatePriceCache(liveEthUsd);
    const usd = ethNum * liveEthUsd;
    return {
      usdString: formatUsdValue(usd),
      isEstimate: false,
      isUnavailable: false,
    };
  }

  // Fall back to cached price
  const cached = getCachedPrice();

  if (cached && !isPriceStale(cached)) {
    const usd = ethNum * cached.ethUsd;
    const isEstimate = isPriceSoftStale(cached);
    return {
      usdString: isEstimate ? `~${formatUsdValue(usd)}` : formatUsdValue(usd),
      isEstimate,
      isUnavailable: false,
    };
  }

  // No valid price available
  return {
    usdString: null,
    isEstimate: false,
    isUnavailable: true,
  };
}

/**
 * Format a USD value for display
 */
function formatUsdValue(usd: number): string {
  if (usd >= 1000) {
    return `$${usd.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  }
  if (usd >= 100) {
    return `$${usd.toFixed(0)}`;
  }
  if (usd >= 1) {
    return `$${usd.toFixed(2)}`;
  }
  // Small amounts
  return `$${usd.toFixed(2)}`;
}

/**
 * Get a display string for ETH with optional USD
 *
 * @param ethAmount - Amount in ETH
 * @param liveEthUsd - Live ETH/USD price (null if unavailable)
 * @returns Object with formatted strings
 */
export function getEthWithUsdDisplay(
  ethAmount: string | number,
  liveEthUsd: number | null
): {
  ethDisplay: string;
  usdDisplay: string | null;
  combined: string;
  usdUnavailable: boolean;
} {
  const ethNum = typeof ethAmount === 'string' ? parseFloat(ethAmount) : ethAmount;
  const ethDisplay = `${ethNum.toFixed(4)} ETH`;

  const { usdString, isUnavailable } = formatEthToUsd(ethAmount, liveEthUsd);

  if (usdString) {
    return {
      ethDisplay,
      usdDisplay: usdString,
      combined: `${ethDisplay} (${usdString})`,
      usdUnavailable: false,
    };
  }

  return {
    ethDisplay,
    usdDisplay: null,
    combined: ethDisplay,
    usdUnavailable: isUnavailable,
  };
}

// =============================================================================
// Server-Side Cache (for API routes)
// =============================================================================

let serverCache: CachedPrice | null = null;

/**
 * Update server-side price cache
 * Use in API routes when CoinGecko succeeds
 */
export function updateServerPriceCache(ethUsd: number): void {
  serverCache = {
    ethUsd,
    timestamp: Date.now(),
  };
}

/**
 * Get server-side cached price
 */
export function getServerCachedPrice(): CachedPrice | null {
  return serverCache;
}

/**
 * Get ETH/USD price for server with fallback
 * Returns the live price, cached price, or null
 */
export function getServerEthUsdPrice(livePrice: number | null): {
  price: number | null;
  isFromCache: boolean;
  cacheAge: number | null;
} {
  // Live price available
  if (livePrice !== null && livePrice > 0) {
    updateServerPriceCache(livePrice);
    return {
      price: livePrice,
      isFromCache: false,
      cacheAge: null,
    };
  }

  // Try cache
  if (serverCache && !isPriceStale(serverCache)) {
    return {
      price: serverCache.ethUsd,
      isFromCache: true,
      cacheAge: Date.now() - serverCache.timestamp,
    };
  }

  return {
    price: null,
    isFromCache: false,
    cacheAge: null,
  };
}

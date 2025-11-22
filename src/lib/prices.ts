/**
 * ETH/USD Price Fetching
 * Milestone 4.12
 *
 * Implements:
 * - CoinGecko API integration for ETH/USD price
 * - 1-minute client-side caching
 * - Graceful fallback to last known price on error
 * - No API keys required
 */

let cachedEthUsd: number | null = null;
let cachedAt = 0;
const CACHE_MS = 60_000; // 1 minute

/**
 * Get current ETH/USD price from CoinGecko
 * Milestone 4.12: Free API with 1-minute caching
 *
 * Features:
 * - Uses CoinGecko Simple Price API (no auth required)
 * - Caches result for 60 seconds to avoid rate limits
 * - Falls back to last cached price on error
 * - Never throws or blocks UI rendering
 *
 * @returns Current ETH/USD price, or null if unavailable
 */
export async function getEthUsdPrice(): Promise<number | null> {
  const now = Date.now();

  // Use cached price if valid
  if (cachedEthUsd !== null && now - cachedAt < CACHE_MS) {
    return cachedEthUsd;
  }

  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
      {
        cache: "no-store",
        next: { revalidate: 0 },
      }
    );

    if (!res.ok) {
      console.error("CoinGecko ETH price error:", res.status, res.statusText);
      return cachedEthUsd; // fallback to previous value
    }

    const data = await res.json();
    const price = data?.ethereum?.usd;

    if (typeof price === "number") {
      cachedEthUsd = price;
      cachedAt = now;
      return price;
    }

    return cachedEthUsd;
  } catch (err) {
    console.error("CoinGecko ETH price fetch failed:", err);
    return cachedEthUsd;
  }
}

/**
 * Onchain $WORD price source (Uniswap v4)
 *
 * Reads the pool's current price directly from chain rather than from a data
 * aggregator. This exists because every HTTP source has proven droppable:
 * DexScreener delisted $WORD in Aug 2026 and CoinGecko never listed it, which
 * briefly left the oracle with no working feed at all. A pool read cannot be
 * delisted, rate-limited, or have its response shape changed underneath us.
 *
 * Uniswap v4 keeps all pool state in a singleton PoolManager. StateView is the
 * read-only lens over it, and `getSlot0(poolId)` takes the same 32-byte pool id
 * already configured for the chart link.
 */

import { ethers } from 'ethers';
import { getBaseProvider, WORD_TOKEN_ADDRESS } from './word-token';
import { WORD_POOL_ADDRESS } from '../../config/economy';
import { getEthUsdPrice, isCachedPriceStale } from './prices';

/**
 * Ceiling for the whole onchain read.
 *
 * ethers has no built-in per-call deadline, so a hung Base RPC would otherwise
 * block indefinitely. That matters because `fetchWordTokenMarketCap` awaits
 * this inside a `Promise.all`, and with DexScreener currently returning nothing
 * this is the live path — including Superguess purchase verification, which
 * runs after the player has already transferred their $WORD.
 */
const ONCHAIN_READ_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

/**
 * Uniswap v4 StateView on Base.
 *
 * Verified rather than assumed: `getSlot0` on this address returns a
 * token1/token0 price of 1.3719e-10 for the $WORD pool, matching
 * GeckoTerminal's independently reported 1.371058e-10 to four significant
 * figures.
 */
export const UNISWAP_V4_STATE_VIEW_BASE = '0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71';

const STATE_VIEW_ABI = [
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
];

export interface OnchainPriceResult {
  /** USD per $WORD */
  priceUsd: number;
  /** Fully diluted value in USD, for parity with the aggregator sources */
  marketCapUsd: number;
  /** WETH per $WORD, before the USD conversion */
  priceInWeth: number;
  ethUsdPrice: number;
  /**
   * Whether the ETH/USD rate used for the conversion came from a stale cache.
   *
   * The pool half of this price is always current, but the USD conversion
   * leans on CoinGecko via `getEthUsdPrice()`, which can serve an arbitrarily
   * old in-memory value. Callers must not treat a stale-converted price as
   * more authoritative than a live USD feed.
   */
  ethPriceStale: boolean;
}

/**
 * Read the current $WORD price from the Uniswap v4 pool.
 *
 * $WORD is currency0 and WETH is currency1 (v4 orders by address, and
 * 0x304e… < 0x4200…), so slot0 gives WETH per $WORD directly. Both tokens use
 * 18 decimals, so no decimal correction is needed.
 *
 * Returns null rather than a zero or partial price on any failure — a wrong
 * price here would misprice real payouts, so callers must handle absence
 * explicitly instead of silently dividing by a default.
 */
export async function fetchOnchainWordPrice(): Promise<OnchainPriceResult | null> {
  try {
    const provider = getBaseProvider();
    const stateView = new ethers.Contract(
      UNISWAP_V4_STATE_VIEW_BASE,
      STATE_VIEW_ABI,
      provider
    );

    const poolId = WORD_POOL_ADDRESS.startsWith('0x')
      ? WORD_POOL_ADDRESS
      : `0x${WORD_POOL_ADDRESS}`;

    const [slot0, ethUsdPrice, totalSupplyWei] = await withTimeout(
      Promise.all([
        stateView.getSlot0(poolId),
        getEthUsdPrice(),
        new ethers.Contract(
          WORD_TOKEN_ADDRESS,
          ['function totalSupply() view returns (uint256)'],
          provider
        ).totalSupply(),
      ]),
      ONCHAIN_READ_TIMEOUT_MS,
      'Onchain $WORD price read'
    );

    const sqrtPriceX96: bigint = slot0[0];
    if (sqrtPriceX96 === 0n) {
      console.warn('[ORACLE] Onchain pool reports sqrtPriceX96 of 0 — pool uninitialised');
      return null;
    }

    if (!ethUsdPrice || ethUsdPrice <= 0) {
      console.warn('[ORACLE] Onchain price unavailable: no ETH/USD rate to convert against');
      return null;
    }

    // price = (sqrtPriceX96 / 2^96)^2, i.e. token1 per token0 = WETH per $WORD.
    // Magnitudes here (~1e-10) sit comfortably inside double precision.
    const sqrt = Number(sqrtPriceX96) / 2 ** 96;
    const priceInWeth = sqrt * sqrt;
    const priceUsd = priceInWeth * ethUsdPrice;

    if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
      console.warn(`[ORACLE] Onchain price computed as non-positive: ${priceUsd}`);
      return null;
    }

    const totalSupply = parseFloat(ethers.formatUnits(totalSupplyWei, 18));
    const marketCapUsd = priceUsd * totalSupply;

    console.log(
      `[ORACLE] Onchain (Uniswap v4) - Price: $${priceUsd.toExponential(4)}, FDV: $${marketCapUsd.toLocaleString()}`
    );

    return {
      priceUsd,
      marketCapUsd,
      priceInWeth,
      ethUsdPrice,
      ethPriceStale: isCachedPriceStale(),
    };
  } catch (error) {
    console.error('[ORACLE] Onchain price read failed:', error);
    return null;
  }
}

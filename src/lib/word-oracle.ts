/**
 * $WORD Token Market Cap Oracle Service
 * (Formerly CLANKTON Oracle - rebranded to $WORD)
 *
 * Milestone 6.2 - Oracle Integration
 *
 * Fetches $WORD market cap from DEX/API and pushes to JackpotManager contract.
 * Enables automatic bonus tier adjustment based on token market cap.
 *
 * NOTE: The contract ABI function names (e.g. updateClanktonMarketCap) are
 * unchanged because the contract is already deployed. Only wrapper function
 * names are rebranded.
 */

import { ethers } from 'ethers';
import { getJackpotManagerReadOnly, getJackpotManagerWithOperator } from './jackpot-contract';
import { WORD_TOKEN_ADDRESS } from './word-token';

/**
 * Market cap tier thresholds (in USD)
 */
export const MARKET_CAP_TIER = {
  LOW: 0,        // < $250,000 - 2 free guesses
  HIGH: 250_000, // >= $250,000 - 3 free guesses
};

/**
 * Oracle data sources in priority order
 */
export enum OracleSource {
  DEXSCREENER = 'dexscreener',
  COINGECKO = 'coingecko',
  FALLBACK = 'fallback',
}

/**
 * Market cap data structure
 */
export interface MarketCapData {
  marketCapUsd: number;
  priceUsd: number;
  source: OracleSource;
  timestamp: Date;
}

/**
 * Contract market cap info structure
 */
export interface ContractMarketCapInfo {
  marketCapUsd: bigint;
  lastUpdate: bigint;
  isStale: boolean;
  tier: number; // 0 = LOW, 1 = HIGH
}

/**
 * Fetch $WORD market cap from DexScreener API
 *
 * DexScreener provides free API access for token data including market cap.
 * Endpoint: https://api.dexscreener.com/latest/dex/tokens/{address}
 */
export async function fetchFromDexScreener(): Promise<MarketCapData | null> {
  try {
    const response = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${WORD_TOKEN_ADDRESS}`
    );

    if (!response.ok) {
      console.warn(`[ORACLE] DexScreener API error: ${response.status}`);
      return null;
    }

    const data = await response.json();

    // DexScreener returns pairs array - find the most liquid pair
    if (!data.pairs || data.pairs.length === 0) {
      console.warn('[ORACLE] No pairs found for $WORD on DexScreener');
      return null;
    }

    // Get pair with highest liquidity
    const bestPair = data.pairs.reduce((best: any, pair: any) => {
      const liquidity = parseFloat(pair.liquidity?.usd || '0');
      const bestLiquidity = parseFloat(best?.liquidity?.usd || '0');
      return liquidity > bestLiquidity ? pair : best;
    }, data.pairs[0]);

    const priceUsd = parseFloat(bestPair.priceUsd || '0');
    const fdv = parseFloat(bestPair.fdv || '0'); // Fully diluted valuation as market cap proxy

    console.log(
      `[ORACLE] DexScreener - Price: $${priceUsd.toFixed(8)}, FDV: $${fdv.toLocaleString()}`
    );

    return {
      marketCapUsd: fdv,
      priceUsd,
      source: OracleSource.DEXSCREENER,
      timestamp: new Date(),
    };
  } catch (error) {
    console.error('[ORACLE] DexScreener fetch error:', error);
    return null;
  }
}

/**
 * Fetch $WORD market cap from CoinGecko API
 *
 * CoinGecko may have $WORD listed - check by contract address.
 * Note: Rate limited on free tier.
 */
export async function fetchFromCoinGecko(): Promise<MarketCapData | null> {
  try {
    const response = await fetch(
      `https://api.coingecko.com/api/v3/coins/base/contract/${WORD_TOKEN_ADDRESS}`
    );

    if (!response.ok) {
      if (response.status === 404) {
        console.log('[ORACLE] $WORD not found on CoinGecko');
      } else {
        console.warn(`[ORACLE] CoinGecko API error: ${response.status}`);
      }
      return null;
    }

    const data = await response.json();

    const priceUsd = data.market_data?.current_price?.usd || 0;
    const marketCapUsd = data.market_data?.market_cap?.usd || 0;

    console.log(
      `[ORACLE] CoinGecko - Price: $${priceUsd.toFixed(8)}, MCap: $${marketCapUsd.toLocaleString()}`
    );

    return {
      marketCapUsd,
      priceUsd,
      source: OracleSource.COINGECKO,
      timestamp: new Date(),
    };
  } catch (error) {
    console.error('[ORACLE] CoinGecko fetch error:', error);
    return null;
  }
}

/**
 * Fetch $WORD market cap from available sources
 *
 * Tries sources in priority order:
 * 1. DexScreener (most reliable for new tokens)
 * 2. CoinGecko (if listed)
 *
 * @returns Market cap data or null if all sources fail
 */
export async function fetchWordTokenMarketCap(): Promise<MarketCapData | null> {
  console.log('[ORACLE] Fetching $WORD market cap...');

  // Try DexScreener first
  const dexData = await fetchFromDexScreener();
  if (dexData && dexData.marketCapUsd > 0) {
    return dexData;
  }

  // Fallback to CoinGecko
  const geckoData = await fetchFromCoinGecko();
  if (geckoData && geckoData.marketCapUsd > 0) {
    return geckoData;
  }

  console.warn('[ORACLE] All sources failed to return market cap');
  return null;
}

/**
 * Get current market cap info from contract
 */
export async function getContractMarketCapInfo(): Promise<ContractMarketCapInfo> {
  const contract = getJackpotManagerReadOnly();
  const [marketCapUsd, lastUpdate, isStale, tier] = await contract.getMarketCapInfo();

  return {
    marketCapUsd,
    lastUpdate,
    isStale,
    tier,
  };
}

/**
 * Get current bonus tier from contract
 *
 * @returns 'LOW' (2 guesses) or 'HIGH' (3 guesses)
 */
export async function getCurrentBonusTierFromContract(): Promise<'LOW' | 'HIGH'> {
  const contract = getJackpotManagerReadOnly();
  const tier = await contract.getCurrentBonusTier();
  return tier === 0n ? 'LOW' : 'HIGH';
}

/**
 * Get free guesses count from contract based on current tier
 */
export async function getFreeGuessesFromContract(): Promise<number> {
  const contract = getJackpotManagerReadOnly();
  const guesses = await contract.getFreeGuessesForTier();
  return Number(guesses);
}

/**
 * Check if market cap data is stale on contract
 */
export async function isMarketCapStaleOnContract(): Promise<boolean> {
  const contract = getJackpotManagerReadOnly();
  return await contract.isMarketCapStale();
}

/**
 * Push market cap to contract
 *
 * Fetches latest market cap from oracles and updates the contract.
 * Only callable with operator credentials.
 *
 * NOTE: Calls contract.updateClanktonMarketCap() - this is the deployed
 * contract's function name and cannot be changed without redeployment.
 *
 * @returns Transaction hash or null if update failed
 */
export async function pushMarketCapToContract(): Promise<string | null> {
  try {
    // Fetch latest market cap
    const marketCapData = await fetchWordTokenMarketCap();

    if (!marketCapData) {
      console.error('[ORACLE] Failed to fetch market cap - skipping update');
      return null;
    }

    // Convert to 8 decimals (contract format)
    const marketCapScaled = BigInt(Math.floor(marketCapData.marketCapUsd * 1e8));

    console.log(
      `[ORACLE] Pushing market cap to contract: $${marketCapData.marketCapUsd.toLocaleString()} ` +
        `(${marketCapScaled.toString()} scaled) from ${marketCapData.source}`
    );

    // Get contract with operator signer
    const contract = getJackpotManagerWithOperator();

    // Update market cap on contract (legacy ABI function name - deployed contract)
    const tx = await contract.updateClanktonMarketCap(marketCapScaled);
    console.log(`[ORACLE] Transaction submitted: ${tx.hash}`);

    // Wait for confirmation
    const receipt = await tx.wait();
    console.log(`[ORACLE] Market cap updated - Block: ${receipt.blockNumber}`);

    return tx.hash;
  } catch (error) {
    console.error('[ORACLE] Failed to push market cap to contract:', error);
    return null;
  }
}

/**
 * Get bonus tier based on market cap (local calculation)
 *
 * Use this for quick checks without contract calls.
 *
 * @param marketCapUsd - Market cap in USD
 * @returns 'LOW' or 'HIGH'
 */
export function calculateBonusTier(marketCapUsd: number): 'LOW' | 'HIGH' {
  return marketCapUsd >= MARKET_CAP_TIER.HIGH ? 'HIGH' : 'LOW';
}

/**
 * Get free guesses count based on tier (local calculation)
 *
 * @param tier - 'LOW' or 'HIGH'
 * @returns Number of free guesses (2 or 3)
 */
export function getFreeGuessesForTier(tier: 'LOW' | 'HIGH'): number {
  return tier === 'HIGH' ? 3 : 2;
}

/**
 * Format market cap for display
 *
 * @param marketCapUsd - Market cap in USD
 * @returns Formatted string (e.g., "$1.5M" or "$250K")
 */
export function formatMarketCap(marketCapUsd: number): string {
  if (marketCapUsd >= 1_000_000) {
    return `$${(marketCapUsd / 1_000_000).toFixed(2)}M`;
  } else if (marketCapUsd >= 1_000) {
    return `$${(marketCapUsd / 1_000).toFixed(1)}K`;
  } else {
    return `$${marketCapUsd.toFixed(2)}`;
  }
}

/**
 * Oracle update job - call this from cron
 *
 * Recommended frequency: every 15 minutes
 *
 * @example
 * // Using node-cron or similar
 * import { runOracleUpdate } from './word-oracle';
 * cron.schedule('0,15,30,45 * * * *', runOracleUpdate);
 */
export async function runOracleUpdate(): Promise<void> {
  console.log('[ORACLE] Running scheduled market cap update...');

  try {
    const txHash = await pushMarketCapToContract();

    if (txHash) {
      console.log(`[ORACLE] Update successful: ${txHash}`);
    } else {
      console.warn('[ORACLE] Update skipped or failed');
    }

    // Log current state
    const info = await getContractMarketCapInfo();
    const marketCapUsd = Number(info.marketCapUsd) / 1e8;
    const tier = info.tier === 0 ? 'LOW' : 'HIGH';

    console.log(
      `[ORACLE] Contract state - MCap: ${formatMarketCap(marketCapUsd)}, ` +
        `Tier: ${tier}, Stale: ${info.isStale}`
    );
  } catch (error) {
    console.error('[ORACLE] Update job failed:', error);
  }
}

/**
 * Initialize oracle - verify contract is accessible and log current state
 */
export async function initializeOracle(): Promise<boolean> {
  try {
    console.log('[ORACLE] Initializing $WORD market cap oracle...');

    // Check contract is accessible
    const info = await getContractMarketCapInfo();
    const marketCapUsd = Number(info.marketCapUsd) / 1e8;
    const lastUpdateDate = info.lastUpdate > 0n
      ? new Date(Number(info.lastUpdate) * 1000).toISOString()
      : 'never';

    console.log('[ORACLE] Contract state:');
    console.log(`  - Market Cap: ${formatMarketCap(marketCapUsd)}`);
    console.log(`  - Last Update: ${lastUpdateDate}`);
    console.log(`  - Is Stale: ${info.isStale}`);
    console.log(`  - Tier: ${info.tier === 0 ? 'LOW (2 guesses)' : 'HIGH (3 guesses)'}`);

    // If stale, trigger immediate update
    if (info.isStale) {
      console.log('[ORACLE] Data is stale - triggering immediate update...');
      await pushMarketCapToContract();
    }

    console.log('[ORACLE] Oracle initialized successfully');
    return true;
  } catch (error) {
    console.error('[ORACLE] Failed to initialize:', error);
    return false;
  }
}

/**
 * $WORD Token Integration
 * (Formerly CLANKTON - rebranded to $WORD)
 *
 * Milestone 4.1 - Balance checking for $WORD token bonus
 * Milestone 6.2 - Market cap oracle integration for bonus tier
 * Milestone 14  - Tiered holder bonuses (0/1/2/3) based on balance × market cap matrix
 *
 * Implements onchain balance checking for $WORD token bonus
 */

import { ethers } from 'ethers';
import {
  WORD_MARKET_CAP_USD,
  MCAP_TIER_1,
  MCAP_TIER_2,
  getHolderTierThresholds,
} from '../../config/economy';

/**
 * $WORD token contract address on Base
 * Deployed on Base mainnet
 */
export const WORD_TOKEN_ADDRESS = '0x304e649e69979298bd1aee63e175adf07885fb4b';

/**
 * ERC-20 ABI (minimal - just balanceOf)
 */
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
];

/**
 * @deprecated Use getWordBonusTier() — kept for backward compat
 * $WORD threshold for bonus (100 million tokens with 18 decimals)
 */
export const WORD_TOKEN_THRESHOLD = ethers.parseUnits('100000000', 18);

/**
 * Get Base RPC provider
 * Milestone 4.1: Configurable via environment variable
 *
 * @returns Ethers provider for Base network
 */
export function getBaseProvider(): ethers.Provider {
  const rpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
  return new ethers.JsonRpcProvider(rpcUrl);
}

/**
 * Get Base Sepolia RPC provider
 * For testnet simulations and testing
 *
 * @returns Ethers provider for Base Sepolia network
 */
export function getSepoliaProvider(): ethers.Provider {
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org';
  return new ethers.JsonRpcProvider(rpcUrl);
}

/**
 * Get the effective $WORD balance for a wallet (wallet + staked)
 * Milestone 14: Uses WordManager.getEffectiveBalance() when deployed,
 * falls back to raw balanceOf() otherwise.
 *
 * @param walletAddress - Ethereum wallet address
 * @returns Balance in whole tokens (not wei)
 */
export async function getEffectiveBalance(walletAddress: string): Promise<number> {
  try {
    const provider = getBaseProvider();
    const contract = new ethers.Contract(WORD_TOKEN_ADDRESS, ERC20_ABI, provider);
    const walletBalance = await contract.balanceOf(walletAddress);

    // Add staked balance from WordManager if deployed
    let stakedBalance = 0n;
    const wordManagerAddress = process.env.WORD_MANAGER_ADDRESS?.trim();
    if (wordManagerAddress && wordManagerAddress !== '') {
      try {
        const wordManager = new ethers.Contract(
          wordManagerAddress,
          ['function stakedBalance(address) view returns (uint256)'],
          provider
        );
        stakedBalance = await wordManager.stakedBalance(walletAddress);
      } catch {
        // stakedBalance unavailable — use wallet balance only
      }
    }

    return parseFloat(ethers.formatUnits(walletBalance + stakedBalance, 18));
  } catch (error) {
    console.error(`[$WORD] Error getting effective balance for ${walletAddress}:`, error);
    return 0;
  }
}

/**
 * Get $WORD holder bonus tier (0-3) based on effective balance and market cap
 * Milestone 14: Replaces binary hasWordTokenBonus()
 *
 * @param walletAddress - Ethereum wallet address
 * @param marketCapUsd - Current market cap in USD (defaults to env var)
 * @returns Tier level: 0 (none), 1, 2, or 3
 */
export async function getWordBonusTier(
  walletAddress: string | null,
  marketCapUsd: number = WORD_MARKET_CAP_USD
): Promise<number> {
  if (!walletAddress) return 0;

  if (!ethers.isAddress(walletAddress)) {
    console.warn(`[$WORD] Invalid wallet address: ${walletAddress}`);
    return 0;
  }

  try {
    const balanceWholeTokens = await getEffectiveBalance(walletAddress);
    const thresholds = getHolderTierThresholds(marketCapUsd);

    let tier = 0;
    if (balanceWholeTokens >= thresholds.bonus3) tier = 3;
    else if (balanceWholeTokens >= thresholds.bonus2) tier = 2;
    else if (balanceWholeTokens >= thresholds.bonus1) tier = 1;

    console.log(
      `[$WORD] Wallet ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}: ` +
      `${balanceWholeTokens.toLocaleString()} $WORD, mcap $${marketCapUsd.toLocaleString()}, tier ${tier}`
    );

    return tier;
  } catch (error) {
    console.error(`[$WORD] Error checking tier for ${walletAddress}:`, error);
    return 0;
  }
}

/**
 * Check if wallet has $WORD token bonus (backward compat wrapper)
 * @deprecated Use getWordBonusTier() for tier-specific logic
 *
 * @param walletAddress - Ethereum wallet address to check
 * @returns true if wallet qualifies for any bonus tier (1+)
 */
export async function hasWordTokenBonus(walletAddress: string | null): Promise<boolean> {
  const tier = await getWordBonusTier(walletAddress);
  return tier > 0;
}

/**
 * Format $WORD token balance for display
 *
 * @param balance - Balance in wei (18 decimals)
 * @returns Formatted string (e.g., "150.5M" or "50K")
 */
export function formatWordTokenBalance(balance: bigint): string {
  const formatted = ethers.formatUnits(balance, 18);
  const num = parseFloat(formatted);

  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  } else if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  } else {
    return num.toFixed(2);
  }
}

/**
 * Get the raw $WORD balance for a wallet (just wallet, not staked)
 *
 * @param walletAddress - Ethereum wallet address
 * @returns Balance in wei as bigint
 */
export async function getWalletBalance(walletAddress: string): Promise<bigint> {
  try {
    const provider = getBaseProvider();
    const contract = new ethers.Contract(WORD_TOKEN_ADDRESS, ERC20_ABI, provider);
    return await contract.balanceOf(walletAddress);
  } catch (error) {
    console.error(`[$WORD] Error getting wallet balance for ${walletAddress}:`, error);
    return 0n;
  }
}

/**
 * Get free guesses for $WORD token holders
 * Milestone 6.2: Now determined by market cap tier from contract
 * Milestone 14: Returns tier value directly (0-3)
 *
 * @param useContract - Whether to query contract (default: true)
 * @returns Number of free guesses (0, 1, 2, or 3)
 */
export async function getWordTokenFreeGuesses(useContract: boolean = true): Promise<number> {
  if (useContract) {
    try {
      // Dynamic import to avoid circular dependency
      const { getFreeGuessesFromContract } = await import('./word-oracle');
      return await getFreeGuessesFromContract();
    } catch (error) {
      console.warn('[$WORD] Failed to get free guesses from contract, using fallback:', error);
    }
  }

  // Fallback to environment variable
  const marketCapUsd = parseFloat(process.env.WORD_MARKET_CAP_USD || '0');
  const threshold = 250_000; // $250k threshold

  return marketCapUsd >= threshold ? 3 : 2;
}

/**
 * Get current bonus tier for $WORD token holders
 * Milestone 6.2: Determined by market cap from contract or env
 *
 * @param useContract - Whether to query contract (default: true)
 * @returns 'LOW' (2 guesses) or 'HIGH' (3 guesses)
 */
export async function getWordTokenBonusTier(useContract: boolean = true): Promise<'LOW' | 'HIGH'> {
  if (useContract) {
    try {
      const { getCurrentBonusTierFromContract } = await import('./word-oracle');
      return await getCurrentBonusTierFromContract();
    } catch (error) {
      console.warn('[$WORD] Failed to get bonus tier from contract, using fallback:', error);
    }
  }

  // Fallback to environment variable
  const marketCapUsd = parseFloat(process.env.WORD_MARKET_CAP_USD || '0');
  const threshold = 250_000;

  return marketCapUsd >= threshold ? 'HIGH' : 'LOW';
}

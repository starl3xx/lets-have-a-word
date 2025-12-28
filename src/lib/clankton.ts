/**
 * CLANKTON Integration
 * Milestone 4.1 - Balance checking for CLANKTON token bonus
 * Milestone 6.2 - Market cap oracle integration for bonus tier
 *
 * Implements onchain balance checking for CLANKTON token bonus
 */

import { ethers } from 'ethers';

/**
 * CLANKTON token contract address on Base
 */
export const CLANKTON_ADDRESS = '0x461DEb53515CaC6c923EeD9Eb7eD5Be80F4e0b07';

/**
 * CLANKTON threshold for bonus (100 million tokens with 18 decimals)
 */
export const CLANKTON_THRESHOLD = ethers.parseUnits('100000000', 18);

/**
 * ERC-20 ABI (minimal - just balanceOf)
 */
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
];

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
 * Check if wallet has CLANKTON bonus
 * Milestone 4.1: Onchain balance verification
 *
 * Checks if the wallet holds >= 100,000,000 CLANKTON tokens.
 *
 * @param walletAddress - Ethereum wallet address to check
 * @returns true if wallet has >= 100M CLANKTON, false otherwise
 */
export async function hasClanktonBonus(walletAddress: string | null): Promise<boolean> {
  // No wallet = no bonus
  if (!walletAddress) {
    console.log('[CLANKTON] No wallet address provided');
    return false;
  }

  // Validate address format
  if (!ethers.isAddress(walletAddress)) {
    console.warn(`[CLANKTON] Invalid wallet address: ${walletAddress}`);
    return false;
  }

  try {
    const provider = getBaseProvider();
    const contract = new ethers.Contract(CLANKTON_ADDRESS, ERC20_ABI, provider);

    // Get balance
    const balance = await contract.balanceOf(walletAddress);

    // Check if balance >= threshold
    const hasBonus = balance >= CLANKTON_THRESHOLD;

    console.log(
      `[CLANKTON] Wallet ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}: ` +
      `${ethers.formatUnits(balance, 18)} CLANKTON (bonus: ${hasBonus})`
    );

    return hasBonus;
  } catch (error) {
    console.error(`[CLANKTON] Error checking balance for ${walletAddress}:`, error);
    // On error, default to false (no bonus)
    return false;
  }
}

/**
 * Format CLANKTON balance for display
 *
 * @param balance - Balance in wei (18 decimals)
 * @returns Formatted string (e.g., "150.5M" or "50K")
 */
export function formatClanktonBalance(balance: bigint): string {
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
 * Get free guesses for CLANKTON holders
 * Milestone 6.2: Now determined by market cap tier from contract
 *
 * Uses environment variable as fallback if contract call fails.
 *
 * @param useContract - Whether to query contract (default: true)
 * @returns Number of free guesses (2 for LOW tier, 3 for HIGH tier)
 */
export async function getClanktonFreeGuesses(useContract: boolean = true): Promise<number> {
  if (useContract) {
    try {
      // Dynamic import to avoid circular dependency
      const { getFreeGuessesFromContract } = await import('./clankton-oracle');
      return await getFreeGuessesFromContract();
    } catch (error) {
      console.warn('[CLANKTON] Failed to get free guesses from contract, using fallback:', error);
    }
  }

  // Fallback to environment variable
  const marketCapUsd = parseFloat(process.env.CLANKTON_MARKET_CAP_USD || '0');
  const threshold = 250_000; // $250k threshold

  return marketCapUsd >= threshold ? 3 : 2;
}

/**
 * Get current bonus tier for CLANKTON holders
 * Milestone 6.2: Determined by market cap from contract or env
 *
 * @param useContract - Whether to query contract (default: true)
 * @returns 'LOW' (2 guesses) or 'HIGH' (3 guesses)
 */
export async function getClanktonBonusTier(useContract: boolean = true): Promise<'LOW' | 'HIGH'> {
  if (useContract) {
    try {
      const { getCurrentBonusTierFromContract } = await import('./clankton-oracle');
      return await getCurrentBonusTierFromContract();
    } catch (error) {
      console.warn('[CLANKTON] Failed to get bonus tier from contract, using fallback:', error);
    }
  }

  // Fallback to environment variable
  const marketCapUsd = parseFloat(process.env.CLANKTON_MARKET_CAP_USD || '0');
  const threshold = 250_000;

  return marketCapUsd >= threshold ? 'HIGH' : 'LOW';
}

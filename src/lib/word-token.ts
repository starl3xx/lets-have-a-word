/**
 * $WORD Token Integration
 * (Formerly CLANKTON - rebranded to $WORD)
 *
 * Milestone 4.1 - Balance checking for $WORD token bonus
 * Milestone 6.2 - Market cap oracle integration for bonus tier
 *
 * Implements onchain balance checking for $WORD token bonus
 */

import { ethers } from 'ethers';

/**
 * $WORD token contract address on Base
 * Deployed on Base mainnet
 */
export const WORD_TOKEN_ADDRESS = '0x304e649e69979298bd1aee63e175adf07885fb4b';

/**
 * $WORD threshold for bonus (100 million tokens with 18 decimals)
 */
export const WORD_TOKEN_THRESHOLD = ethers.parseUnits('100000000', 18);

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
 * Check if wallet has $WORD token bonus
 * Milestone 4.1: Onchain balance verification
 *
 * Checks if the wallet holds >= 100,000,000 $WORD tokens.
 *
 * @param walletAddress - Ethereum wallet address to check
 * @returns true if wallet has >= 100M $WORD, false otherwise
 */
export async function hasWordTokenBonus(walletAddress: string | null): Promise<boolean> {
  // No wallet = no bonus
  if (!walletAddress) {
    console.log('[$WORD] No wallet address provided');
    return false;
  }

  // Validate address format
  if (!ethers.isAddress(walletAddress)) {
    console.warn(`[$WORD] Invalid wallet address: ${walletAddress}`);
    return false;
  }

  try {
    const provider = getBaseProvider();
    const contract = new ethers.Contract(WORD_TOKEN_ADDRESS, ERC20_ABI, provider);

    // Get balance
    const balance = await contract.balanceOf(walletAddress);

    // Check if balance >= threshold
    const hasBonus = balance >= WORD_TOKEN_THRESHOLD;

    console.log(
      `[$WORD] Wallet ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}: ` +
      `${ethers.formatUnits(balance, 18)} $WORD (bonus: ${hasBonus})`
    );

    return hasBonus;
  } catch (error) {
    console.error(`[$WORD] Error checking balance for ${walletAddress}:`, error);
    // On error, default to false (no bonus)
    return false;
  }
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
 * Get free guesses for $WORD token holders
 * Milestone 6.2: Now determined by market cap tier from contract
 *
 * Uses environment variable as fallback if contract call fails.
 *
 * @param useContract - Whether to query contract (default: true)
 * @returns Number of free guesses (2 for LOW tier, 3 for HIGH tier)
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

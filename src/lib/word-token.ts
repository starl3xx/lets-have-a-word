/**
 * $WORD Token Integration
 * New feature: Balance checking for $WORD token bonus system
 *
 * Implements onchain balance checking for $WORD token bonuses,
 * following the CLANKTON integration pattern.
 */

import { ethers } from 'ethers';

/**
 * $WORD token contract address on Base
 * TODO: Replace with actual deployment address
 */
export const WORD_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000'; // Placeholder

/**
 * $WORD threshold for bonus (1 million tokens with 18 decimals)
 * Lower threshold than CLANKTON to encourage broader participation
 */
export const WORD_TOKEN_THRESHOLD = ethers.parseUnits('1000000', 18);

/**
 * ERC-20 ABI (minimal - just balanceOf)
 */
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
];

/**
 * Get Base RPC provider
 *
 * @returns Ethers provider for Base network
 */
export function getBaseProvider(): ethers.Provider {
  const rpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
  return new ethers.JsonRpcProvider(rpcUrl);
}

/**
 * Check if wallet has $WORD token bonus
 *
 * Checks if the wallet holds >= 1,000,000 $WORD tokens.
 *
 * @param walletAddress - Ethereum wallet address to check
 * @returns true if wallet has >= 1M $WORD, false otherwise
 */
export async function hasWordTokenBonus(walletAddress: string | null): Promise<boolean> {
  // No wallet = no bonus
  if (!walletAddress) {
    console.log('[WORD] No wallet address provided');
    return false;
  }

  // Validate address format
  if (!ethers.isAddress(walletAddress)) {
    console.warn(`[WORD] Invalid wallet address: ${walletAddress}`);
    return false;
  }

  // Return false if contract address not set (during development)
  if (WORD_TOKEN_ADDRESS === '0x0000000000000000000000000000000000000000') {
    console.log('[WORD] Token contract address not configured yet');
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
      `[WORD] Wallet ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}: ` +
      `${ethers.formatUnits(balance, 18)} $WORD (bonus: ${hasBonus})`
    );

    return hasBonus;
  } catch (error) {
    console.error(`[WORD] Error checking balance for ${walletAddress}:`, error);
    // On error, default to false (no bonus)
    return false;
  }
}

/**
 * Format $WORD balance for display
 *
 * @param balance - Balance in wei (18 decimals)
 * @returns Formatted string (e.g., "1.5M" or "500K")
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
 * Get $WORD token holder bonus guesses
 * 
 * $WORD holders get a fixed bonus of 1 additional guess per day.
 * This is simpler than CLANKTON's tiered system to start.
 *
 * @returns Number of bonus guesses for $WORD holders (always 1)
 */
export function getWordTokenBonusGuesses(): number {
  return 1;
}

/**
 * Get current $WORD token bonus info for display
 *
 * @returns Object with bonus info for UI display
 */
export function getWordTokenBonusInfo(): {
  bonusGuesses: number;
  thresholdTokens: string;
  contractAddress: string;
  isConfigured: boolean;
} {
  return {
    bonusGuesses: getWordTokenBonusGuesses(),
    thresholdTokens: ethers.formatUnits(WORD_TOKEN_THRESHOLD, 18),
    contractAddress: WORD_TOKEN_ADDRESS,
    isConfigured: WORD_TOKEN_ADDRESS !== '0x0000000000000000000000000000000000000000',
  };
}
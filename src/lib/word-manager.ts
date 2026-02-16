/**
 * WordManager Contract Integration
 * Milestone 14: Handles all $WORD game mechanics onchain
 *
 * Single contract for:
 * - Staking (user-initiated via wallet)
 * - Bonus word rewards (operator-signed)
 * - Top-10 round rewards (operator-signed)
 * - Burn word destruction (operator-signed)
 *
 * Uses ethers.js (NOT viem) to match existing codebase patterns.
 *
 * Graceful fallback: When WORD_MANAGER_ADDRESS is empty/unset,
 * all reads return null, all writes log a warning and skip.
 */

import { ethers } from 'ethers';
import { getBaseProvider } from './word-token';
import { isDevModeEnabled } from './devGameState';

/**
 * WordManager ABI (ethers.js human-readable format)
 */
const WORD_MANAGER_ABI = [
  // Staking
  'function stake(uint256 amount)',
  'function withdraw(uint256 depositId)',
  'function claimRewards()',
  'function depositRewards(uint256 amount)',
  'function stakedBalance(address) view returns (uint256)',
  'function totalStaked() view returns (uint256)',
  'function getEffectiveBalance(address user) view returns (uint256)',
  // Bonus word rewards
  'function distributeBonusReward(address player, uint256 amount)',
  // Top-10 rewards
  'function distributeTop10Rewards(uint256 roundId, address[] players, uint256[] amounts)',
  // Burn words
  'function burnWord(uint256 roundId, address discoverer, uint256 amount)',
  'function totalBurned() view returns (uint256)',
  // Rewards
  'function unclaimedRewards(address) view returns (uint256)',
];

/**
 * Get the WordManager address from environment
 * Returns null if not configured (contract not yet deployed)
 */
function getWordManagerAddress(): string | null {
  const addr = process.env.WORD_MANAGER_ADDRESS;
  if (!addr || addr === '' || addr === '0x') return null;
  return addr;
}

/**
 * Get a read-only WordManager contract instance
 * Returns null if address not configured
 */
function getWordManagerReadOnly(): ethers.Contract | null {
  const address = getWordManagerAddress();
  if (!address) return null;

  const provider = getBaseProvider();
  return new ethers.Contract(address, WORD_MANAGER_ABI, provider);
}

/**
 * Get a WordManager contract instance with operator signer (for writes)
 * Returns null if address or operator key not configured
 */
function getWordManagerWithOperator(): ethers.Contract | null {
  const address = getWordManagerAddress();
  if (!address) return null;

  const operatorKey = process.env.OPERATOR_PRIVATE_KEY;
  if (!operatorKey) {
    console.warn('[word-manager] OPERATOR_PRIVATE_KEY not set, write operations disabled');
    return null;
  }

  const provider = getBaseProvider();
  const signer = new ethers.Wallet(operatorKey, provider);
  return new ethers.Contract(address, WORD_MANAGER_ABI, signer);
}

// =============================================================================
// Read Functions
// =============================================================================

/**
 * Get staked balance for an address
 * Returns null if WordManager not deployed
 */
export async function getStakedBalance(address: string): Promise<bigint | null> {
  const contract = getWordManagerReadOnly();
  if (!contract) return null;

  try {
    return await contract.stakedBalance(address);
  } catch (error) {
    console.error('[word-manager] getStakedBalance failed:', error);
    return null;
  }
}

/**
 * Get total staked across all users
 */
export async function getTotalStaked(): Promise<bigint | null> {
  const contract = getWordManagerReadOnly();
  if (!contract) return null;

  try {
    return await contract.totalStaked();
  } catch (error) {
    console.error('[word-manager] getTotalStaked failed:', error);
    return null;
  }
}

/**
 * Get total tokens burned
 */
export async function getTotalBurned(): Promise<bigint | null> {
  const contract = getWordManagerReadOnly();
  if (!contract) return null;

  try {
    return await contract.totalBurned();
  } catch (error) {
    console.error('[word-manager] getTotalBurned failed:', error);
    return null;
  }
}

/**
 * Get unclaimed staking rewards for an address
 */
export async function getUnclaimedRewards(address: string): Promise<bigint | null> {
  const contract = getWordManagerReadOnly();
  if (!contract) return null;

  try {
    return await contract.unclaimedRewards(address);
  } catch (error) {
    console.error('[word-manager] getUnclaimedRewards failed:', error);
    return null;
  }
}

/**
 * Get staking info for an address (batched reads)
 */
export async function getStakingInfo(address: string): Promise<{
  staked: bigint;
  unclaimed: bigint;
  totalStaked: bigint;
} | null> {
  const contract = getWordManagerReadOnly();
  if (!contract) return null;

  try {
    const [staked, unclaimed, totalStakedVal] = await Promise.all([
      contract.stakedBalance(address),
      contract.unclaimedRewards(address),
      contract.totalStaked(),
    ]);
    return { staked, unclaimed, totalStaked: totalStakedVal };
  } catch (error) {
    console.error('[word-manager] getStakingInfo failed:', error);
    return null;
  }
}

// =============================================================================
// Write Functions (operator-signed)
// =============================================================================

/**
 * Distribute bonus word reward to a player
 * @returns Transaction hash or null if skipped
 */
export async function distributeBonusRewardOnChain(
  playerAddress: string,
  amount: string
): Promise<string | null> {
  if (isDevModeEnabled()) {
    console.log(`🎮 [DEV MODE] Would distribute ${amount} $WORD to ${playerAddress}`);
    return null;
  }

  const contract = getWordManagerWithOperator();
  if (!contract) {
    console.warn('[word-manager] Skipping bonus reward distribution (no WordManager)');
    return null;
  }

  try {
    const tx = await contract.distributeBonusReward(playerAddress, amount);
    const receipt = await tx.wait();
    console.log(`[word-manager] ✅ Bonus reward distributed: ${receipt.hash}`);
    return receipt.hash;
  } catch (error) {
    console.error('[word-manager] distributeBonusReward failed:', error);
    throw error;
  }
}

/**
 * Distribute top-10 $WORD rewards in a single batch transaction
 * @returns Transaction hash or null if skipped
 */
export async function distributeTop10RewardsOnChain(
  roundId: number,
  playerAddresses: string[],
  amounts: string[]
): Promise<string | null> {
  if (isDevModeEnabled()) {
    console.log(`🎮 [DEV MODE] Would distribute top-10 $WORD rewards for round ${roundId}`);
    return null;
  }

  const contract = getWordManagerWithOperator();
  if (!contract) {
    console.warn('[word-manager] Skipping top-10 distribution (no WordManager)');
    return null;
  }

  try {
    const tx = await contract.distributeTop10Rewards(roundId, playerAddresses, amounts);
    const receipt = await tx.wait();
    console.log(`[word-manager] ✅ Top-10 rewards distributed for round ${roundId}: ${receipt.hash}`);
    return receipt.hash;
  } catch (error) {
    console.error(`[word-manager] distributeTop10Rewards failed for round ${roundId}:`, error);
    throw error;
  }
}

/**
 * Execute a burn word onchain (permanently destroy tokens)
 * @returns Transaction hash or null if skipped
 */
export async function burnWordOnChain(
  roundId: number,
  discovererFid: number,
  amount: string
): Promise<string | null> {
  if (isDevModeEnabled()) {
    console.log(`🎮 [DEV MODE] Would burn ${amount} $WORD for round ${roundId}`);
    return null;
  }

  const contract = getWordManagerWithOperator();
  if (!contract) {
    console.warn('[word-manager] Skipping burn (no WordManager)');
    return null;
  }

  try {
    // Discoverer address — use zero address as discoverer info is tracked in DB
    const tx = await contract.burnWord(roundId, ethers.ZeroAddress, amount);
    const receipt = await tx.wait();
    console.log(`[word-manager] ✅ Burn executed for round ${roundId}: ${receipt.hash}`);
    return receipt.hash;
  } catch (error) {
    console.error(`[word-manager] burnWord failed for round ${roundId}:`, error);
    throw error;
  }
}

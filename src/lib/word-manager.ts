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
  // Staking (V3: single-balance model)
  'function stake(uint256 amount)',
  'function withdraw(uint256 amount)',
  'function getReward()',
  'function exit()',
  'function claimRewards()',
  'function stakedBalance(address) view returns (uint256)',
  'function totalStaked() view returns (uint256)',
  'function getEffectiveBalance(address user) view returns (uint256)',
  // V3: Synthetix streaming rewards
  'function earned(address account) view returns (uint256)',
  'function rewardPerToken() view returns (uint256)',
  'function rewardRate() view returns (uint256)',
  'function periodFinish() view returns (uint256)',
  'function rewardsDuration() view returns (uint256)',
  'function getRewardForDuration() view returns (uint256)',
  'function notifyRewardAmount(uint256 reward)',
  'function setRewardsDuration(uint256 _duration)',
  // Backward compat alias
  'function unclaimedRewards(address) view returns (uint256)',
  // Legacy bonus word rewards (pre-commitment rounds)
  'function distributeBonusReward(address player, uint256 amount)',
  // Top-10 rewards
  'function distributeTop10Rewards(uint256 roundId, address[] players, uint256[] amounts)',
  // Legacy burn words (pre-commitment rounds)
  'function burnWord(uint256 roundId, address discoverer, uint256 amount)',
  'function totalBurned() view returns (uint256)',
  // V2: Round commitment
  'function commitRound(uint256 roundId, bytes32 secretHash, bytes32[10] bonusWordHashes, bytes32[5] burnWordHashes)',
  'function isRoundCommitted(uint256 roundId) view returns (bool)',
  'function getSecretHash(uint256 roundId) view returns (bytes32)',
  'function getBonusWordHash(uint256 roundId, uint256 index) view returns (bytes32)',
  'function getBurnWordHash(uint256 roundId, uint256 index) view returns (bytes32)',
  // V2: Verified bonus word claims
  'function claimBonusReward(uint256 roundId, uint256 wordIndex, string word, bytes32 salt, address player, uint256 amount)',
  'function bonusWordClaimed(uint256 roundId, uint256 wordIndex) view returns (bool)',
  // V2: Verified burn word claims
  'function claimBurnWord(uint256 roundId, uint256 wordIndex, string word, bytes32 salt, uint256 amount)',
  'function burnWordClaimed(uint256 roundId, uint256 wordIndex) view returns (bool)',
  'function totalDistributed() view returns (uint256)',
];

/**
 * Get the WordManager address from environment
 * Returns null if not configured (contract not yet deployed)
 */
export function getWordManagerAddress(): string | null {
  const addr = process.env.WORD_MANAGER_ADDRESS;
  if (!addr || addr === '' || addr === '0x') return null;
  return addr;
}

/**
 * Get a read-only WordManager contract instance
 * Returns null if address not configured
 */
export function getWordManagerReadOnly(): ethers.Contract | null {
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
 * Get streaming earned rewards for an address (V3: Synthetix earned())
 */
export async function getEarned(address: string): Promise<bigint | null> {
  const contract = getWordManagerReadOnly();
  if (!contract) return null;

  try {
    return await contract.earned(address);
  } catch (error) {
    console.error('[word-manager] getEarned failed:', error);
    return null;
  }
}

/**
 * Get staking info for an address (batched reads)
 * V3: Uses earned() for live streaming reward value
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
      contract.earned(address),
      contract.totalStaked(),
    ]);
    return { staked, unclaimed, totalStaked: totalStakedVal };
  } catch (error) {
    console.error('[word-manager] getStakingInfo failed:', error);
    return null;
  }
}

/**
 * Get reward period info (V3: for frontend APR calculation and period display)
 */
export async function getRewardInfo(): Promise<{
  rewardRate: bigint;
  periodFinish: bigint;
  rewardsDuration: bigint;
  totalStaked: bigint;
} | null> {
  const contract = getWordManagerReadOnly();
  if (!contract) return null;

  try {
    const [rewardRate, periodFinish, rewardsDuration, totalStaked] = await Promise.all([
      contract.rewardRate(),
      contract.periodFinish(),
      contract.rewardsDuration(),
      contract.totalStaked(),
    ]);
    return { rewardRate, periodFinish, rewardsDuration, totalStaked };
  } catch (error) {
    console.error('[word-manager] getRewardInfo failed:', error);
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
 * Start or extend a reward period (V3: Synthetix notifyRewardAmount).
 * Tokens must already be in the contract before calling this.
 * If a period is active, rolls remaining undistributed into the new period.
 * @param amountWei - Amount in wei (18-decimal string)
 * @returns Transaction hash or null if skipped
 */
export async function notifyRewardAmountOnChain(amountWei: string): Promise<string | null> {
  if (isDevModeEnabled()) {
    console.log(`🎮 [DEV MODE] Would notify reward amount ${amountWei}`);
    return null;
  }

  const contract = getWordManagerWithOperator();
  if (!contract) {
    console.warn('[word-manager] Skipping notifyRewardAmount (no WordManager)');
    return null;
  }

  try {
    const tx = await contract.notifyRewardAmount(amountWei);
    const receipt = await tx.wait();
    console.log(`[word-manager] ✅ Reward period started: ${receipt.hash}`);
    return receipt.hash;
  } catch (error) {
    console.error('[word-manager] notifyRewardAmount failed:', error);
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

// =============================================================================
// V2: Commitment and Verified Claims
// =============================================================================

/**
 * Commit all 16 word hashes for a round onchain
 * @returns Transaction hash or null if skipped
 */
export async function commitRoundOnChain(
  roundId: number,
  secretHash: string,
  bonusWordHashes: string[],
  burnWordHashes: string[]
): Promise<string | null> {
  if (isDevModeEnabled()) {
    console.log(`🎮 [DEV MODE] Would commit round ${roundId} with 16 word hashes`);
    return null;
  }

  const contract = getWordManagerWithOperator();
  if (!contract) {
    console.warn('[word-manager] Skipping round commitment (no WordManager)');
    return null;
  }

  try {
    console.log(`[word-manager] Committing round ${roundId} with 16 word hashes...`);
    const tx = await contract.commitRound(roundId, secretHash, bonusWordHashes, burnWordHashes);
    const receipt = await tx.wait();
    console.log(`[word-manager] ✅ Round ${roundId} committed: ${receipt.hash}`);
    return receipt.hash;
  } catch (error) {
    console.error(`[word-manager] commitRound failed for round ${roundId}:`, error);
    throw error;
  }
}

/**
 * Claim a verified bonus word reward onchain
 * Contract verifies keccak256(abi.encodePacked(word, salt)) matches stored hash
 * @returns Transaction hash or null if skipped
 */
export async function claimBonusRewardOnChain(
  roundId: number,
  wordIndex: number,
  word: string,
  salt: string,
  playerAddress: string,
  amount: string
): Promise<string | null> {
  if (isDevModeEnabled()) {
    console.log(`🎮 [DEV MODE] Would claim bonus reward for "${word}" index ${wordIndex}`);
    return null;
  }

  const contract = getWordManagerWithOperator();
  if (!contract) {
    console.warn('[word-manager] Skipping verified bonus claim (no WordManager)');
    return null;
  }

  try {
    console.log(`[word-manager] Claiming verified bonus reward: round ${roundId}, index ${wordIndex}, word "${word}"`);
    const tx = await contract.claimBonusReward(roundId, wordIndex, word.toUpperCase(), salt, playerAddress, amount);
    const receipt = await tx.wait();
    console.log(`[word-manager] ✅ Verified bonus reward claimed: ${receipt.hash}`);
    return receipt.hash;
  } catch (error) {
    console.error(`[word-manager] claimBonusReward failed for round ${roundId}, index ${wordIndex}:`, error);
    throw error;
  }
}

/**
 * Claim a verified burn word onchain
 * Contract verifies keccak256(abi.encodePacked(word, salt)) matches stored hash
 * @returns Transaction hash or null if skipped
 */
export async function claimBurnWordOnChain(
  roundId: number,
  wordIndex: number,
  word: string,
  salt: string,
  amount: string
): Promise<string | null> {
  if (isDevModeEnabled()) {
    console.log(`🎮 [DEV MODE] Would claim burn word for "${word}" index ${wordIndex}`);
    return null;
  }

  const contract = getWordManagerWithOperator();
  if (!contract) {
    console.warn('[word-manager] Skipping verified burn claim (no WordManager)');
    return null;
  }

  try {
    console.log(`[word-manager] Claiming verified burn: round ${roundId}, index ${wordIndex}, word "${word}"`);
    const tx = await contract.claimBurnWord(roundId, wordIndex, word.toUpperCase(), salt, amount);
    const receipt = await tx.wait();
    console.log(`[word-manager] ✅ Verified burn executed: ${receipt.hash}`);
    return receipt.hash;
  } catch (error) {
    console.error(`[word-manager] claimBurnWord failed for round ${roundId}, index ${wordIndex}:`, error);
    throw error;
  }
}

/**
 * Check if a round has been committed onchain
 */
export async function isRoundCommittedOnChain(roundId: number): Promise<boolean> {
  const contract = getWordManagerReadOnly();
  if (!contract) return false;

  try {
    return await contract.isRoundCommitted(roundId);
  } catch (error) {
    console.error('[word-manager] isRoundCommitted failed:', error);
    return false;
  }
}

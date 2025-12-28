/**
 * JackpotManager Contract Integration
 * Milestone 6.1 - Smart Contract Specification
 * Milestone 6.9 - Multi-recipient payouts
 * Milestone 10.1 - Onchain commitment for provably fair verification
 *
 * Backend utilities for interacting with the JackpotManager smart contract on Base.
 *
 * Key responsibilities:
 * - Call resolveRoundWithPayouts for multi-recipient prize distribution
 * - Track onchain round state
 * - Verify contract state matches backend state
 * - Start rounds with onchain commitment for provably fair verification
 */

import { ethers, Contract, Wallet } from 'ethers';
import { getBaseProvider, getSepoliaProvider } from './clankton';
import { getWinnerPayoutAddress, logWalletResolution } from './wallet-identity';

/**
 * JackpotManager ABI (minimal - only functions we call from backend)
 */
const JACKPOT_MANAGER_ABI = [
  // Read functions
  'function currentRound() view returns (uint256)',
  'function currentJackpot() view returns (uint256)',
  'function MINIMUM_SEED() view returns (uint256)',
  'function operatorWallet() view returns (address)',
  'function creatorProfitWallet() view returns (address)',
  'function prizePoolWallet() view returns (address)',
  'function isMinimumSeedMet() view returns (bool)',
  'function getCurrentRoundInfo() view returns (uint256 roundNumber, uint256 jackpot, bool isActive, uint256 startedAt)',
  'function getRound(uint256 roundNumber) view returns (tuple(uint256 roundNumber, uint256 startingJackpot, uint256 finalJackpot, address winner, uint256 winnerPayout, uint256 startedAt, uint256 resolvedAt, bool isActive, bytes32 commitHash))',
  'function getPlayerGuessCount(address player) view returns (uint256)',
  'function creatorProfitAccumulated() view returns (uint256)',

  // Onchain commitment functions (Milestone 10.1)
  'function getCommitHash(uint256 roundNumber) view returns (bytes32)',
  'function hasOnChainCommitment(uint256 roundNumber) view returns (bool)',

  // Market cap oracle functions (Milestone 6.2)
  'function clanktonMarketCapUsd() view returns (uint256)',
  'function lastMarketCapUpdate() view returns (uint256)',
  'function MARKET_CAP_TIER_THRESHOLD() view returns (uint256)',
  'function MARKET_CAP_STALENESS_THRESHOLD() view returns (uint256)',
  'function getCurrentBonusTier() view returns (uint8)',
  'function getFreeGuessesForTier() view returns (uint256)',
  'function isMarketCapStale() view returns (bool)',
  'function getMarketCapInfo() view returns (uint256 marketCap, uint256 lastUpdate, bool isStale, uint8 tier)',

  // Write functions (operator only)
  'function seedJackpot() payable',
  'function resolveRound(address winner)',
  'function resolveRoundWithPayouts(address[] recipients, uint256[] amounts, uint256 seedForNextRound)',
  'function startNextRound()',
  'function startRoundWithCommitment(bytes32 commitHash)',
  'function purchaseGuesses(address player, uint256 quantity) payable',
  'function withdrawCreatorProfit()',
  'function updateClanktonMarketCap(uint256 marketCapUsd)',

  // Events
  'event RoundStarted(uint256 indexed roundNumber, uint256 startingJackpot, uint256 timestamp)',
  'event RoundStartedWithCommitment(uint256 indexed roundNumber, uint256 startingJackpot, bytes32 indexed commitHash, uint256 timestamp)',
  'event RoundResolved(uint256 indexed roundNumber, address indexed winner, uint256 jackpotAmount, uint256 winnerPayout, uint256 timestamp)',
  'event RoundResolvedWithPayouts(uint256 indexed roundNumber, address indexed winner, uint256 jackpotAmount, uint256 totalPaidOut, uint256 seedForNextRound, uint256 recipientCount, uint256 timestamp)',
  'event PayoutSent(uint256 indexed roundNumber, address indexed recipient, uint256 amount, uint256 index)',
  'event JackpotSeeded(uint256 indexed roundNumber, address indexed seeder, uint256 amount, uint256 newJackpot)',
  'event GuessesPurchased(uint256 indexed roundNumber, address indexed player, uint256 quantity, uint256 ethAmount, uint256 toJackpot, uint256 toCreator)',
  'event CreatorProfitPaid(address indexed recipient, uint256 amount)',
  'event MarketCapUpdated(uint256 marketCapUsd, uint256 timestamp)',
];

/**
 * Configuration for contract addresses
 */
export interface ContractConfig {
  jackpotManagerAddress: string;
  prizePoolWallet: string;
  operatorWallet: string;
  creatorProfitWallet: string;
}

/**
 * Get contract configuration from environment
 * All addresses are normalized with proper EIP-55 checksums
 */
export function getContractConfig(): ContractConfig {
  const jackpotManagerAddress = process.env.JACKPOT_MANAGER_ADDRESS;

  if (!jackpotManagerAddress) {
    throw new Error('JACKPOT_MANAGER_ADDRESS not configured');
  }

  // Helper to normalize addresses - lowercase first to avoid checksum validation errors
  const normalizeAddress = (addr: string) => ethers.getAddress(addr.toLowerCase());

  // Normalize all addresses with proper checksums (handles env vars with incorrect casing)
  return {
    jackpotManagerAddress: normalizeAddress(jackpotManagerAddress),
    prizePoolWallet: normalizeAddress(process.env.PRIZE_POOL_WALLET || '0xFd9716B26f3070Bc60AC409Aba13Dca2798771fB'),
    operatorWallet: normalizeAddress(process.env.OPERATOR_WALLET || '0xaee1ee60F8534CbFBbe856fEb9655D0c4ed35d38'),
    creatorProfitWallet: normalizeAddress(process.env.CREATOR_PROFIT_WALLET || '0x3Cee630075DC586D5BFdFA81F3a2d77980F0d223'),
  };
}

/**
 * Get Sepolia contract configuration from environment
 * Uses SEPOLIA_JACKPOT_MANAGER_ADDRESS or falls back to main address
 */
export function getSepoliaContractConfig(): ContractConfig {
  // Prefer explicit Sepolia address, fall back to main (for when main IS Sepolia)
  const jackpotManagerAddress = process.env.SEPOLIA_JACKPOT_MANAGER_ADDRESS || process.env.JACKPOT_MANAGER_ADDRESS;

  if (!jackpotManagerAddress) {
    throw new Error('SEPOLIA_JACKPOT_MANAGER_ADDRESS or JACKPOT_MANAGER_ADDRESS not configured');
  }

  const normalizeAddress = (addr: string) => ethers.getAddress(addr.toLowerCase());

  return {
    jackpotManagerAddress: normalizeAddress(jackpotManagerAddress),
    prizePoolWallet: normalizeAddress(process.env.PRIZE_POOL_WALLET || '0xFd9716B26f3070Bc60AC409Aba13Dca2798771fB'),
    operatorWallet: normalizeAddress(process.env.OPERATOR_WALLET || '0xaee1ee60F8534CbFBbe856fEb9655D0c4ed35d38'),
    creatorProfitWallet: normalizeAddress(process.env.CREATOR_PROFIT_WALLET || '0x3Cee630075DC586D5BFdFA81F3a2d77980F0d223'),
  };
}

/**
 * Get read-only contract instance
 */
export function getJackpotManagerReadOnly(): Contract {
  const config = getContractConfig();
  const provider = getBaseProvider();

  return new Contract(config.jackpotManagerAddress, JACKPOT_MANAGER_ABI, provider);
}

/**
 * Get Sepolia read-only contract instance
 */
export function getSepoliaJackpotManagerReadOnly(): Contract {
  const config = getSepoliaContractConfig();
  const provider = getSepoliaProvider();

  return new Contract(config.jackpotManagerAddress, JACKPOT_MANAGER_ABI, provider);
}

/**
 * Get Sepolia contract instance with operator signer for write operations
 */
export function getSepoliaJackpotManagerWithOperator(): Contract {
  const config = getSepoliaContractConfig();
  const operatorPrivateKey = process.env.OPERATOR_PRIVATE_KEY;

  if (!operatorPrivateKey) {
    throw new Error('OPERATOR_PRIVATE_KEY not configured for contract writes');
  }

  const provider = getSepoliaProvider();
  const wallet = new Wallet(operatorPrivateKey, provider);

  return new Contract(config.jackpotManagerAddress, JACKPOT_MANAGER_ABI, wallet);
}

/**
 * Get contract instance with operator signer for write operations
 *
 * IMPORTANT: Only use for backend automated operations
 * The operator private key must be securely managed
 */
export function getJackpotManagerWithOperator(): Contract {
  const config = getContractConfig();
  const operatorPrivateKey = process.env.OPERATOR_PRIVATE_KEY;

  if (!operatorPrivateKey) {
    throw new Error('OPERATOR_PRIVATE_KEY not configured for contract writes');
  }

  const provider = getBaseProvider();
  const wallet = new Wallet(operatorPrivateKey, provider);

  return new Contract(config.jackpotManagerAddress, JACKPOT_MANAGER_ABI, wallet);
}

/**
 * Contract round info structure
 */
export interface ContractRoundInfo {
  roundNumber: bigint;
  jackpot: bigint;
  isActive: boolean;
  startedAt: bigint;
}

/**
 * Payout recipient for multi-recipient resolution (Milestone 6.9)
 */
export interface PayoutRecipient {
  address: string;
  amountWei: bigint;
  role: 'winner' | 'referrer' | 'top_guesser';
  fid?: number;
}

/**
 * Get current round information from contract
 */
export async function getContractRoundInfo(): Promise<ContractRoundInfo> {
  const contract = getJackpotManagerReadOnly();
  const [roundNumber, jackpot, isActive, startedAt] = await contract.getCurrentRoundInfo();

  return {
    roundNumber,
    jackpot,
    isActive,
    startedAt,
  };
}

/**
 * Check if minimum seed requirement is met on contract
 */
export async function isMinimumSeedMetOnChain(): Promise<boolean> {
  const contract = getJackpotManagerReadOnly();
  return await contract.isMinimumSeedMet();
}

/**
 * Get current jackpot amount from contract
 */
export async function getCurrentJackpotOnChain(): Promise<string> {
  const contract = getJackpotManagerReadOnly();
  const jackpot = await contract.currentJackpot();
  return ethers.formatEther(jackpot);
}

/**
 * Resolve round on smart contract
 *
 * CRITICAL: This function uses the unified wallet identity system
 * to ensure the winner receives payout at the correct address.
 *
 * Flow:
 * 1. Get winner's canonical wallet from FID
 * 2. Call contract's resolveRound with verified address
 * 3. Contract pays jackpot to winner
 *
 * @param winnerFid - FID of the round winner
 * @returns Transaction hash
 */
export async function resolveRoundOnChain(winnerFid: number): Promise<string> {
  // Get winner's canonical wallet address
  const winnerWallet = await getWinnerPayoutAddress(winnerFid);
  logWalletResolution('PAYOUT', winnerFid, winnerWallet);

  // Get contract with operator signer
  const contract = getJackpotManagerWithOperator();

  console.log(`[CONTRACT] Resolving round - Winner FID: ${winnerFid}, Wallet: ${winnerWallet}`);

  // Call resolveRound on contract
  const tx = await contract.resolveRound(winnerWallet);
  console.log(`[CONTRACT] Transaction submitted: ${tx.hash}`);

  // Wait for confirmation
  const receipt = await tx.wait();
  console.log(`[CONTRACT] Round resolved - Block: ${receipt.blockNumber}, Gas: ${receipt.gasUsed}`);

  return tx.hash;
}

/**
 * Resolve round with multiple payouts on smart contract (Milestone 6.9)
 *
 * CRITICAL: This function distributes the jackpot to multiple recipients:
 * - Winner: 80%
 * - Referrer: 10% (if winner has one)
 * - Top guessers: 10% (or 17.5% if no referrer)
 * - Seed: 2.5% (if no referrer)
 *
 * @param payouts - Array of payout recipients with addresses and amounts
 * @param seedForNextRoundWei - Amount to keep as seed for next round (in wei)
 * @returns Transaction hash
 */
export async function resolveRoundWithPayoutsOnChain(
  payouts: PayoutRecipient[],
  seedForNextRoundWei: bigint
): Promise<string> {
  if (payouts.length === 0) {
    throw new Error('At least one payout recipient (winner) is required');
  }

  // Extract arrays for contract call
  const recipients = payouts.map(p => p.address);
  const amounts = payouts.map(p => p.amountWei);

  // Get contract with operator signer
  const contract = getJackpotManagerWithOperator();

  // Log payout details
  console.log(`[CONTRACT] Resolving round with ${payouts.length} payouts:`);
  for (const payout of payouts) {
    console.log(`  - ${payout.role}${payout.fid ? ` (FID ${payout.fid})` : ''}: ${payout.address} -> ${ethers.formatEther(payout.amountWei)} ETH`);
  }
  console.log(`  - Seed for next round: ${ethers.formatEther(seedForNextRoundWei)} ETH`);

  // Call resolveRoundWithPayouts on contract
  const tx = await contract.resolveRoundWithPayouts(recipients, amounts, seedForNextRoundWei);
  console.log(`[CONTRACT] Transaction submitted: ${tx.hash}`);

  // Wait for confirmation
  const receipt = await tx.wait();
  console.log(`[CONTRACT] Round resolved with payouts - Block: ${receipt.blockNumber}, Gas: ${receipt.gasUsed}`);

  return tx.hash;
}

/**
 * Seed jackpot on smart contract
 *
 * @param amountEth - Amount to seed in ETH (string)
 * @returns Transaction hash
 */
export async function seedJackpotOnChain(amountEth: string): Promise<string> {
  const contract = getJackpotManagerWithOperator();
  const amountWei = ethers.parseEther(amountEth);

  console.log(`[CONTRACT] Seeding jackpot with ${amountEth} ETH`);

  const tx = await contract.seedJackpot({ value: amountWei });
  console.log(`[CONTRACT] Seed transaction submitted: ${tx.hash}`);

  const receipt = await tx.wait();
  console.log(`[CONTRACT] Jackpot seeded - Block: ${receipt.blockNumber}`);

  return tx.hash;
}

/**
 * Purchase guesses onchain for a player
 *
 * @param playerAddress - Wallet address of the player
 * @param quantity - Number of guesses to purchase
 * @param amountEth - ETH amount to pay (as string)
 * @returns Transaction hash
 */
export async function purchaseGuessesOnChain(
  playerAddress: string,
  quantity: number,
  amountEth: string
): Promise<string> {
  const contract = getJackpotManagerWithOperator();
  const amountWei = ethers.parseEther(amountEth);

  console.log(`[CONTRACT] Purchasing ${quantity} guesses for ${playerAddress} (${amountEth} ETH)`);

  const tx = await contract.purchaseGuesses(playerAddress, quantity, { value: amountWei });
  console.log(`[CONTRACT] Purchase transaction submitted: ${tx.hash}`);

  const receipt = await tx.wait();
  console.log(`[CONTRACT] Guesses purchased - Block: ${receipt.blockNumber}`);

  return tx.hash;
}

/**
 * Start next round on smart contract (legacy - without commitment)
 *
 * @deprecated Use startRoundWithCommitmentOnChain for provably fair rounds
 * @returns Transaction hash
 */
export async function startNextRoundOnChain(): Promise<string> {
  const contract = getJackpotManagerWithOperator();

  console.log(`[CONTRACT] Starting next round (legacy - no commitment)`);

  const tx = await contract.startNextRound();
  console.log(`[CONTRACT] Start round transaction submitted: ${tx.hash}`);

  const receipt = await tx.wait();
  console.log(`[CONTRACT] Next round started - Block: ${receipt.blockNumber}`);

  return tx.hash;
}

/**
 * Start a new round with onchain commitment for provably fair verification
 *
 * This function commits the SHA-256 hash of (salt || answer) onchain before any
 * guesses can be made, proving the answer was locked before the round started.
 *
 * @param commitHash - SHA-256 hash of (salt || answer) as hex string (64 chars, no 0x prefix)
 * @returns Transaction hash
 */
export async function startRoundWithCommitmentOnChain(commitHash: string): Promise<string> {
  const contract = getJackpotManagerWithOperator();

  // Ensure commitHash is properly formatted as bytes32
  // If it doesn't start with 0x, add it
  const bytes32Hash = commitHash.startsWith('0x') ? commitHash : `0x${commitHash}`;

  console.log(`[CONTRACT] Starting round with onchain commitment`);
  console.log(`[CONTRACT] Commit hash: ${bytes32Hash}`);

  const tx = await contract.startRoundWithCommitment(bytes32Hash);
  console.log(`[CONTRACT] Start round transaction submitted: ${tx.hash}`);

  const receipt = await tx.wait();
  console.log(`[CONTRACT] Round started with commitment - Block: ${receipt.blockNumber}`);

  return tx.hash;
}

/**
 * Get the onchain commitment hash for a round
 *
 * @param roundNumber - The round number to query
 * @returns The commitment hash as hex string (with 0x prefix), or null if no commitment
 */
export async function getCommitHashOnChain(roundNumber: number): Promise<string | null> {
  const contract = getJackpotManagerReadOnly();

  const commitHash = await contract.getCommitHash(roundNumber);

  // bytes32(0) means no commitment
  const zeroHash = '0x0000000000000000000000000000000000000000000000000000000000000000';
  if (commitHash === zeroHash) {
    return null;
  }

  return commitHash;
}

/**
 * Check if a round has an onchain commitment
 *
 * @param roundNumber - The round number to query
 * @returns True if the round has a non-zero commitment hash
 */
export async function hasOnChainCommitment(roundNumber: number): Promise<boolean> {
  const contract = getJackpotManagerReadOnly();
  return await contract.hasOnChainCommitment(roundNumber);
}

/**
 * Withdraw accumulated creator profit
 *
 * @returns Transaction hash
 */
export async function withdrawCreatorProfitOnChain(): Promise<string> {
  const contract = getJackpotManagerWithOperator();

  const accumulated = await contract.creatorProfitAccumulated();
  console.log(`[CONTRACT] Withdrawing creator profit: ${ethers.formatEther(accumulated)} ETH`);

  const tx = await contract.withdrawCreatorProfit();
  console.log(`[CONTRACT] Withdrawal transaction submitted: ${tx.hash}`);

  const receipt = await tx.wait();
  console.log(`[CONTRACT] Creator profit withdrawn - Block: ${receipt.blockNumber}`);

  return tx.hash;
}

/**
 * Verify contract state matches expected state
 *
 * Used for consistency checks between backend and onchain state.
 *
 * @param expectedRound - Expected round number
 * @param expectedJackpotEth - Expected jackpot in ETH (string)
 * @returns true if states match
 */
export async function verifyContractState(
  expectedRound: number,
  expectedJackpotEth: string
): Promise<boolean> {
  try {
    const roundInfo = await getContractRoundInfo();
    const expectedJackpotWei = ethers.parseEther(expectedJackpotEth);

    const roundMatches = Number(roundInfo.roundNumber) === expectedRound;
    const jackpotMatches = roundInfo.jackpot === expectedJackpotWei;

    if (!roundMatches || !jackpotMatches) {
      console.warn(
        `[CONTRACT] State mismatch - ` +
          `Round: expected ${expectedRound}, got ${roundInfo.roundNumber} | ` +
          `Jackpot: expected ${expectedJackpotEth}, got ${ethers.formatEther(roundInfo.jackpot)}`
      );
    }

    return roundMatches && jackpotMatches;
  } catch (error) {
    console.error('[CONTRACT] Failed to verify state:', error);
    return false;
  }
}

/**
 * Get contract addresses for display/debugging
 */
export async function getContractAddresses(): Promise<{
  operator: string;
  creatorProfit: string;
  prizePool: string;
}> {
  const contract = getJackpotManagerReadOnly();

  const [operator, creatorProfit, prizePool] = await Promise.all([
    contract.operatorWallet(),
    contract.creatorProfitWallet(),
    contract.prizePoolWallet(),
  ]);

  return {
    operator,
    creatorProfit,
    prizePool,
  };
}

/**
 * Format ETH amount with appropriate precision
 */
export function formatJackpotEth(weiAmount: bigint): string {
  const ethAmount = parseFloat(ethers.formatEther(weiAmount));

  if (ethAmount >= 1) {
    return ethAmount.toFixed(4);
  } else if (ethAmount >= 0.01) {
    return ethAmount.toFixed(6);
  } else {
    return ethAmount.toFixed(8);
  }
}

/**
 * Check if contract is deployed and accessible
 */
export async function isContractDeployed(): Promise<boolean> {
  try {
    const config = getContractConfig();
    const provider = getBaseProvider();

    const code = await provider.getCode(config.jackpotManagerAddress);
    return code !== '0x';
  } catch {
    return false;
  }
}

/**
 * Verification result for a purchase transaction
 */
export interface PurchaseVerificationResult {
  valid: boolean;
  player?: string;
  quantity?: number;
  ethAmount?: string;
  toJackpot?: string;
  toCreator?: string;
  roundNumber?: number;
  error?: string;
}

/**
 * Verify an onchain purchase transaction
 *
 * Parses the GuessesPurchased event from the transaction receipt to verify:
 * - Transaction was successful
 * - Transaction was to our JackpotManager contract
 * - Event data matches expected values
 *
 * @param txHash - Transaction hash to verify
 * @param expectedPlayer - Expected player address (optional - for strict verification)
 * @param expectedQuantity - Expected quantity (optional - for strict verification)
 * @returns Verification result with transaction details
 */
export async function verifyPurchaseTransaction(
  txHash: string,
  expectedPlayer?: string,
  expectedQuantity?: number
): Promise<PurchaseVerificationResult> {
  try {
    const config = getContractConfig();
    const provider = getBaseProvider();

    // Fetch transaction receipt
    const receipt = await provider.getTransactionReceipt(txHash);

    if (!receipt) {
      return { valid: false, error: 'Transaction not found or not yet mined' };
    }

    if (receipt.status !== 1) {
      return { valid: false, error: 'Transaction reverted' };
    }

    // Check transaction was to our contract
    if (receipt.to?.toLowerCase() !== config.jackpotManagerAddress.toLowerCase()) {
      return { valid: false, error: 'Transaction was not to JackpotManager contract' };
    }

    // Create interface to decode event
    const iface = new ethers.Interface(JACKPOT_MANAGER_ABI);

    // Find GuessesPurchased event in logs
    let purchaseEvent: ethers.LogDescription | null = null;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() === config.jackpotManagerAddress.toLowerCase()) {
        try {
          const parsed = iface.parseLog({
            topics: log.topics as string[],
            data: log.data,
          });
          if (parsed?.name === 'GuessesPurchased') {
            purchaseEvent = parsed;
            break;
          }
        } catch {
          // Not this event, continue
        }
      }
    }

    if (!purchaseEvent) {
      return { valid: false, error: 'No GuessesPurchased event found in transaction' };
    }

    // Extract event data
    const roundNumber = Number(purchaseEvent.args.roundNumber);
    const player = purchaseEvent.args.player;
    const quantity = Number(purchaseEvent.args.quantity);
    const ethAmount = ethers.formatEther(purchaseEvent.args.ethAmount);
    const toJackpot = ethers.formatEther(purchaseEvent.args.toJackpot);
    const toCreator = ethers.formatEther(purchaseEvent.args.toCreator);

    // Strict verification if expected values provided
    if (expectedPlayer && player.toLowerCase() !== expectedPlayer.toLowerCase()) {
      return {
        valid: false,
        error: `Player mismatch: expected ${expectedPlayer}, got ${player}`,
        player,
        quantity,
        ethAmount,
        roundNumber,
      };
    }

    if (expectedQuantity && quantity !== expectedQuantity) {
      return {
        valid: false,
        error: `Quantity mismatch: expected ${expectedQuantity}, got ${quantity}`,
        player,
        quantity,
        ethAmount,
        roundNumber,
      };
    }

    return {
      valid: true,
      player,
      quantity,
      ethAmount,
      toJackpot,
      toCreator,
      roundNumber,
    };
  } catch (error) {
    console.error('[CONTRACT] Error verifying purchase transaction:', error);
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Unknown verification error',
    };
  }
}

// =============================================================================
// SEPOLIA-SPECIFIC FUNCTIONS
// For testnet simulations - explicitly use Sepolia RPC and contract
// =============================================================================

/**
 * Get current jackpot amount from Sepolia contract
 */
export async function getCurrentJackpotOnSepolia(): Promise<string> {
  const contract = getSepoliaJackpotManagerReadOnly();
  const jackpot = await contract.currentJackpot();
  return ethers.formatEther(jackpot);
}

/**
 * Get actual ETH balance of the Sepolia contract
 * This is the real source of truth for what can be paid out
 */
export async function getSepoliaContractBalance(): Promise<string> {
  const config = getSepoliaContractConfig();
  const provider = getSepoliaProvider();
  const balance = await provider.getBalance(config.jackpotManagerAddress);
  return ethers.formatEther(balance);
}

/**
 * Get current round info from Sepolia contract
 */
export async function getSepoliaRoundInfo(): Promise<{
  roundNumber: bigint;
  jackpot: bigint;
  isActive: boolean;
  startedAt: bigint;
}> {
  const contract = getSepoliaJackpotManagerReadOnly();
  const [roundNumber, jackpot, isActive, startedAt] = await contract.getCurrentRoundInfo();
  return { roundNumber, jackpot, isActive, startedAt };
}

/**
 * Purchase guesses on Sepolia for simulation
 */
export async function purchaseGuessesOnSepolia(
  playerAddress: string,
  quantity: number,
  amountEth: string
): Promise<string> {
  const contract = getSepoliaJackpotManagerWithOperator();
  const amountWei = ethers.parseEther(amountEth);

  console.log(`[SEPOLIA] Purchasing ${quantity} guesses for ${playerAddress} (${amountEth} ETH)`);

  const tx = await contract.purchaseGuesses(playerAddress, quantity, { value: amountWei });
  console.log(`[SEPOLIA] Purchase transaction submitted: ${tx.hash}`);

  const receipt = await tx.wait();
  console.log(`[SEPOLIA] Guesses purchased - Block: ${receipt.blockNumber}`);

  return tx.hash;
}

/**
 * Resolve round with payouts on Sepolia for simulation
 */
export async function resolveRoundWithPayoutsOnSepolia(
  payouts: PayoutRecipient[],
  seedForNextRoundWei: bigint
): Promise<string> {
  if (payouts.length === 0) {
    throw new Error('At least one payout recipient (winner) is required');
  }

  const recipients = payouts.map(p => p.address);
  const amounts = payouts.map(p => p.amountWei);

  const contract = getSepoliaJackpotManagerWithOperator();

  console.log(`[SEPOLIA] Resolving round with ${payouts.length} payouts:`);
  for (const payout of payouts) {
    console.log(`  - ${payout.role}${payout.fid ? ` (FID ${payout.fid})` : ''}: ${payout.address} -> ${ethers.formatEther(payout.amountWei)} ETH`);
  }
  console.log(`  - Seed for next round: ${ethers.formatEther(seedForNextRoundWei)} ETH`);

  const tx = await contract.resolveRoundWithPayouts(recipients, amounts, seedForNextRoundWei);
  console.log(`[SEPOLIA] Transaction submitted: ${tx.hash}`);

  const receipt = await tx.wait();
  console.log(`[SEPOLIA] Round resolved with payouts - Block: ${receipt.blockNumber}, Gas: ${receipt.gasUsed}`);

  return tx.hash;
}

/**
 * Start round with commitment on Sepolia for simulation
 */
export async function startRoundWithCommitmentOnSepolia(commitHash: string): Promise<string> {
  const contract = getSepoliaJackpotManagerWithOperator();

  const bytes32Hash = commitHash.startsWith('0x') ? commitHash : `0x${commitHash}`;

  console.log(`[SEPOLIA] Starting round with onchain commitment`);
  console.log(`[SEPOLIA] Commit hash: ${bytes32Hash}`);

  const tx = await contract.startRoundWithCommitment(bytes32Hash);
  console.log(`[SEPOLIA] Start round transaction submitted: ${tx.hash}`);

  const receipt = await tx.wait();
  console.log(`[SEPOLIA] Round started with commitment - Block: ${receipt.blockNumber}`);

  return tx.hash;
}

/**
 * Resolve previous Sepolia round by paying out full jackpot to operator
 * Used to clear stale rounds before starting a new simulation
 *
 * Uses the simpler resolveRound(winner) function which pays 100% to the winner
 */
export async function resolveSepoliaPreviousRound(): Promise<string> {
  const roundInfo = await getSepoliaRoundInfo();

  if (!roundInfo.isActive) {
    throw new Error('No active round to resolve');
  }

  // Get operator address from wallet
  const operatorPrivateKey = process.env.OPERATOR_PRIVATE_KEY;
  if (!operatorPrivateKey) {
    throw new Error('OPERATOR_PRIVATE_KEY not set');
  }
  const wallet = new ethers.Wallet(operatorPrivateKey);
  const operatorAddress = wallet.address;

  console.log(`[SEPOLIA] Resolving previous round #${roundInfo.roundNumber}`);
  console.log(`[SEPOLIA] Jackpot: ${ethers.formatEther(roundInfo.jackpot)} ETH`);
  console.log(`[SEPOLIA] Using resolveRound() to pay winner: ${operatorAddress}`);

  // Use the simpler resolveRound(winner) function
  const contract = getSepoliaJackpotManagerWithOperator();
  const tx = await contract.resolveRound(operatorAddress);
  console.log(`[SEPOLIA] Resolve transaction submitted: ${tx.hash}`);

  const receipt = await tx.wait();
  console.log(`[SEPOLIA] Round resolved - Block: ${receipt.blockNumber}`);

  return tx.hash;
}

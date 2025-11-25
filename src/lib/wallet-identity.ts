/**
 * Unified Wallet Identity Module
 * Milestone 6.1 - Smart Contract Specification
 *
 * Implements the "Unified Player Wallet Identity" requirement:
 * - ONE canonical wallet address per user per round
 * - Used for: CLANKTON eligibility checks, paid guess tracking, free guess allocation, jackpot payout
 *
 * Resolution flow:
 * 1. Neynar -> FID
 * 2. FID -> signer wallet (from Farcaster authentication)
 * 3. signer wallet -> CLANKTON balance check
 * 4. signer wallet -> all game state for that round
 */

import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { ethers } from 'ethers';

/**
 * Result of wallet resolution
 */
export interface WalletIdentityResult {
  fid: number;
  walletAddress: string;
  isValid: boolean;
  error?: string;
}

/**
 * Resolve the canonical wallet address for a user
 *
 * This is the SINGLE SOURCE OF TRUTH for wallet identity.
 * The resolved wallet address MUST be used for:
 * - CLANKTON balance checking
 * - Paid guess purchases (passed to smart contract)
 * - Round resolution (winner payout address)
 *
 * @param fid - Farcaster ID of the user
 * @returns Wallet identity result with resolved address
 */
export async function resolveWalletIdentity(fid: number): Promise<WalletIdentityResult> {
  try {
    // Get user from database
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.fid, fid))
      .limit(1);

    if (!user) {
      return {
        fid,
        walletAddress: '',
        isValid: false,
        error: `User FID ${fid} not found in database`,
      };
    }

    const walletAddress = user.signerWalletAddress;

    // Validate wallet address
    if (!walletAddress) {
      return {
        fid,
        walletAddress: '',
        isValid: false,
        error: `User FID ${fid} has no signer wallet configured`,
      };
    }

    if (!ethers.isAddress(walletAddress)) {
      return {
        fid,
        walletAddress: '',
        isValid: false,
        error: `User FID ${fid} has invalid wallet address: ${walletAddress}`,
      };
    }

    // Normalize to checksum address
    const checksumAddress = ethers.getAddress(walletAddress);

    return {
      fid,
      walletAddress: checksumAddress,
      isValid: true,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      fid,
      walletAddress: '',
      isValid: false,
      error: `Failed to resolve wallet for FID ${fid}: ${errorMessage}`,
    };
  }
}

/**
 * Get the winner payout address for round resolution
 *
 * This function MUST be used when calling the smart contract's resolveRound function.
 * It ensures the winner receives their payout at the correct wallet address.
 *
 * @param winnerFid - FID of the round winner
 * @returns The winner's wallet address for payout
 * @throws Error if wallet cannot be resolved
 */
export async function getWinnerPayoutAddress(winnerFid: number): Promise<string> {
  const identity = await resolveWalletIdentity(winnerFid);

  if (!identity.isValid) {
    throw new Error(identity.error || 'Failed to resolve winner wallet');
  }

  console.log(
    `[WALLET] Resolved winner FID ${winnerFid} payout address: ${identity.walletAddress}`
  );

  return identity.walletAddress;
}

/**
 * Validate that a wallet address matches the user's canonical wallet
 *
 * Used to verify that operations (like guess purchases) are using
 * the correct wallet address.
 *
 * @param fid - User's FID
 * @param providedWallet - Wallet address being used for operation
 * @returns true if wallet matches user's canonical wallet
 */
export async function validateWalletForUser(
  fid: number,
  providedWallet: string
): Promise<boolean> {
  const identity = await resolveWalletIdentity(fid);

  if (!identity.isValid) {
    console.warn(`[WALLET] Cannot validate - ${identity.error}`);
    return false;
  }

  // Normalize both addresses for comparison
  const normalizedProvided = ethers.getAddress(providedWallet);
  const isMatch = normalizedProvided === identity.walletAddress;

  if (!isMatch) {
    console.warn(
      `[WALLET] Wallet mismatch for FID ${fid}: ` +
        `expected ${identity.walletAddress}, got ${normalizedProvided}`
    );
  }

  return isMatch;
}

/**
 * Get wallet address for CLANKTON balance check
 *
 * Ensures CLANKTON checks use the same wallet as all other game operations.
 *
 * @param fid - User's FID
 * @returns Wallet address for balance check, or null if not resolvable
 */
export async function getClanktonCheckWallet(fid: number): Promise<string | null> {
  const identity = await resolveWalletIdentity(fid);

  if (!identity.isValid) {
    console.log(`[WALLET] CLANKTON check skipped - ${identity.error}`);
    return null;
  }

  return identity.walletAddress;
}

/**
 * Get wallet address for paid guess purchase
 *
 * This address will be passed to the smart contract's purchaseGuesses function.
 *
 * @param fid - User's FID
 * @returns Wallet address for contract call
 * @throws Error if wallet cannot be resolved
 */
export async function getGuessPurchaseWallet(fid: number): Promise<string> {
  const identity = await resolveWalletIdentity(fid);

  if (!identity.isValid) {
    throw new Error(identity.error || 'Failed to resolve wallet for guess purchase');
  }

  return identity.walletAddress;
}

/**
 * Bulk resolve wallet addresses for multiple users
 *
 * Useful for top-guesser payouts and other batch operations.
 *
 * @param fids - Array of FIDs to resolve
 * @returns Map of FID to resolved wallet address (only includes valid wallets)
 */
export async function bulkResolveWallets(
  fids: number[]
): Promise<Map<number, string>> {
  const walletMap = new Map<number, string>();

  // Get all users in one query
  const userResults = await db
    .select()
    .from(users)
    .where(eq(users.fid, fids[0])); // This is a simplification - in production would use SQL IN

  // For proper bulk query, we'd need to use drizzle's inArray
  // For now, resolve one by one (can be optimized later)
  for (const fid of fids) {
    const identity = await resolveWalletIdentity(fid);
    if (identity.isValid) {
      walletMap.set(fid, identity.walletAddress);
    }
  }

  return walletMap;
}

/**
 * Log wallet identity resolution for debugging
 *
 * @param context - Context string (e.g., "PAYOUT", "CLANKTON", "PURCHASE")
 * @param fid - User's FID
 * @param wallet - Resolved wallet address
 */
export function logWalletResolution(
  context: string,
  fid: number,
  wallet: string
): void {
  console.log(
    `[WALLET:${context}] FID ${fid} -> ${wallet.slice(0, 6)}...${wallet.slice(-4)}`
  );
}

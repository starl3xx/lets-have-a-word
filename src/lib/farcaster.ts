import { NeynarAPIClient } from '@neynar/nodejs-sdk';
import * as dotenv from 'dotenv';

dotenv.config();

// Initialize Neynar client with API key from environment
const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY || '';

if (!NEYNAR_API_KEY) {
  console.warn('WARNING: NEYNAR_API_KEY not set in environment variables');
}

const neynarClient = new NeynarAPIClient(NEYNAR_API_KEY);

/**
 * Farcaster authentication context extracted from verified request
 */
export interface FarcasterContext {
  fid: number;
  signerWallet: string | null;
  custodyAddress: string | null;
  spamScore: number | null;
  username: string | null;
}

/**
 * Verify a Farcaster Frame signature and extract user context
 *
 * @param messageBytes - The frame message bytes from the request
 * @returns Verified Farcaster context with FID, signer wallet, and spam score
 * @throws Error if verification fails or message is invalid
 */
export async function verifyFrameMessage(messageBytes: string): Promise<FarcasterContext> {
  try {
    // Validate and verify the frame message using Neynar
    const { message, isValid } = await neynarClient.validateFrameAction(messageBytes);

    if (!isValid || !message) {
      throw new Error('Invalid frame message signature');
    }

    // Extract user data from the verified message
    const fid = message.data?.fid;
    if (!fid) {
      throw new Error('No FID found in frame message');
    }

    // Get additional user data including spam score
    let signerWallet: string | null = null;
    let custodyAddress: string | null = null;
    let spamScore: number | null = null;
    let username: string | null = null;

    try {
      // Fetch full user data from Neynar
      const userData = await neynarClient.fetchBulkUsers([fid]);

      if (userData.users && userData.users.length > 0) {
        const user = userData.users[0];

        // Get verified addresses (signer wallet)
        if (user.verified_addresses?.eth_addresses && user.verified_addresses.eth_addresses.length > 0) {
          signerWallet = user.verified_addresses.eth_addresses[0];
        }

        // Get custody address
        if (user.custody_address) {
          custodyAddress = user.custody_address;
        }

        // Get username
        if (user.username) {
          username = user.username;
        }

        // Get spam score (Neynar may provide this as follower_count or other trust metrics)
        // For now, we'll use follower count as a proxy for trust score
        if (user.follower_count !== undefined) {
          spamScore = user.follower_count;
        }
      }
    } catch (error) {
      console.warn(`Could not fetch additional user data for FID ${fid}:`, error);
      // Continue with just the FID - additional data is nice to have but not required
    }

    return {
      fid,
      signerWallet,
      custodyAddress,
      spamScore,
      username,
    };

  } catch (error) {
    console.error('Frame message verification failed:', error);
    throw new Error('Failed to verify Farcaster frame message');
  }
}

/**
 * Verify a Farcaster Signer (for mini app SDK)
 *
 * This is used when the client sends a signed message via the Farcaster SDK
 *
 * @param signerUuid - The signer UUID from the Farcaster SDK
 * @returns Verified Farcaster context
 * @throws Error if verification fails
 */
export async function verifySigner(signerUuid: string): Promise<FarcasterContext> {
  try {
    // Look up signer details
    const signer = await neynarClient.lookupSigner(signerUuid);

    if (!signer || !signer.fid) {
      throw new Error('Invalid signer or no FID associated');
    }

    const fid = signer.fid;

    // Get full user data
    let signerWallet: string | null = null;
    let custodyAddress: string | null = null;
    let spamScore: number | null = null;
    let username: string | null = null;

    try {
      const userData = await neynarClient.fetchBulkUsers([fid]);

      if (userData.users && userData.users.length > 0) {
        const user = userData.users[0];

        if (user.verified_addresses?.eth_addresses && user.verified_addresses.eth_addresses.length > 0) {
          signerWallet = user.verified_addresses.eth_addresses[0];
        }

        if (user.custody_address) {
          custodyAddress = user.custody_address;
        }

        if (user.username) {
          username = user.username;
        }

        if (user.follower_count !== undefined) {
          spamScore = user.follower_count;
        }
      }
    } catch (error) {
      console.warn(`Could not fetch additional user data for FID ${fid}:`, error);
    }

    return {
      fid,
      signerWallet,
      custodyAddress,
      spamScore,
      username,
    };

  } catch (error) {
    console.error('Signer verification failed:', error);
    throw new Error('Failed to verify Farcaster signer');
  }
}

/**
 * Get user data by FID
 * Useful for lookups without verification
 */
export async function getUserByFid(fid: number): Promise<FarcasterContext | null> {
  try {
    const userData = await neynarClient.fetchBulkUsers([fid]);

    if (!userData.users || userData.users.length === 0) {
      return null;
    }

    const user = userData.users[0];

    return {
      fid,
      signerWallet: user.verified_addresses?.eth_addresses?.[0] || null,
      custodyAddress: user.custody_address || null,
      spamScore: user.follower_count || null,
      username: user.username || null,
    };
  } catch (error) {
    console.error(`Failed to fetch user data for FID ${fid}:`, error);
    return null;
  }
}

export { neynarClient };

import { NeynarAPIClient, Configuration } from '@neynar/nodejs-sdk';
import * as dotenv from 'dotenv';

dotenv.config();

// Initialize Neynar client with API key from environment
const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY || '';

if (!NEYNAR_API_KEY) {
  console.warn('WARNING: NEYNAR_API_KEY not set in environment variables');
}

// SDK v2 requires Configuration object instead of direct API key
const config = new Configuration({
  apiKey: NEYNAR_API_KEY,
});

const neynarClient = new NeynarAPIClient(config);

/**
 * Farcaster authentication context extracted from verified request
 */
export interface FarcasterContext {
  fid: number;
  /** Primary wallet from Neynar (user.primary.eth_address) - preferred */
  primaryWallet: string | null;
  /** First verified ETH address (user.verified_addresses.eth_addresses[0]) - fallback */
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
  // Check if API key is configured
  if (!NEYNAR_API_KEY) {
    throw new Error('NEYNAR_API_KEY not configured - cannot verify frame messages');
  }

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
    let primaryWallet: string | null = null;
    let signerWallet: string | null = null;
    let custodyAddress: string | null = null;
    let spamScore: number | null = null;
    let username: string | null = null;

    try {
      // Fetch full user data from Neynar
      // SDK v2 requires object with fids property
      const userData = await neynarClient.fetchBulkUsers({ fids: [fid] });

      if (userData.users && userData.users.length > 0) {
        const user = userData.users[0];

        // Get primary wallet (preferred - user's designated primary address)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const userAny = user as any;
        if (userAny.primary?.eth_address) {
          primaryWallet = userAny.primary.eth_address;
        }

        // Get verified addresses (signer wallet) as fallback
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
      primaryWallet,
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
  // Check if API key is configured
  if (!NEYNAR_API_KEY) {
    throw new Error('NEYNAR_API_KEY not configured - cannot verify signers');
  }

  try {
    // Look up signer details
    const signer = await neynarClient.lookupSigner(signerUuid);

    if (!signer || !signer.fid) {
      throw new Error('Invalid signer or no FID associated');
    }

    const fid = signer.fid;

    // Get full user data
    let primaryWallet: string | null = null;
    let signerWallet: string | null = null;
    let custodyAddress: string | null = null;
    let spamScore: number | null = null;
    let username: string | null = null;

    try {
      // SDK v2 requires object with fids property
      const userData = await neynarClient.fetchBulkUsers({ fids: [fid] });

      if (userData.users && userData.users.length > 0) {
        const user = userData.users[0];

        // Get primary wallet (preferred - user's designated primary address)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const userAny = user as any;
        if (userAny.primary?.eth_address) {
          primaryWallet = userAny.primary.eth_address;
        }

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
      primaryWallet,
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
  // Check if API key is configured
  if (!NEYNAR_API_KEY) {
    console.warn(`getUserByFid: NEYNAR_API_KEY not set, cannot fetch user ${fid}`);
    return null;
  }

  try {
    // SDK v2 requires object with fids property
    const userData = await neynarClient.fetchBulkUsers({ fids: [fid] });

    if (!userData.users || userData.users.length === 0) {
      return null;
    }

    const user = userData.users[0];

    // Get primary wallet (preferred - user's designated primary address)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userAny = user as any;
    const primaryWallet = userAny.primary?.eth_address || null;

    return {
      fid,
      primaryWallet,
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

/**
 * Verify that a user recently cast content mentioning the game
 * Used to verify share bonus eligibility
 *
 * SECURITY:
 * - Only accepts casts authored by the specified FID (explicit author check)
 * - Requires the canonical game URL to be present in text or embeds
 * - Applies time window to prevent old cast reuse
 * - OG Hunter: "Cast must be created while PRELAUNCH_MODE=1" (enforced by time window)
 *
 * @param fid - Farcaster ID of the user (must match cast author)
 * @param gameUrl - The game URL that should appear in the cast (e.g., letshaveaword.fun)
 * @param lookbackMinutes - How far back to search for casts (default: 10 minutes)
 * @returns The cast hash if found, null otherwise
 */
export async function verifyRecentShareCast(
  fid: number,
  gameUrl: string = 'letshaveaword.fun',
  lookbackMinutes: number = 10
): Promise<{ castHash: string; text: string } | null> {
  if (!NEYNAR_API_KEY) {
    console.warn('[verifyRecentShareCast] NEYNAR_API_KEY not set, cannot verify cast');
    return null;
  }

  try {
    // Get user's recent casts using Neynar feed API
    // The fids filter ensures we only get casts from this user
    const response = await neynarClient.fetchFeed({
      feedType: 'filter',
      filterType: 'fids',
      fids: [fid],
      limit: 20, // Check last 20 casts
    });

    if (!response.casts || response.casts.length === 0) {
      console.log(`[verifyRecentShareCast] No casts found for FID ${fid}`);
      return null;
    }

    const cutoffTime = new Date(Date.now() - lookbackMinutes * 60 * 1000);
    const gameUrlLower = gameUrl.toLowerCase();

    // Look for a cast containing the game URL within the time window
    for (const cast of response.casts) {
      // SECURITY: Explicit author FID check (defense in depth)
      // Even though we filter by fids, verify the cast author matches
      const castAuthorFid = cast.author?.fid;
      if (castAuthorFid !== fid) {
        console.warn(`[verifyRecentShareCast] Cast author FID ${castAuthorFid} does not match requested FID ${fid}, skipping`);
        continue;
      }

      const castTime = new Date(cast.timestamp);

      // Skip casts older than the lookback window
      // For OG Hunter: this enforces "cast must be recent" which implicitly means
      // "created while prelaunch mode is active" since the campaign is time-limited
      if (castTime < cutoffTime) {
        continue;
      }

      // Check if cast text contains the CANONICAL game URL (case-insensitive)
      // Must contain the exact domain - no fuzzy matching on app name
      const textLower = (cast.text || '').toLowerCase();
      if (textLower.includes(gameUrlLower)) {
        console.log(`[verifyRecentShareCast] Found valid share cast for FID ${fid}: ${cast.hash}`);
        return {
          castHash: cast.hash,
          text: cast.text || '',
        };
      }

      // Also check embeds for the game URL
      if (cast.embeds) {
        for (const embed of cast.embeds) {
          if ('url' in embed && embed.url?.toLowerCase().includes(gameUrlLower)) {
            console.log(`[verifyRecentShareCast] Found valid share cast (via embed) for FID ${fid}: ${cast.hash}`);
            return {
              castHash: cast.hash,
              text: cast.text || '',
            };
          }
        }
      }
    }

    console.log(`[verifyRecentShareCast] No matching cast found for FID ${fid} in last ${lookbackMinutes} minutes`);
    return null;
  } catch (error) {
    console.error(`[verifyRecentShareCast] Error verifying cast for FID ${fid}:`, error);
    return null;
  }
}

export { neynarClient };

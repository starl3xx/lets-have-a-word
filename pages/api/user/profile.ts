/**
 * User Profile API
 *
 * Returns user profile info (username, pfpUrl) from Neynar
 * OPTIMIZATION: Cached for 5 minutes to reduce Neynar API calls
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neynarClient } from '../../../src/lib/farcaster';
import { cacheAside, CacheKeys, CacheTTL } from '../../../src/lib/redis';
import { db } from '../../../src/db';
import { users } from '../../../src/db/schema';
import { eq } from 'drizzle-orm';
import { isWalletFid } from '../../../src/lib/users';
import { playerDisplay } from '../../../src/lib/player-display';

export interface UserProfileResponse {
  fid: number;
  username: string;
  pfpUrl: string;
  /** Which door this player came through, so surfaces can badge it. */
  origin?: 'farcaster' | 'wallet';
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<UserProfileResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { fid } = req.query;

  if (!fid || typeof fid !== 'string') {
    return res.status(400).json({ error: 'Missing fid parameter' });
  }

  const fidNumber = parseInt(fid, 10);
  if (isNaN(fidNumber) || fidNumber <= 0) {
    return res.status(400).json({ error: 'Invalid fid parameter' });
  }

  // OPTIMIZATION: Cache profile data for 5 minutes
  // Profile data rarely changes and Neynar API calls are slow
  const profile = await cacheAside<UserProfileResponse>(
    CacheKeys.userProfile(fidNumber),
    CacheTTL.userProfile,
    async () => {
      // A wallet-native player has no Farcaster account, so Neynar can only
      // ever answer "no such user" and the old fallback rendered them as
      // "fid:1000000001" with a placeholder avatar — including in the stats
      // panel they open about themselves. Their identity lives on their own
      // row: a basename resolved from the address SIWE proved they control.
      if (isWalletFid(fidNumber)) {
        const [row] = await db
          .select({
            fid: users.fid,
            username: users.username,
            displayName: users.displayName,
            avatarUrl: users.avatarUrl,
            signerWalletAddress: users.signerWalletAddress,
            identityOrigin: users.identityOrigin,
          })
          .from(users)
          .where(eq(users.fid, fidNumber))
          .limit(1);

        const display = playerDisplay(row ?? { fid: fidNumber, identityOrigin: 'wallet' });
        return {
          fid: fidNumber,
          username: display.name,
          pfpUrl: display.avatarUrl,
          origin: display.origin,
        };
      }

      try {
        const userData = await neynarClient.fetchBulkUsers({ fids: [fidNumber] });

        if (!userData.users || userData.users.length === 0) {
          return {
            fid: fidNumber,
            username: `fid:${fidNumber}`,
            pfpUrl: `https://avatar.vercel.sh/${fidNumber}`,
          };
        }

        const user = userData.users[0];
        return {
          fid: fidNumber,
          username: user.username || `fid:${fidNumber}`,
          pfpUrl: user.pfp_url || `https://avatar.vercel.sh/${fidNumber}`,
        };
      } catch (error) {
        console.error(`[user/profile] Error fetching profile for FID ${fidNumber}:`, error);
        return {
          fid: fidNumber,
          username: `fid:${fidNumber}`,
          pfpUrl: `https://avatar.vercel.sh/${fidNumber}`,
        };
      }
    }
  );

  return res.status(200).json(profile);
}

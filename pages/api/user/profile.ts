/**
 * User Profile API
 *
 * Returns user profile info (username, pfpUrl) from Neynar
 * OPTIMIZATION: Cached for 5 minutes to reduce Neynar API calls
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neynarClient } from '../../../src/lib/farcaster';
import { cacheAside, CacheKeys, CacheTTL } from '../../../src/lib/redis';

export interface UserProfileResponse {
  fid: number;
  username: string;
  pfpUrl: string;
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

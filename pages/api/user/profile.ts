/**
 * User Profile API
 *
 * Returns user profile info (username, pfpUrl) from Neynar
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neynarClient } from '../../../src/lib/farcaster';

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

  try {
    const userData = await neynarClient.fetchBulkUsers({ fids: [fidNumber] });

    if (!userData.users || userData.users.length === 0) {
      // User not found in Neynar, return defaults
      return res.status(200).json({
        fid: fidNumber,
        username: `fid:${fidNumber}`,
        pfpUrl: `https://avatar.vercel.sh/${fidNumber}`,
      });
    }

    const user = userData.users[0];
    return res.status(200).json({
      fid: fidNumber,
      username: user.username || `fid:${fidNumber}`,
      pfpUrl: user.pfp_url || `https://avatar.vercel.sh/${fidNumber}`,
    });
  } catch (error) {
    console.error(`[user/profile] Error fetching profile for FID ${fidNumber}:`, error);
    // Return defaults on error instead of failing
    return res.status(200).json({
      fid: fidNumber,
      username: `fid:${fidNumber}`,
      pfpUrl: `https://avatar.vercel.sh/${fidNumber}`,
    });
  }
}

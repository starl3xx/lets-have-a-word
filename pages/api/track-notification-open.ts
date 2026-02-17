/**
 * Proxy endpoint for tracking notification opens with Neynar
 *
 * Client-side code can't include the API key, so we proxy the request
 * through this endpoint which adds the proper authentication.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY;

type RequestBody = {
  campaign_id: string;
  fid: number;
  app_fid?: number;
};

type SuccessResponse = {
  success: true;
};

type ErrorResponse = {
  error: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!NEYNAR_API_KEY) {
    console.error('[track-notification-open] NEYNAR_API_KEY not configured');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const { campaign_id, fid, app_fid } = req.body as RequestBody;

  if (!campaign_id || !fid) {
    return res.status(400).json({ error: 'Missing required fields: campaign_id, fid' });
  }

  try {
    const response = await fetch('https://api.neynar.com/v2/farcaster/frame/notifications/open', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': NEYNAR_API_KEY,
      },
      body: JSON.stringify({
        campaign_id,
        fid,
        ...(app_fid && { app_fid }),
      }),
    });

    if (response.ok) {
      console.log(`[track-notification-open] Tracked: campaign=${campaign_id}, fid=${fid}`);
      return res.status(200).json({ success: true });
    } else {
      const errorText = await response.text();
      console.warn(`[track-notification-open] Neynar API error ${response.status}: ${errorText}`);
      return res.status(response.status).json({ error: `Neynar API error: ${response.status}` });
    }
  } catch (error) {
    console.error('[track-notification-open] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

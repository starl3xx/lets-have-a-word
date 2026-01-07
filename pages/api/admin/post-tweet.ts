/**
 * Admin endpoint to manually post a tweet
 *
 * POST /api/admin/post-tweet
 * Body: { text: string }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from './me';
import { postTweet, convertToTwitterText } from '../../../src/lib/twitter';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth check (same pattern as other admin endpoints)
  const devFid = req.query.devFid ? parseInt(req.query.devFid as string, 10) : null;
  const fidFromCookie = req.cookies.siwn_fid ? parseInt(req.cookies.siwn_fid, 10) : null;
  const fid = devFid || fidFromCookie;

  if (!fid || !isAdminFid(fid)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { text } = req.body;

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid text' });
  }

  if (text.length > 320) {
    return res.status(400).json({ error: 'Text too long (max 320 characters)' });
  }

  try {
    const twitterText = convertToTwitterText(text);
    const result = await postTweet(text);

    if (result) {
      console.log(`[post-tweet] Tweet posted by FID ${fid}: ${result.id}`);
      return res.status(200).json({
        success: true,
        tweetId: result.id,
        postedText: twitterText,
        tweetUrl: `https://twitter.com/letshaveaword_/status/${result.id}`
      });
    } else {
      return res.status(200).json({
        success: false,
        reason: 'Twitter posting is disabled or failed (check TWITTER_ENABLED and credentials)'
      });
    }
  } catch (error) {
    console.error('[post-tweet] Error:', error);
    return res.status(500).json({
      error: 'Failed to post tweet',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Admin endpoint to manually post a tweet
 *
 * POST /api/admin/post-tweet
 * Body: { text: string }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { postTweet, convertToTwitterText } from '../../../src/lib/twitter';

// Admin FIDs allowed to use this endpoint (same as other admin endpoints)
const ADMIN_FIDS = [
  1477413, // letshaveaword
];

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Simple auth check - require admin secret or check via header
  const adminSecret = req.headers['x-admin-secret'];
  if (adminSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { text } = req.body;

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid text' });
  }

  try {
    const twitterText = convertToTwitterText(text);
    const result = await postTweet(text);

    if (result) {
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

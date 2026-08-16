/**
 * Admin endpoint to manually post a tweet
 *
 * POST /api/admin/post-tweet
 * Body: { text: string }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from './me';
import { postTweet, convertToTwitterText, getTypefullyPublishedUrl } from '../../../src/lib/twitter';

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

      // Typefully publishes asynchronously. A human is waiting on this
      // response, so poll briefly for the real x.com status URL; the draft
      // URL is only the fallback when publishing outruns the wait.
      let tweetUrl: string | undefined = (result as { url?: string }).url;
      const draftId = (result as { draftId?: number }).draftId;
      if (draftId) {
        for (let attempt = 0; attempt < 5; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          const publishedUrl = await getTypefullyPublishedUrl(draftId);
          if (publishedUrl) {
            tweetUrl = publishedUrl;
            break;
          }
        }
      } else if (!tweetUrl) {
        // Legacy X transport: the id IS the status id.
        tweetUrl = `https://twitter.com/letshaveaword_/status/${result.id}`;
      }

      return res.status(200).json({
        success: true,
        tweetId: result.id,
        postedText: twitterText,
        tweetUrl
      });
    } else {
      return res.status(200).json({
        success: false,
        reason: 'Posting is disabled or failed (check TWITTER_ENABLED and TYPEFULLY_API_KEY; Sentry has the error detail)'
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

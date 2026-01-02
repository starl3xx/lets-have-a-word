/**
 * Neynar Mentions Webhook Handler
 * Auto-likes casts that mention @letshaveaword or share the game
 *
 * Neynar sends webhook events when:
 * - Someone mentions @letshaveaword in a cast
 * - Someone embeds a letshaveaword.fun URL
 *
 * SETUP:
 * 1. Create a managed signer for @letshaveaword at https://dev.neynar.com/signers
 * 2. Store the signer UUID in LETSHAVEAWORD_SIGNER_UUID
 * 3. Create a webhook at https://dev.neynar.com/webhooks
 *    - URL: https://letshaveaword.fun/api/webhooks/neynar-mentions
 *    - Filter: cast.created with mention filter for your FID or text filter for domain
 * 4. Store the webhook secret in NEYNAR_WEBHOOK_SECRET
 *
 * SECURITY:
 * - Webhook signature verification required in production
 * - Rate limiting: max 1 like per cast hash (idempotent)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';

const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY || '';
const NEYNAR_WEBHOOK_SECRET = process.env.NEYNAR_WEBHOOK_SECRET || '';
const LETSHAVEAWORD_SIGNER_UUID = process.env.LETSHAVEAWORD_SIGNER_UUID || '';
const LETSHAVEAWORD_FID = parseInt(process.env.ANNOUNCER_FID || '1477413', 10);

// Track recently liked casts to prevent duplicates (in-memory, clears on restart)
// For production scale, use Redis
const recentlyLikedCasts = new Set<string>();
const MAX_CACHE_SIZE = 1000;

interface NeynarCastAuthor {
  fid: number;
  username?: string;
  display_name?: string;
}

interface NeynarCastEmbed {
  url?: string;
}

interface NeynarCast {
  hash: string;
  author: NeynarCastAuthor;
  text?: string;
  embeds?: NeynarCastEmbed[];
  timestamp: string;
  mentioned_profiles?: NeynarCastAuthor[];
}

interface NeynarWebhookPayload {
  created_at: number;
  type: string;
  data: NeynarCast;
}

/**
 * Verify Neynar webhook signature
 * Neynar signs webhooks with HMAC-SHA512
 */
function verifyNeynarSignature(req: NextApiRequest, body: string): boolean {
  if (!NEYNAR_WEBHOOK_SECRET) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[NeynarMentions] CRITICAL: NEYNAR_WEBHOOK_SECRET not set in production!');
      return false;
    }
    console.warn('[NeynarMentions] NEYNAR_WEBHOOK_SECRET not set - skipping verification in dev');
    return true;
  }

  const signature = req.headers['x-neynar-signature'] as string;
  if (!signature) {
    console.warn('[NeynarMentions] Missing x-neynar-signature header');
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha512', NEYNAR_WEBHOOK_SECRET)
    .update(body)
    .digest('hex');

  const isValid = crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );

  if (!isValid) {
    console.warn('[NeynarMentions] Signature verification failed');
  }

  return isValid;
}

/**
 * Like a cast using Neynar API
 */
async function likeCast(castHash: string): Promise<boolean> {
  if (!NEYNAR_API_KEY || !LETSHAVEAWORD_SIGNER_UUID) {
    console.error('[NeynarMentions] Missing NEYNAR_API_KEY or LETSHAVEAWORD_SIGNER_UUID');
    return false;
  }

  try {
    const response = await fetch('https://api.neynar.com/v2/farcaster/reaction', {
      method: 'POST',
      headers: {
        'api_key': NEYNAR_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        signer_uuid: LETSHAVEAWORD_SIGNER_UUID,
        reaction_type: 'like',
        target: castHash,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      // Don't fail on "already liked" errors
      if (errorText.includes('already') || response.status === 409) {
        console.log(`[NeynarMentions] Cast ${castHash} already liked`);
        return true;
      }
      console.error(`[NeynarMentions] Failed to like cast ${castHash}: ${response.status} ${errorText}`);
      return false;
    }

    console.log(`[NeynarMentions] Successfully liked cast ${castHash}`);
    return true;
  } catch (error) {
    console.error(`[NeynarMentions] Error liking cast ${castHash}:`, error);
    return false;
  }
}

/**
 * Check if a cast should be auto-liked
 * Requires BOTH: @letshaveaword mention AND letshaveaword.fun URL embed
 */
function shouldLikeCast(cast: NeynarCast): boolean {
  // Don't like our own casts
  if (cast.author.fid === LETSHAVEAWORD_FID) {
    return false;
  }

  // Don't like if already processed
  if (recentlyLikedCasts.has(cast.hash)) {
    return false;
  }

  // Must have @letshaveaword mention
  const mentionsUs = cast.mentioned_profiles?.some(
    (profile) => profile.fid === LETSHAVEAWORD_FID
  );
  if (!mentionsUs) {
    return false;
  }

  // Must also have letshaveaword.fun URL in text or embeds
  const textLower = (cast.text || '').toLowerCase();
  const hasUrlInText = textLower.includes('letshaveaword.fun');
  const hasUrlInEmbed = cast.embeds?.some(
    (embed) => embed.url?.toLowerCase().includes('letshaveaword.fun')
  );

  return hasUrlInText || hasUrlInEmbed;
}

/**
 * Add cast hash to recently liked set
 */
function markAsLiked(castHash: string): void {
  // Prevent unbounded growth
  if (recentlyLikedCasts.size >= MAX_CACHE_SIZE) {
    const firstItem = recentlyLikedCasts.values().next().value;
    if (firstItem) {
      recentlyLikedCasts.delete(firstItem);
    }
  }
  recentlyLikedCasts.add(castHash);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get raw body for signature verification
  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

  // Verify webhook signature
  if (!verifyNeynarSignature(req, rawBody)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const payload: NeynarWebhookPayload = typeof req.body === 'string'
      ? JSON.parse(req.body)
      : req.body;

    // Only handle cast.created events
    if (payload.type !== 'cast.created') {
      console.log(`[NeynarMentions] Ignoring event type: ${payload.type}`);
      return res.status(200).json({ success: true, action: 'ignored' });
    }

    const cast = payload.data;
    if (!cast || !cast.hash) {
      console.warn('[NeynarMentions] Invalid payload - missing cast data');
      return res.status(400).json({ error: 'Invalid payload' });
    }

    console.log(`[NeynarMentions] Received cast ${cast.hash} from @${cast.author.username || cast.author.fid}`);

    // Check if we should like this cast
    if (!shouldLikeCast(cast)) {
      console.log(`[NeynarMentions] Cast ${cast.hash} does not qualify for auto-like`);
      return res.status(200).json({ success: true, action: 'skipped' });
    }

    // Mark as processed to prevent duplicates
    markAsLiked(cast.hash);

    // Like the cast
    const liked = await likeCast(cast.hash);

    return res.status(200).json({
      success: true,
      action: liked ? 'liked' : 'failed',
      castHash: cast.hash,
    });
  } catch (error) {
    console.error('[NeynarMentions] Error processing webhook:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// Disable body parsing to get raw body for signature verification
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
};

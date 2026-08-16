/**
 * Twitter/X Cross-posting Module
 *
 * Posts announcements to @letshaveaword_ on Twitter/X
 * in sync with the Farcaster announcer bot.
 *
 * CRITICAL: This bot is COMPLETELY DISABLED in dev mode (NODE_ENV !== 'production')
 * to prevent accidental posts from non-production environments.
 */

import { TwitterApi } from 'twitter-api-v2';
import * as Sentry from '@sentry/nextjs';

// Configuration from environment variables
const TWITTER_API_KEY = process.env.TWITTER_API_KEY;
const TWITTER_API_SECRET = process.env.TWITTER_API_SECRET;
const TWITTER_ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN;
const TWITTER_ACCESS_SECRET = process.env.TWITTER_ACCESS_SECRET;
const TWITTER_ENABLED = process.env.TWITTER_ENABLED;
const TWITTER_DEBUG_LOGS = process.env.TWITTER_DEBUG_LOGS === 'true';
const NODE_ENV = process.env.NODE_ENV;

// Lazy-initialized Twitter client (only created when needed)
let twitterClient: TwitterApi | null = null;

/**
 * Get or create the Twitter API client
 */
function getTwitterClient(): TwitterApi | null {
  if (twitterClient) return twitterClient;

  if (!TWITTER_API_KEY || !TWITTER_API_SECRET || !TWITTER_ACCESS_TOKEN || !TWITTER_ACCESS_SECRET) {
    return null;
  }

  twitterClient = new TwitterApi({
    appKey: TWITTER_API_KEY,
    appSecret: TWITTER_API_SECRET,
    accessToken: TWITTER_ACCESS_TOKEN,
    accessSecret: TWITTER_ACCESS_SECRET,
  });

  return twitterClient;
}

// Startup validation (fail fast in production if misconfigured)
if (NODE_ENV === 'production' && TWITTER_ENABLED === 'true') {
  if (!TWITTER_API_KEY) {
    throw new Error('[twitter] FATAL: TWITTER_API_KEY is required when TWITTER_ENABLED=true in production');
  }
  if (!TWITTER_API_SECRET) {
    throw new Error('[twitter] FATAL: TWITTER_API_SECRET is required when TWITTER_ENABLED=true in production');
  }
  if (!TWITTER_ACCESS_TOKEN) {
    throw new Error('[twitter] FATAL: TWITTER_ACCESS_TOKEN is required when TWITTER_ENABLED=true in production');
  }
  if (!TWITTER_ACCESS_SECRET) {
    throw new Error('[twitter] FATAL: TWITTER_ACCESS_SECRET is required when TWITTER_ENABLED=true in production');
  }
}

/**
 * Check if Twitter posting is active
 *
 * CRITICAL: Returns false in any non-production environment
 */
export function twitterIsActive(): boolean {
  // Hard stop in non-production - NEVER post from dev/staging
  if (NODE_ENV !== 'production') {
    if (TWITTER_DEBUG_LOGS) {
      console.log('[twitter] inactive: NODE_ENV is not production');
    }
    return false;
  }

  // Check feature flag
  if (TWITTER_ENABLED !== 'true') {
    if (TWITTER_DEBUG_LOGS) {
      console.log('[twitter] inactive: TWITTER_ENABLED is not true');
    }
    return false;
  }

  // Check credentials are present
  const client = getTwitterClient();
  if (!client) {
    if (TWITTER_DEBUG_LOGS) {
      console.log('[twitter] inactive: missing API credentials');
    }
    return false;
  }

  return true;
}

/**
 * Convert Farcaster-style text to Twitter-friendly format
 *
 * - Removes @ mentions (they reference Farcaster users)
 * - Converts @letshaveaword to @letshaveaword_
 * - Keeps the rest intact
 */
export function convertToTwitterText(farcasterText: string): string {
  let text = farcasterText;

  // Replace @letshaveaword with @letshaveaword_ (our Twitter handle)
  text = text.replace(/@letshaveaword\b/g, '@letshaveaword_');

  // Remove other @ mentions (Farcaster usernames don't map to Twitter)
  // But preserve the text by just removing the @
  text = text.replace(/@(\w+)/g, (match, username) => {
    // Keep our own handle
    if (username === 'letshaveaword_') return match;
    // Remove @ from other mentions
    return username;
  });

  // Twitter has a 280 character limit (vs Farcaster's 320)
  //
  // Truncate at a word boundary, not mid-token. A blind slice(0, 277) cuts
  // wherever character 277 lands, and every announcer cast that names the token
  // is cross-posted through here — so a cut landing inside "$WORD" yields
  // "$WO..." and the cashtag silently stops being a cashtag on X. The milestone
  // casts carry "$WORD" mid-string and sit close to the limit, which is exactly
  // where this bites.
  if (text.length > 280) {
    const clipped = text.slice(0, 277);
    const lastBreak = clipped.search(/\s\S*$/);
    // Only back off to the boundary if one exists reasonably near the end;
    // a single 277-character token should still be cut rather than emptied.
    text = (lastBreak > 200 ? clipped.slice(0, lastBreak) : clipped).trimEnd() + '...';
  }

  return text;
}

/**
 * Post a tweet from the @letshaveaword_ account
 *
 * @param text - The tweet text (max 280 chars for Twitter)
 * @returns The tweet data, or null if Twitter is inactive
 */
export async function postTweet(
  text: string
): Promise<{ id: string } | null> {
  if (!twitterIsActive()) {
    if (TWITTER_DEBUG_LOGS) {
      console.log('[twitter] inactive (dev mode or disabled), skipping tweet:', text);
    }
    return null;
  }

  const client = getTwitterClient();
  if (!client) {
    return null;
  }

  try {
    // Convert text for Twitter format
    const twitterText = convertToTwitterText(text);

    // Post tweet using Twitter API v2
    const tweet = await client.v2.tweet(twitterText);

    if (TWITTER_DEBUG_LOGS) {
      console.log('[twitter] tweet created:', tweet.data.id);
    }

    return { id: tweet.data.id };
  } catch (error: any) {
    console.error('[twitter] ERROR: Failed to post tweet:', error);
    // Don't throw - Twitter failures should never break the game. But DO
    // report: tweets failed silently from March to August 2026 because this
    // catch was the only witness. The X API error body names the real cause
    // (expired token, revoked app, tier limit) — send it to Sentry.
    Sentry.captureMessage('[twitter] Tweet failed', {
      level: 'warning',
      tags: { component: 'twitter' },
      extra: {
        code: error?.code ?? null,
        detail: error?.data?.detail ?? error?.message ?? String(error),
        rateLimit: error?.rateLimit ?? null,
      },
    });
    return null;
  }
}

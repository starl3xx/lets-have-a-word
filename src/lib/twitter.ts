/**
 * Twitter/X Cross-posting Module
 *
 * Posts announcements to @letshaveaword_ on Twitter/X
 * in sync with the Farcaster announcer bot.
 *
 * Transport: Typefully (api.typefully.com) when TYPEFULLY_API_KEY is set —
 * the direct X API access died silently in early March 2026 (Jan 73/80
 * events tweeted, Feb 40/44, Mar onward 0/176 while casts kept posting).
 * The legacy twitter-api-v2 client remains as the fallback transport when
 * only the X credentials are configured.
 *
 * CRITICAL: This bot is COMPLETELY DISABLED in dev mode (NODE_ENV !== 'production')
 * to prevent accidental posts from non-production environments.
 */

import { TwitterApi } from 'twitter-api-v2';
import * as Sentry from '@sentry/nextjs';
import { resolveTweetMentions, mentionRegex } from './tweet-mentions';

// Configuration from environment variables
const TWITTER_API_KEY = process.env.TWITTER_API_KEY;
const TWITTER_API_SECRET = process.env.TWITTER_API_SECRET;
const TWITTER_ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN;
const TWITTER_ACCESS_SECRET = process.env.TWITTER_ACCESS_SECRET;
const TWITTER_ENABLED = process.env.TWITTER_ENABLED;
// Typefully transport (preferred). Read lazily so tests can inject env.
const getTypefullyKey = () => process.env.TYPEFULLY_API_KEY;
// The LHAW social set (Settings → API → Development mode shows the id).
const getTypefullySocialSetId = () => process.env.TYPEFULLY_SOCIAL_SET_ID || '326839';
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

// Startup validation (fail fast in production if misconfigured):
// one full transport must exist — Typefully key, or all four X credentials.
if (NODE_ENV === 'production' && TWITTER_ENABLED === 'true') {
  const hasXCreds =
    TWITTER_API_KEY && TWITTER_API_SECRET && TWITTER_ACCESS_TOKEN && TWITTER_ACCESS_SECRET;
  if (!process.env.TYPEFULLY_API_KEY && !hasXCreds) {
    throw new Error(
      '[twitter] FATAL: TWITTER_ENABLED=true needs TYPEFULLY_API_KEY or the four TWITTER_* credentials in production'
    );
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

  // Check a transport is configured (Typefully preferred, X client fallback)
  if (!getTypefullyKey() && !getTwitterClient()) {
    if (TWITTER_DEBUG_LOGS) {
      console.log('[twitter] inactive: no Typefully key and no X API credentials');
    }
    return false;
  }

  return true;
}

/**
 * Publish a single X post through Typefully (transport only — postTweet owns
 * the gating). Creates a draft in the LHAW social set scheduled ~2 minutes
 * out (never publish_at "now" — see the note at the request body);
 * Typefully publishes asynchronously, so the returned id is the Typefully
 * draft id (prefixed), not an X status id.
 */
export async function postViaTypefully(
  text: string
): Promise<{ id: string; url?: string; draftId?: number } | null> {
  const apiKey = getTypefullyKey();
  if (!apiKey) return null;

  try {
    const response = await fetch(
      `https://api.typefully.com/v2/social-sets/${getTypefullySocialSetId()}/drafts`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          platforms: { x: { enabled: true, posts: [{ text }] } },
          // NEVER 'now': Typefully 403s direct publishing of X posts that
          // contain URLs ("blocked by X policy") — which is every announcer
          // cast, and why round 34's launch tweet silently died while a
          // URL-free manual test sailed through. A short SCHEDULE goes out
          // through Typefully's own pipeline, which is allowed, URLs and
          // all (verified live against the API on launch night).
          publish_at: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
        }),
        signal: AbortSignal.timeout(15_000),
      }
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error('[twitter] Typefully error:', response.status, detail.slice(0, 300));
      Sentry.captureMessage('[twitter] Typefully publish failed', {
        level: 'warning',
        tags: { component: 'twitter', transport: 'typefully' },
        extra: { status: response.status, detail: detail.slice(0, 500) },
      });
      return null;
    }

    const body = await response.json();
    if (TWITTER_DEBUG_LOGS) {
      console.log('[twitter] Typefully draft created:', body?.id, 'state:', body?.publish_state);
    }
    return {
      id: `typefully:${body?.id ?? 'unknown'}`,
      // The draft's Typefully URL — there is no X status id yet, publish is
      // asynchronous on their side. Callers that want the real x.com link
      // poll getTypefullyPublishedUrl with draftId until publish finishes.
      url: typeof body?.private_url === 'string' ? body.private_url : undefined,
      draftId: typeof body?.id === 'number' ? body.id : undefined,
    };
  } catch (error: any) {
    console.error('[twitter] Typefully request failed:', error);
    Sentry.captureMessage('[twitter] Typefully publish failed', {
      level: 'warning',
      tags: { component: 'twitter', transport: 'typefully' },
      extra: { detail: error?.message ?? String(error) },
    });
    return null;
  }
}

/**
 * Resolve the real x.com status URL for a Typefully draft. Publishing is
 * asynchronous on their side: returns the URL once publish_state is
 * "finished" (verified live 2026-08-16 against draft 10361711), null while
 * still in progress or on any failure. Callers poll briefly and fall back
 * to the draft URL — never block a posting path on this.
 */
export async function getTypefullyPublishedUrl(draftId: number): Promise<string | null> {
  const apiKey = getTypefullyKey();
  if (!apiKey) return null;
  try {
    const response = await fetch(
      `https://api.typefully.com/v2/social-sets/${getTypefullySocialSetId()}/drafts/${draftId}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      }
    );
    if (!response.ok) return null;
    const body = await response.json();
    if (body?.publish_state !== 'finished') return null;
    return typeof body?.x_published_url === 'string' ? body.x_published_url : null;
  } catch {
    return null;
  }
}

/**
 * Convert Farcaster-style text to Twitter-friendly format
 *
 * - Converts @letshaveaword to @letshaveaword_
 * - Rewrites a player's @mention to their real X handle, when one is known and
 *   still reaches them
 * - Removes the @ from every other mention, since Farcaster usernames do not
 *   map to X
 * - Keeps the rest intact
 *
 * @param mentions Lowercased Farcaster username to live X handle. Only handles
 *   verified live belong in here; see `resolveTweetMentions`. Omitted or empty
 *   means every player mention loses its @, which is the behaviour this
 *   function had before handles could be resolved at all, and the behaviour it
 *   must fall back to whenever the lookup fails.
 */
export function convertToTwitterText(
  farcasterText: string,
  mentions?: Map<string, string>
): string {
  let text = farcasterText;

  // Replace @letshaveaword with @letshaveaword_ (our Twitter handle).
  // The lookahead, rather than \b, so a player called letshaveaword.eth is not
  // rewritten into @letshaveaword_.eth: \b sees a boundary before the dot.
  text = text.replace(/@letshaveaword(?![A-Za-z0-9_.-])/g, '@letshaveaword_');

  /**
   * The same token shape `extractMentions` uses, and it has to be.
   *
   * A Farcaster name may contain dots and hyphens and run past 15 characters;
   * a third of ours do. Matching `\w+` here would replace only the prefix and
   * leave the rest welded to the new handle, turning
   * "@dianbetty2461.base.eth" into "@theirhandle.base.eth".
   */
  text = text.replace(mentionRegex(), (match, username: string) => {
    // Keep our own handle
    if (username === 'letshaveaword_') return match;

    /**
     * A player we resolved to a live X account keeps an @, pointed at the right
     * person. Anything else loses it.
     *
     * Stripping is the safe default and stays the default: a Farcaster username
     * used verbatim on X reaches whoever holds that name there, which is
     * usually a stranger. Sampled 15 of ours and 14 were live accounts
     * belonging to other people, one with 105,653 followers.
     */
    const x = mentions?.get(username.toLowerCase());
    if (x) return `@${x}`;

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

  /**
   * Resolve player mentions to real X handles before converting.
   *
   * Done here rather than at the ~8 announcer call sites on purpose. The safe
   * behaviour has to be the default: a new announcement added next month gets
   * this without anyone remembering to ask for it, and a resolution failure
   * returns an empty map, which is exactly the plain-name output this function
   * produced before handles could be resolved at all.
   */
  const mentions = await resolveTweetMentions(text);

  // Convert text for Twitter format (both transports)
  const twitterText = convertToTwitterText(text, mentions);

  // Preferred transport: Typefully
  if (getTypefullyKey()) {
    return postViaTypefully(twitterText);
  }

  const client = getTwitterClient();
  if (!client) {
    return null;
  }

  try {
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

/**
 * X handle resolution via walletlink.social.
 *
 * ## What this is for
 *
 * The announcer builds one string and sends it to both Farcaster and X. A
 * Farcaster username is not an X handle, so "@mindlessmonk" in a tweet mentions
 * whoever holds that name on X, which is usually somebody else entirely. Of 15
 * names already tweeted, 14 resolved to live X accounts belonging to strangers.
 *
 * This module answers the only question that makes an @mention safe: does this
 * player have a real X handle, and does it still reach them?
 *
 * ## Why not Neynar, which we already pay for
 *
 * Neynar returns the handle string a user attested to Farcaster, captured once,
 * with no account id and no recheck. Nothing in the protocol notices when
 * somebody renames or is suspended. Measured across the whole protocol: about a
 * third of attested X handles reach nobody (69.6% live, 20.7% suspended, 9.7%
 * unclaimed). Neynar can tell us the handle. It cannot tell us the handle still
 * works, and that is the half that decides whether we tag a person or a ghost.
 *
 * ## Failure is always silent and always falls back
 *
 * Every function here returns null rather than throwing. A lookup that times
 * out, 500s or runs out of quota must degrade to a tweet without an @mention,
 * never to a missing tweet. This mirrors the announcer's own rule that its
 * failures never break the game.
 */

const API_BASE = 'https://walletlink.social/api/v1';

/**
 * Short on purpose. This sits on the announce path, and a slow answer is worth
 * less than a prompt tweet: the fallback copy is perfectly good, it just does
 * not tag anybody. Two seconds is far above the measured response and far below
 * anything a person would notice waiting for a post.
 */
const TIMEOUT_MS = 2000;

/** walletlink's four public states. Only one of them earns an @mention. */
export type Reachability = 'live' | 'suspended' | 'unclaimed' | 'reassigned';

export interface ResolvedX {
  handle: string;
  reachability: Reachability | null;
}

interface BatchEntry {
  wallet: string;
  twitter?: {
    handle?: string | null;
    reachable?: boolean | null;
    reachability?: string | null;
  } | null;
}

const REACHABILITY: Record<string, Reachability> = {
  live: 'live',
  suspended: 'suspended',
  unclaimed: 'unclaimed',
  reassigned: 'reassigned',
};

function apiKey(): string | null {
  return process.env.WALLETLINK_API_KEY || null;
}

/** Whether the integration is wired up at all. Absent key is not an error. */
export function isConfigured(): boolean {
  return !!apiKey();
}

/**
 * Resolve X handles for a set of wallets.
 *
 * Returns a map keyed by LOWERCASED wallet, holding only the wallets that came
 * back with a handle. A wallet absent from the map has no known X handle, which
 * is different from a failed call: on failure the whole result is null, so the
 * caller can tell "nobody has a handle" from "we could not ask" and avoid
 * writing a false negative to the database.
 *
 * Batch caps at 200 per request on our plan; callers are expected to chunk.
 */
export async function resolveXHandles(
  wallets: string[]
): Promise<Map<string, ResolvedX> | null> {
  const key = apiKey();
  if (!key || wallets.length === 0) return null;

  try {
    const res = await fetch(`${API_BASE}/batch`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ wallets }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      console.warn('[walletlink] batch lookup failed:', res.status);
      return null;
    }

    const body = (await res.json()) as { data?: Array<BatchEntry | null> };
    if (!Array.isArray(body.data)) {
      // An unrecognised shape is not an empty result. Treat it as no answer so
      // nothing is written, rather than clearing handles we already hold.
      console.warn('[walletlink] batch lookup returned an unexpected shape');
      return null;
    }

    const out = new Map<string, ResolvedX>();
    for (const entry of body.data) {
      const handle = entry?.twitter?.handle;
      if (!entry || !handle) continue;
      const raw = entry.twitter?.reachability ?? null;
      out.set(entry.wallet.toLowerCase(), {
        handle,
        reachability: raw ? (REACHABILITY[raw] ?? null) : null,
      });
    }
    return out;
  } catch (error) {
    // Includes the timeout. Never rethrow: the tweet goes out either way.
    console.warn('[walletlink] batch lookup error:', error);
    return null;
  }
}

/**
 * Whether a resolved handle may be used as an @mention in a tweet.
 *
 * Deliberately strict. `null` means we have never checked, and an unchecked
 * handle is exactly the state that produced the original bug, so it does not
 * qualify. Only a handle we looked at and found live gets the @.
 */
export function isMentionable(x: ResolvedX | null | undefined): boolean {
  return !!x && !!x.handle && x.reachability === 'live';
}

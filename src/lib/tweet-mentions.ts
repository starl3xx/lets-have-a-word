/**
 * Turn the @mentions in a cast into X handles that are safe to tweet.
 *
 * ## The namespace problem
 *
 * The announcer writes one string and sends it to Farcaster and X. Farcaster
 * usernames and X handles are separate namespaces, so "@mindlessmonk" on X
 * reaches whoever holds that name there. `convertToTwitterText` has always
 * stripped the @ for this reason, which is safe and also costs us the mention
 * for every player who does have an X account.
 *
 * This module buys the mention back for the players we can verify: it resolves
 * a Farcaster username to the player's real X handle through walletlink.social
 * and returns it only when that handle still reaches somebody.
 *
 * ## Only 'live' qualifies
 *
 * walletlink separates suspended, unclaimed and reassigned rather than
 * collapsing them into "unreachable", and the distinction matters here.
 * `unclaimed` means the handle was freed and somebody else may now hold it, so
 * mentioning it is the original bug wearing a better disguise. `null` means we
 * have never looked, which is not evidence of anything. One state earns an @.
 *
 * ## Failure returns an empty map, never throws
 *
 * An empty map degrades to exactly the behaviour this file replaced: every
 * player mention loses its @. The tweet still goes out, correctly, naming the
 * player in plain text. Nothing here is allowed to delay or block a post.
 */
import { db, users } from '../db';
import { eq, inArray, sql } from 'drizzle-orm';
import { resolveXHandles, isMentionable, isConfigured } from './walletlink';

/**
 * How long a resolved handle is trusted before we look again.
 *
 * walletlink re-checks reachability on its own daily cycle, so this governs how
 * fast we notice, not how fresh the underlying data is. A week keeps the
 * announce path off the network almost always while still catching a
 * suspension within one round cycle of it mattering.
 */
const TTL_DAYS = 7;

/** X handles are at most 15 characters; longer captures are not handles. */
const MENTION_RE = /@(\w{1,15})\b/g;

/** Names that are ours or structural, never a player to resolve. */
const RESERVED = new Set(['letshaveaword', 'letshaveaword_', 'fid']);

/**
 * Extract the Farcaster usernames a cast mentions.
 *
 * Lowercased, deduplicated, and stripped of our own handle and the `@fid:123`
 * placeholder the announcer emits when it cannot name somebody.
 */
export function extractMentions(castText: string): string[] {
  const found = new Set<string>();
  for (const m of castText.matchAll(MENTION_RE)) {
    const name = m[1].toLowerCase();
    if (!RESERVED.has(name)) found.add(name);
  }
  return [...found];
}

/**
 * Resolve a cast's mentions to live X handles.
 *
 * Returns lowercased Farcaster username to X handle, holding only the players
 * whose handle we know reaches them. Everyone else is absent, and absent means
 * "strip the @".
 */
export async function resolveTweetMentions(castText: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const names = extractMentions(castText);
  if (names.length === 0) return out;

  try {
    const rows = await db
      .select({
        fid: users.fid,
        username: users.username,
        wallet: users.signerWalletAddress,
        xHandle: users.xHandle,
        xReachability: users.xReachability,
        xCheckedAt: users.xCheckedAt,
      })
      .from(users)
      // Compared lowercased on both sides, which is why 0010 adds an index on
      // lower(username): a plain index on the raw column cannot serve this.
      .where(inArray(sql`lower(${users.username})`, names));

    const cutoff = new Date(Date.now() - TTL_DAYS * 24 * 60 * 60 * 1000);
    const stale: typeof rows = [];

    for (const row of rows) {
      if (!row.username) continue;
      const fresh = row.xCheckedAt && row.xCheckedAt > cutoff;
      if (fresh) {
        if (row.xHandle && row.xReachability === 'live') {
          out.set(row.username.toLowerCase(), row.xHandle);
        }
        continue;
      }
      stale.push(row);
    }

    if (stale.length === 0 || !isConfigured()) return out;

    const wallets = stale.map((r) => r.wallet).filter((w): w is string => !!w);
    if (wallets.length === 0) return out;

    const resolved = await resolveXHandles(wallets);
    /**
     * null means we could not ask. Nothing is written and nothing is cleared:
     * a lookup failure must not be recorded as "this player has no X account",
     * which would suppress their mention for a full TTL.
     */
    if (!resolved) return out;

    const now = new Date();
    for (const row of stale) {
      if (!row.wallet || !row.username) continue;
      const x = resolved.get(row.wallet.toLowerCase()) ?? null;

      await db
        .update(users)
        .set({
          xHandle: x?.handle ?? null,
          xReachability: x?.reachability ?? null,
          xCheckedAt: now,
        })
        .where(eq(users.fid, row.fid));

      if (isMentionable(x)) out.set(row.username.toLowerCase(), x!.handle);
    }

    return out;
  } catch (error) {
    // The tweet goes out with plain names rather than not at all.
    console.warn('[tweet-mentions] resolution failed, falling back to plain names:', error);
    return out;
  }
}

/**
 * How a player is named and pictured. One place, on purpose.
 *
 * Before this, roughly fifteen surfaces each decided for themselves, and every
 * one of them bottomed out at `fid:${fid}` for a wallet-native player — the
 * stats panel, the leaderboards, and the permanent public archive. That string
 * is not merely ugly: it is meaningless to the person it names, and `user-<fid>`
 * (the other fallback in the codebase) is the exact naming fingerprint the
 * round-28 farm wave carried, so it makes real players look like bots.
 *
 * THE ORDER, and why:
 *   1. A Farcaster username, for a Farcaster player. Neynar is authoritative
 *      there and nothing else should override it.
 *   2. A basename, for a wallet player. Resolved from the address SIWE proved
 *      they control, stored on their row (see src/lib/basename.ts).
 *   3. A truncated address. True, verifiable, and recognisable to its owner.
 *   4. The fid, only when there is no address at all — a case that should not
 *      exist for a wallet player and means something upstream is broken.
 *
 * `origin` rides along so a surface can badge which door a player came through
 * without re-deriving it from fid ranges.
 */

// From ./wallet-fid, not ./users: this module is imported by client
// components, and users.ts pulls in the database layer.
import { isWalletFid } from './wallet-fid';
import { shortenAddress } from './basename';

export interface PlayerDisplay {
  /** What to render as the player's name. Never empty. */
  name: string;
  /** Avatar URL. Always set: falls back to a deterministic generated image. */
  avatarUrl: string;
  /** Which door this player came through, for badging. */
  origin: 'farcaster' | 'wallet';
  /** True when `name` is a truncated address rather than a real name. */
  isAddressFallback: boolean;
}

export interface PlayerDisplaySource {
  fid: number;
  username?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  signerWalletAddress?: string | null;
  identityOrigin?: string | null;
  /** A Neynar avatar, when the caller already has one. */
  pfpUrl?: string | null;
}

/**
 * A deterministic avatar for a player with no picture of their own.
 *
 * Keyed on the WALLET where there is one, so a player's generated avatar is
 * stable across any future identity change and is the same image anyone else
 * would generate for that address. Falls back to the fid otherwise, which is
 * what the profile endpoint already did.
 */
export function fallbackAvatarUrl(source: PlayerDisplaySource): string {
  const key = source.signerWalletAddress?.toLowerCase() || String(source.fid);
  return `https://avatar.vercel.sh/${key}`;
}

/**
 * The name as it should appear inline.
 *
 * "@" IS A FARCASTER THING. A Farcaster username is a handle and reads
 * naturally with the prefix; a basename is a name, not a handle, and
 * "@starl3xx.base.eth" is simply wrong — it also implies a mention that would
 * resolve to nobody. A truncated address obviously takes no prefix either.
 *
 * The rule keys on ORIGIN rather than on the shape of the string, because
 * Farcaster usernames can themselves look like names (vitalik.eth is a valid
 * one), so a dot cannot be the discriminator.
 */
export function playerLabel(
  // Deliberately a narrow shape rather than the whole PlayerDisplay: the
  // client receives these three fields from an API and should be able to call
  // the real helper instead of reimplementing the rule from what it happens to
  // have. An inlined copy is how this rule silently diverged once already —
  // and an inline copy cannot see isAddressFallback, so it put an "@" on a
  // truncated address (Bugbot, PR #291).
  display: Pick<PlayerDisplay, 'name' | 'origin' | 'isAddressFallback'>
): string {
  if (display.origin === 'farcaster' && !display.isAddressFallback && !display.name.startsWith('fid:')) {
    return display.name.startsWith('@') ? display.name : `@${display.name}`;
  }
  return display.name;
}

export function playerDisplay(source: PlayerDisplaySource): PlayerDisplay {
  const origin: 'farcaster' | 'wallet' =
    source.identityOrigin === 'wallet' || isWalletFid(source.fid) ? 'wallet' : 'farcaster';

  const avatarUrl = source.avatarUrl || source.pfpUrl || fallbackAvatarUrl(source);

  if (origin === 'farcaster') {
    const username = source.username?.trim();
    // Two non-names to reject, so no caller has to know about either:
    //   `user-<fid>` is a placeholder this codebase writes when Neynar knows
    //     nothing, and is the round-28 farm fingerprint besides;
    //   `!12345` is Farcaster's own placeholder for an account it cannot
    //     resolve, which several call sites special-cased by hand.
    if (username && !/^user-?\d+$/.test(username) && !username.startsWith('!')) {
      return { name: username, avatarUrl, origin, isAddressFallback: false };
    }
  }

  const basename = source.displayName?.trim();
  if (basename) {
    return { name: basename, avatarUrl, origin, isAddressFallback: false };
  }

  const wallet = source.signerWalletAddress?.trim();
  if (wallet) {
    return { name: shortenAddress(wallet), avatarUrl, origin, isAddressFallback: true };
  }

  // Nothing to name them by. For a wallet player this cannot happen — the row
  // is created from an address — so it means something upstream is broken.
  return { name: `fid:${source.fid}`, avatarUrl, origin, isAddressFallback: false };
}

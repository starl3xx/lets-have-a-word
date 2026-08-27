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

import { isWalletFid } from './users';
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

export function playerDisplay(source: PlayerDisplaySource): PlayerDisplay {
  const origin: 'farcaster' | 'wallet' =
    source.identityOrigin === 'wallet' || isWalletFid(source.fid) ? 'wallet' : 'farcaster';

  const avatarUrl = source.avatarUrl || source.pfpUrl || fallbackAvatarUrl(source);

  if (origin === 'farcaster') {
    const username = source.username?.trim();
    // `user-<fid>` is a placeholder this codebase writes when Neynar knows
    // nothing; it is not a name and must not be rendered as one.
    if (username && !/^user-?\d+$/.test(username)) {
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

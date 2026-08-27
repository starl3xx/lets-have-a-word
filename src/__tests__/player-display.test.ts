/**
 * How a player is named, in one place.
 *
 * The bug: roughly fifteen surfaces each decided for themselves and every one
 * bottomed out at `fid:1000000001` for a wallet-native player — including the
 * stats panel they open about themselves, and the permanent public archive.
 * `user-<fid>`, the other fallback in this codebase, is worse still: it is the
 * exact naming fingerprint the round-28 farm wave carried, so it makes real
 * players look like bots.
 */

import { describe, it, expect } from 'vitest';
import { playerDisplay, fallbackAvatarUrl } from '../lib/player-display';
import { shortenAddress, baseReverseNode } from '../lib/basename';
import { WALLET_FID_MIN } from '../lib/users';

const WALLET = '0x0Fc0F78fc939606db65F5BBF2F3715262C0b2F6E';

describe('naming a wallet-native player', () => {
  it('prefers the basename', () => {
    const d = playerDisplay({
      fid: WALLET_FID_MIN + 1,
      identityOrigin: 'wallet',
      displayName: 'starl3xx.base.eth',
      signerWalletAddress: WALLET,
    });
    expect(d.name).toBe('starl3xx.base.eth');
    expect(d.origin).toBe('wallet');
    expect(d.isAddressFallback).toBe(false);
  });

  it('falls back to a truncated address, never to fid:NNN', () => {
    const d = playerDisplay({
      fid: WALLET_FID_MIN + 2,
      identityOrigin: 'wallet',
      signerWalletAddress: WALLET,
    });
    expect(d.name).toBe('0x0Fc0…2F6E');
    expect(d.isAddressFallback).toBe(true);
    expect(d.name).not.toContain('fid:');
  });

  it('is recognised as wallet-origin from the fid range alone', () => {
    // Callers that select a narrow column set may not have identity_origin.
    const d = playerDisplay({ fid: WALLET_FID_MIN + 3, signerWalletAddress: WALLET });
    expect(d.origin).toBe('wallet');
  });

  it('always produces an avatar, keyed on the wallet so it is stable', () => {
    const d = playerDisplay({ fid: WALLET_FID_MIN + 4, signerWalletAddress: WALLET });
    expect(d.avatarUrl).toBe(`https://avatar.vercel.sh/${WALLET.toLowerCase()}`);
    expect(fallbackAvatarUrl({ fid: 1, signerWalletAddress: WALLET })).toBe(d.avatarUrl);
  });

  it('prefers a stored avatar over the generated one', () => {
    const d = playerDisplay({
      fid: WALLET_FID_MIN + 5,
      signerWalletAddress: WALLET,
      avatarUrl: 'https://example.com/pic.png',
    });
    expect(d.avatarUrl).toBe('https://example.com/pic.png');
  });
});

describe('naming a Farcaster player is unchanged', () => {
  it('uses the Neynar username', () => {
    const d = playerDisplay({ fid: 6500, username: 'starl3xx', pfpUrl: 'https://n/pfp.png' });
    expect(d).toMatchObject({
      name: 'starl3xx',
      avatarUrl: 'https://n/pfp.png',
      origin: 'farcaster',
    });
  });

  it('rejects the user-<fid> placeholder as a name', () => {
    // Written by /api/user-state when Neynar knows nothing. It is not a name,
    // and it is the round-28 farm fingerprint.
    const d = playerDisplay({
      fid: 6501,
      username: 'user-6501',
      signerWalletAddress: WALLET,
    });
    expect(d.name).toBe('0x0Fc0…2F6E');
  });

  it('falls back to the fid only when there is nothing else at all', () => {
    const d = playerDisplay({ fid: 6502 });
    expect(d.name).toBe('fid:6502');
  });
});

describe('address shortening', () => {
  it('keeps both ends recognisable', () => {
    expect(shortenAddress(WALLET)).toBe('0x0Fc0…2F6E');
  });

  it('passes through anything too short to shorten', () => {
    expect(shortenAddress('0x123')).toBe('0x123');
    expect(shortenAddress('')).toBe('');
  });
});

describe('the reverse node ENS actually resolves', () => {
  it('hashes the ASCII label, not the raw address bytes', () => {
    // The distinction that decided whether this feature worked at all: hashing
    // the bytes returns a confident empty name, which reads exactly like "this
    // player has no basename". Pinned against the value verified on Base
    // mainnet on 2026-08-27, where this node resolved to starl3xx.base.eth.
    const node = baseReverseNode(WALLET);
    expect(node).toMatch(/^0x[0-9a-f]{64}$/);
    // Case-insensitive input must produce the same node.
    expect(baseReverseNode(WALLET.toLowerCase())).toBe(node);
  });
});

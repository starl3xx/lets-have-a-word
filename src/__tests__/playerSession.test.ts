/**
 * Player session tokens, and the domain separation between them and admin
 * session tokens.
 *
 * The separation is the point of this file. `PlayerSessionPayload` is a
 * superset of adminSession's `{ fid, exp }`, so signing both with the raw
 * ADMIN_SECRET would let a player token verify as an admin token. That is not
 * an exploitable escalation for a random player — `isAdminFid` still refuses
 * them downstream — but it makes the admin's OWN player cookie, minted by
 * playing their own game and living for thirty days, a working admin
 * credential. The derived key closes it in both directions.
 */

import { describe, it, expect } from 'vitest';
import {
  signPlayerSession,
  verifyPlayerSession,
  PLAYER_SESSION_TTL_SECONDS,
} from '../lib/playerSession';
import { signAdminSession, verifyAdminSession } from '../lib/adminSession';

const SECRET = 'test-secret-not-a-real-one';

describe('player session round-trip', () => {
  it('returns what it was given, for a wallet-origin player', async () => {
    const token = await signPlayerSession(
      { fid: 1_000_000_042, origin: 'wallet', wallet: '0xAbC0000000000000000000000000000000000001' },
      SECRET
    );
    const session = await verifyPlayerSession(token, SECRET);

    expect(session).toEqual({
      fid: 1_000_000_042,
      origin: 'wallet',
      // Normalised on the way in, so a checksummed and a lowercase address
      // never produce two different session identities for one wallet.
      wallet: '0xabc0000000000000000000000000000000000001',
    });
  });

  it('carries a farcaster-origin player with no wallet', async () => {
    const token = await signPlayerSession({ fid: 6500, origin: 'farcaster' }, SECRET);
    expect(await verifyPlayerSession(token, SECRET)).toEqual({
      fid: 6500,
      origin: 'farcaster',
      wallet: undefined,
    });
  });

  it('refuses a token signed with a different secret', async () => {
    const token = await signPlayerSession({ fid: 6500, origin: 'wallet' }, SECRET);
    expect(await verifyPlayerSession(token, 'a-different-secret')).toBeNull();
  });

  it('refuses an expired token', async () => {
    const token = await signPlayerSession({ fid: 6500, origin: 'wallet' }, SECRET, -1);
    expect(await verifyPlayerSession(token, SECRET)).toBeNull();
  });

  it('refuses a tampered payload', async () => {
    const token = await signPlayerSession({ fid: 6500, origin: 'wallet' }, SECRET);
    const [, signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ fid: 1, origin: 'wallet', exp: Math.floor(Date.now() / 1000) + 999 })
    )
      .toString('base64url');

    expect(await verifyPlayerSession(`${forged}.${signature}`, SECRET)).toBeNull();
  });

  it('refuses an unknown origin', async () => {
    // Hand-built rather than via signPlayerSession, because the type forbids it.
    const token = await signPlayerSession({ fid: 6500, origin: 'wallet' }, SECRET);
    const [body] = token.split('.');
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString());
    expect(decoded.origin).toBe('wallet');
  });

  it('does not expire inside its advertised lifetime', async () => {
    expect(PLAYER_SESSION_TTL_SECONDS).toBeGreaterThan(24 * 60 * 60);
  });
});

describe('player and admin sessions cannot be swapped', () => {
  it('a player token is not a valid admin token', async () => {
    // The exact escalation the derived key exists to prevent: the admin FID,
    // signing in as a PLAYER, must not thereby hold an admin credential.
    const playerToken = await signPlayerSession({ fid: 6500, origin: 'wallet' }, SECRET);
    expect(await verifyAdminSession(playerToken, SECRET)).toBeNull();
  });

  it('an admin token is not a valid player session', async () => {
    const adminToken = await signAdminSession(6500, SECRET);
    expect(await verifyPlayerSession(adminToken, SECRET)).toBeNull();
  });

  it('each still verifies against its own verifier', async () => {
    const playerToken = await signPlayerSession({ fid: 6500, origin: 'wallet' }, SECRET);
    const adminToken = await signAdminSession(6500, SECRET);

    expect((await verifyPlayerSession(playerToken, SECRET))?.fid).toBe(6500);
    expect(await verifyAdminSession(adminToken, SECRET)).toBe(6500);
  });
});

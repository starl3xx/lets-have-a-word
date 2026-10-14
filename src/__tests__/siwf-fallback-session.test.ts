/**
 * The Quick Auth fallback session from /api/auth/verify.
 *
 * From 01:00 UTC on 2026-10-14 Farcaster's Quick Auth server answered 500 to
 * every player who opened the game, so no Farcaster guess could carry a JWT.
 * The fallback has the host sign the same Sign In With Farcaster message with
 * our nonce, and this endpoint checks it itself and returns a player session.
 *
 * The signature check is mocked. `@farcaster/auth-client` owns it, and a real
 * check needs Optimism. What is under test is what this endpoint does around
 * it: the session goes only to a signature that passed, only when asked for,
 * for exactly the FID that signed, for one hour, and admin sign-in is
 * unchanged.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const { mockVerifyMessage, mockConsumeNonce, mockUpsert } = vi.hoisted(() => ({
  mockVerifyMessage: vi.fn(),
  mockConsumeNonce: vi.fn(),
  mockUpsert: vi.fn(),
}));

vi.mock('@farcaster/auth-client', () => ({
  createAppClient: () => ({ verifySignInMessage: mockVerifyMessage }),
  viemConnector: () => ({}),
}));

vi.mock('../../pages/api/auth/nonce', () => ({
  verifyAndConsumeNonce: mockConsumeNonce,
}));

vi.mock('../../pages/api/admin/me', () => ({
  isAdminFid: (fid: number) => fid === ADMIN_FID,
}));

vi.mock('../lib/users', () => ({
  upsertUserFromFarcaster: mockUpsert,
}));

import handler from '../../pages/api/auth/verify';
import { inspectPlayerSession, PLAYER_SESSION_HEADER } from '../lib/playerSession';
import { resolveRequestFid } from '../lib/requestAuth';

const SECRET = 'test-secret-not-a-real-one';
const PLAYER_FID = 424242;
const ADMIN_FID = 5150;
const originalSecret = process.env.ADMIN_SECRET;

function post(body: Record<string, unknown>) {
  return new Promise<{ status: number; body: any; cookies: string[] }>((resolve) => {
    let status = 200;
    const cookies: string[] = [];
    const res = {
      status(c: number) {
        status = c;
        return this;
      },
      json(payload: unknown) {
        resolve({ status, body: payload, cookies });
        return this;
      },
      setHeader(name: string, value: string) {
        if (name.toLowerCase() === 'set-cookie') cookies.push(value);
        return this;
      },
    };
    handler(
      { method: 'POST', body, headers: {}, cookies: {}, query: {} } as unknown as NextApiRequest,
      res as unknown as NextApiResponse
    );
  });
}

const signedIn = (overrides: Record<string, unknown> = {}) => ({
  message: 'letshaveaword.fun wants you to sign in…',
  signature: '0x' + 'ab'.repeat(65),
  nonce: 'abcdef0123456789',
  ...overrides,
});

/** The token's own exp, read from its payload. */
function expiresInSeconds(token: string): number {
  const body = token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
  const payload = JSON.parse(Buffer.from(body, 'base64').toString('utf8')) as { exp: number };
  return payload.exp - Math.floor(Date.now() / 1000);
}

beforeEach(() => {
  process.env.ADMIN_SECRET = SECRET;
  mockConsumeNonce.mockReset().mockResolvedValue(true);
  mockVerifyMessage.mockReset().mockResolvedValue({ success: true, fid: PLAYER_FID, isError: false });
  mockUpsert.mockReset().mockResolvedValue({ fid: PLAYER_FID });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalSecret === undefined) delete process.env.ADMIN_SECRET;
  else process.env.ADMIN_SECRET = originalSecret;
});

describe('/api/auth/verify player session', () => {
  it('gives a one-hour Farcaster session to a signature that passed', async () => {
    const result = await post(signedIn({ playerSession: true }));

    expect(result.status).toBe(200);
    expect(result.body.fid).toBe(PLAYER_FID);
    const inspection = await inspectPlayerSession(result.body.sessionToken, SECRET);
    expect(inspection).toEqual({
      ok: true,
      session: { fid: PLAYER_FID, origin: 'farcaster', wallet: undefined },
    });
    const ttl = expiresInSeconds(result.body.sessionToken);
    expect(ttl).toBeGreaterThan(55 * 60);
    expect(ttl).toBeLessThanOrEqual(60 * 60);
  });

  it('checks the signature against our domain and the nonce it just spent', async () => {
    await post(signedIn({ playerSession: true }));

    expect(mockConsumeNonce).toHaveBeenCalledWith('abcdef0123456789');
    expect(mockVerifyMessage).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'letshaveaword.fun', nonce: 'abcdef0123456789' })
    );
  });

  it('sends the token in the body only, never as a cookie', async () => {
    const result = await post(signedIn({ playerSession: true }));
    expect(result.body.sessionToken).toBeTruthy();
    expect(result.cookies).toEqual([]);
  });

  it('gives nothing to a signature that did not pass', async () => {
    mockVerifyMessage.mockResolvedValue({ isError: true, error: new Error('unauthorized') });

    const result = await post(signedIn({ playerSession: true }));

    expect(result.status).toBe(401);
    expect(result.body.sessionToken).toBeUndefined();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('refuses a nonce that is spent or unknown before it checks anything', async () => {
    mockConsumeNonce.mockResolvedValue(false);

    const result = await post(signedIn({ playerSession: true }));

    expect(result.status).toBe(400);
    expect(result.body.sessionToken).toBeUndefined();
    expect(mockVerifyMessage).not.toHaveBeenCalled();
  });

  it('leaves admin sign-in as it was when no session is asked for', async () => {
    mockVerifyMessage.mockResolvedValue({ success: true, fid: ADMIN_FID, isError: false });

    const result = await post(signedIn());

    expect(result.status).toBe(200);
    expect(result.body.adminSession).toBe(true);
    expect(result.body.sessionToken).toBeUndefined();
    expect(result.cookies).toHaveLength(1);
    expect(result.cookies[0]).toMatch(/^admin_session=/);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('creates the player row first, with the referrer', async () => {
    await post(signedIn({ playerSession: true, ref: 777 }));

    expect(mockUpsert).toHaveBeenCalledWith({
      fid: PLAYER_FID,
      signerWallet: null,
      spamScore: null,
      referrerFid: 777,
    });
  });

  it('drops a referrer that is not a positive whole number', async () => {
    await post(signedIn({ playerSession: true, ref: '12abc' }));
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ referrerFid: null }));
  });

  it('reports success without a token when the row cannot be written', async () => {
    mockUpsert.mockRejectedValue(new Error('db down'));

    const result = await post(signedIn({ playerSession: true }));

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.sessionToken).toBeUndefined();
  });

  it('gives no token when ADMIN_SECRET is not set', async () => {
    delete process.env.ADMIN_SECRET;

    const result = await post(signedIn({ playerSession: true }));

    expect(result.status).toBe(200);
    expect(result.body.sessionToken).toBeUndefined();
  });

  it('is accepted by the guess path as that player, and only that player', async () => {
    const result = await post(signedIn({ playerSession: true }));

    const auth = await resolveRequestFid(
      {
        method: 'POST',
        body: { word: 'FUMES' },
        headers: { [PLAYER_SESSION_HEADER]: result.body.sessionToken },
        cookies: {},
        query: {},
      } as unknown as NextApiRequest,
      { rejectUnverifiedMiniAppFid: true }
    );

    expect(auth).toMatchObject({
      ok: true,
      fid: PLAYER_FID,
      origin: 'player_session',
      playerOrigin: 'farcaster',
    });
    expect(auth.ok && auth.provenWallet).toBeFalsy();
  });
});

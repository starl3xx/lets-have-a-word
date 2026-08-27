/**
 * GET /api/auth/me — the only way the client can learn whether it holds a
 * session, since the cookie is HttpOnly by design.
 *
 * The behaviour that matters is the refusal: an absent session, an expired one
 * and a forged one must all look identical from outside. If they did not, the
 * endpoint would be an oracle for probing which cookies are worth attacking.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '../../pages/api/auth/me';
import { signPlayerSession, PLAYER_SESSION_COOKIE } from '../lib/playerSession';

const SECRET = 'test-secret-not-a-real-one';
const originalSecret = process.env.ADMIN_SECRET;

beforeEach(() => {
  process.env.ADMIN_SECRET = SECRET;
});
afterEach(() => {
  if (originalSecret === undefined) delete process.env.ADMIN_SECRET;
  else process.env.ADMIN_SECRET = originalSecret;
});

function run(
  cookies: Record<string, string>,
  method = 'GET',
  requestHeaders: Record<string, string> = {}
) {
  return new Promise<{ status: number; body: any; headers: Record<string, string> }>((resolve) => {
    let status = 200;
    // Response-header capture — deliberately distinct from requestHeaders; a
    // same-named local here once shadowed the parameter and silently dropped
    // every request header on the floor.
    const headers: Record<string, string> = {};
    const res = {
      status(c: number) {
        status = c;
        return this;
      },
      json(body: unknown) {
        resolve({ status, body, headers });
        return this;
      },
      setHeader(k: string, v: string) {
        headers[k] = v;
        return this;
      },
      end() {
        return this;
      },
    };
    handler(
      { method, cookies, headers: requestHeaders } as unknown as NextApiRequest,
      res as unknown as NextApiResponse
    );
  });
}

describe('a valid session', () => {
  it('reports the fid, origin and wallet', async () => {
    const token = await signPlayerSession(
      { fid: 1_000_000_020, origin: 'wallet', wallet: '0xAbC0000000000000000000000000000000000011' },
      SECRET
    );
    const { status, body } = await run({ [PLAYER_SESSION_COOKIE]: token });

    expect(status).toBe(200);
    expect(body).toEqual({
      fid: 1_000_000_020,
      origin: 'wallet',
      wallet: '0xabc0000000000000000000000000000000000011',
    });
  });

  it('answers from the header token when a dead cookie shadows it', async () => {
    // The 2026-08-27 lockout: Base App's webview jar pinned a dead cookie it
    // would neither update nor drop, and the first-token-wins resolver let it
    // veto the freshly minted header token — "signed in" here, 401 on every
    // guess, sign-in card again, forever.
    const deadCookie = await signPlayerSession({ fid: 1_000_000_022, origin: 'wallet' }, 'old-rotated-secret');
    const liveHeader = await signPlayerSession(
      { fid: 1_000_000_023, origin: 'wallet', wallet: '0xAbC0000000000000000000000000000000000012' },
      SECRET
    );
    const { status, body } = await run({ [PLAYER_SESSION_COOKIE]: deadCookie }, 'GET', {
      'x-player-session': liveHeader,
    });

    expect(status).toBe(200);
    expect(body.fid).toBe(1_000_000_023);
  });

  it('is never cached — a minted or expired session must not be served stale', async () => {
    const token = await signPlayerSession({ fid: 1_000_000_021, origin: 'wallet' }, SECRET);
    const { headers } = await run({ [PLAYER_SESSION_COOKIE]: token });
    expect(headers['Cache-Control']).toContain('no-store');
    expect(headers['Cache-Control']).toContain('private');
  });
});

describe('every refusal looks the same from outside', () => {
  const expected = { status: 401, body: { error: 'Not signed in' } };

  it('no cookie at all', async () => {
    expect(await run({})).toMatchObject(expected);
  });

  it('an expired session', async () => {
    const token = await signPlayerSession({ fid: 1_000_000_022, origin: 'wallet' }, SECRET, -1);
    expect(await run({ [PLAYER_SESSION_COOKIE]: token })).toMatchObject(expected);
  });

  it('a session signed with the wrong secret', async () => {
    const token = await signPlayerSession({ fid: 1_000_000_023, origin: 'wallet' }, 'other');
    expect(await run({ [PLAYER_SESSION_COOKIE]: token })).toMatchObject(expected);
  });

  it('outright garbage', async () => {
    expect(await run({ [PLAYER_SESSION_COOKIE]: 'not.a.token' })).toMatchObject(expected);
  });

  it('no server secret configured', async () => {
    const token = await signPlayerSession({ fid: 1_000_000_024, origin: 'wallet' }, SECRET);
    delete process.env.ADMIN_SECRET;
    expect(await run({ [PLAYER_SESSION_COOKIE]: token })).toMatchObject(expected);
  });
});

describe('method guard', () => {
  it('refuses anything but GET', async () => {
    expect(await run({}, 'POST')).toMatchObject({ status: 405 });
  });
});

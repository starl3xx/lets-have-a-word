/**
 * resolveRequestFid — the single answer to "who is making this request?"
 *
 * The point of these tests is the ORDER, not the individual branches. Three
 * endpoints currently run three different auth chains, and Base App adds a
 * fourth kind of caller. What must not happen is that adding the wallet path
 * quietly changes how a Farcaster player is resolved, so the cases that matter
 * most here are the ones asserting Quick Auth still wins and that a bare
 * miniAppFid is still a hard refusal.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextApiRequest } from 'next';
import { resolveRequestFid } from '../lib/requestAuth';
import {
  signPlayerSession,
  PLAYER_SESSION_COOKIE,
  PLAYER_SESSION_HEADER,
} from '../lib/playerSession';

const SECRET = 'test-secret-not-a-real-one';

function makeReq(init: {
  body?: Record<string, unknown>;
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}): NextApiRequest {
  return {
    body: init.body ?? {},
    cookies: init.cookies ?? {},
    headers: init.headers ?? {},
    query: init.query ?? {},
  } as unknown as NextApiRequest;
}

/** Never let a test reach the real JWT verifier. */
const verifyOk = (fid: number) => vi.fn(async () => fid);
const verifyBad = vi.fn(async () => null);

const originalDevMode = process.env.NEXT_PUBLIC_LHAW_DEV_MODE;
const originalSecret = process.env.ADMIN_SECRET;

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_LHAW_DEV_MODE;
  process.env.ADMIN_SECRET = SECRET;
});

afterEach(() => {
  if (originalDevMode === undefined) delete process.env.NEXT_PUBLIC_LHAW_DEV_MODE;
  else process.env.NEXT_PUBLIC_LHAW_DEV_MODE = originalDevMode;
  if (originalSecret === undefined) delete process.env.ADMIN_SECRET;
  else process.env.ADMIN_SECRET = originalSecret;
});

describe('Quick Auth is unchanged and still wins', () => {
  it('resolves a valid JWT to its FID', async () => {
    const result = await resolveRequestFid(makeReq({ body: { authToken: 'jwt' } }), {
      verifyQuickAuthToken: verifyOk(6500),
    });
    expect(result).toMatchObject({ ok: true, fid: 6500, origin: 'quick_auth' });
  });

  it('accepts the token from an Authorization: Bearer header too', async () => {
    const result = await resolveRequestFid(
      makeReq({ headers: { authorization: 'Bearer jwt' } }),
      { verifyQuickAuthToken: verifyOk(4242) }
    );
    expect(result).toMatchObject({ ok: true, fid: 4242, origin: 'quick_auth' });
  });

  it('BEATS a player session when both are presented', async () => {
    // A Farcaster player who has also signed a SIWE message at some point must
    // still be resolved by the fresher, stronger credential — same as today.
    const token = await signPlayerSession({ fid: 1_000_000_001, origin: 'wallet' }, SECRET);
    const result = await resolveRequestFid(
      makeReq({ body: { authToken: 'jwt' }, cookies: { [PLAYER_SESSION_COOKIE]: token } }),
      { verifyQuickAuthToken: verifyOk(6500) }
    );
    expect(result).toMatchObject({ ok: true, fid: 6500, origin: 'quick_auth' });
  });

  it('rejects a bad JWT rather than falling through to anything else', async () => {
    const token = await signPlayerSession({ fid: 1_000_000_001, origin: 'wallet' }, SECRET);
    const result = await resolveRequestFid(
      makeReq({ body: { authToken: 'bad' }, cookies: { [PLAYER_SESSION_COOKIE]: token } }),
      { verifyQuickAuthToken: verifyBad }
    );
    expect(result).toMatchObject({ ok: false, status: 401, reason: 'invalid_credential' });
  });

  it('rejects when the verifier throws', async () => {
    const result = await resolveRequestFid(makeReq({ body: { authToken: 'x' } }), {
      verifyQuickAuthToken: async () => {
        throw new Error('network');
      },
    });
    expect(result).toMatchObject({ ok: false, status: 401, reason: 'invalid_credential' });
  });
});

describe('the unverified miniAppFid refusal survives', () => {
  it('still 401s a bare miniAppFid', async () => {
    const result = await resolveRequestFid(makeReq({ body: { miniAppFid: 9999 } }), {
      rejectUnverifiedMiniAppFid: true,
    });
    expect(result).toMatchObject({ ok: false, status: 401, reason: 'unverified_miniapp_fid' });
  });

  it('still 401s it even when a valid wallet session is also present', async () => {
    // Deliberate: the refusal sits AHEAD of the session check, so a
    // security-sensitive branch keeps its exact previous behaviour. A real Base
    // App client never sends miniAppFid, so this costs wallet players nothing.
    const token = await signPlayerSession({ fid: 1_000_000_002, origin: 'wallet' }, SECRET);
    const result = await resolveRequestFid(
      makeReq({ body: { miniAppFid: 9999 }, cookies: { [PLAYER_SESSION_COOKIE]: token } }),
      { rejectUnverifiedMiniAppFid: true }
    );
    expect(result).toMatchObject({ ok: false, reason: 'unverified_miniapp_fid' });
  });

  it('ignores miniAppFid for endpoints that never receive it', async () => {
    const result = await resolveRequestFid(makeReq({ body: { miniAppFid: 9999 } }), {});
    expect(result).toMatchObject({ ok: false, reason: 'no_credential' });
  });
});

describe('wallet-native players', () => {
  it('resolves a valid session cookie, carrying the proven wallet', async () => {
    const token = await signPlayerSession(
      { fid: 1_000_000_003, origin: 'wallet', wallet: '0xAbC0000000000000000000000000000000000009' },
      SECRET
    );
    const result = await resolveRequestFid(
      makeReq({ cookies: { [PLAYER_SESSION_COOKIE]: token } }),
      {}
    );
    expect(result).toMatchObject({
      ok: true,
      fid: 1_000_000_003,
      origin: 'player_session',
      provenWallet: '0xabc0000000000000000000000000000000000009',
      playerOrigin: 'wallet',
    });
  });

  it('reads the cookie from a raw header when nothing pre-parsed it', async () => {
    const token = await signPlayerSession({ fid: 1_000_000_004, origin: 'wallet' }, SECRET);
    const result = await resolveRequestFid(
      makeReq({ headers: { cookie: `other=1; ${PLAYER_SESSION_COOKIE}=${token}; z=2` } }),
      {}
    );
    expect(result).toMatchObject({ ok: true, fid: 1_000_000_004, origin: 'player_session' });
  });

  it('treats an expired session as no credential, so callers may fall through', async () => {
    const token = await signPlayerSession({ fid: 1_000_000_005, origin: 'wallet' }, SECRET, -1);
    const result = await resolveRequestFid(
      makeReq({ cookies: { [PLAYER_SESSION_COOKIE]: token } }),
      {}
    );
    // presentedSessionToken lets telemetry tell "player lost their session"
    // from "nothing arrived" — the two looked identical on 2026-08-27 and the
    // difference was the whole diagnosis.
    expect(result).toMatchObject({
      ok: false,
      reason: 'no_credential',
      presentedSessionToken: true,
    });
  });

  it('refuses a session forged under a different secret', async () => {
    const token = await signPlayerSession({ fid: 1_000_000_006, origin: 'wallet' }, 'other-secret');
    const result = await resolveRequestFid(
      makeReq({ cookies: { [PLAYER_SESSION_COOKIE]: token } }),
      {}
    );
    expect(result).toMatchObject({
      ok: false,
      reason: 'no_credential',
      presentedSessionToken: true,
    });
  });

  it('cannot mint anything when ADMIN_SECRET is absent', async () => {
    const token = await signPlayerSession({ fid: 1_000_000_007, origin: 'wallet' }, SECRET);
    delete process.env.ADMIN_SECRET;
    const result = await resolveRequestFid(
      makeReq({ cookies: { [PLAYER_SESSION_COOKIE]: token } }),
      {}
    );
    expect(result).toMatchObject({ ok: false, reason: 'no_credential' });
  });
});

describe('the session may arrive in a header, not only a cookie', () => {
  /**
   * Base App's webview accepts the Set-Cookie on sign-in and never sends it
   * back. Observed in production 2026-08-27: the player signed in, saw their
   * $WORD balance, and every guess arrived with no credential. Nothing
   * server-side could fix that, because the credential never left the device.
   */
  it('accepts a valid token presented in the header with no cookie at all', async () => {
    const token = await signPlayerSession(
      { fid: 1_000_000_030, origin: 'wallet', wallet: '0xAbC0000000000000000000000000000000000021' },
      SECRET
    );
    const result = await resolveRequestFid(
      makeReq({ headers: { [PLAYER_SESSION_HEADER]: token } }),
      {}
    );
    expect(result).toMatchObject({
      ok: true,
      fid: 1_000_000_030,
      origin: 'player_session',
      provenWallet: '0xabc0000000000000000000000000000000000021',
    });
  });

  it('prefers the cookie when both are present', async () => {
    // The cookie is HttpOnly and cannot be read by a script, so where it works
    // it stays the stronger of the two.
    const cookieToken = await signPlayerSession({ fid: 1_000_000_031, origin: 'wallet' }, SECRET);
    const headerToken = await signPlayerSession({ fid: 1_000_000_032, origin: 'wallet' }, SECRET);

    const result = await resolveRequestFid(
      makeReq({
        cookies: { [PLAYER_SESSION_COOKIE]: cookieToken },
        headers: { [PLAYER_SESSION_HEADER]: headerToken },
      }),
      {}
    );
    expect(result).toMatchObject({ ok: true, fid: 1_000_000_031 });
  });

  it('does not accept a forged header token', async () => {
    const token = await signPlayerSession({ fid: 1_000_000_033, origin: 'wallet' }, 'wrong-secret');
    const result = await resolveRequestFid(
      makeReq({ headers: { [PLAYER_SESSION_HEADER]: token } }),
      {}
    );
    expect(result).toMatchObject({ ok: false, reason: 'no_credential' });
  });

  it('still lets Quick Auth win over a header session', async () => {
    const token = await signPlayerSession({ fid: 1_000_000_034, origin: 'wallet' }, SECRET);
    const result = await resolveRequestFid(
      makeReq({ body: { authToken: 'jwt' }, headers: { [PLAYER_SESSION_HEADER]: token } }),
      { verifyQuickAuthToken: verifyOk(6500) }
    );
    expect(result).toMatchObject({ ok: true, fid: 6500, origin: 'quick_auth' });
  });
});

describe('no credential at all', () => {
  it('never trusts a bare fid in the body', async () => {
    // This is the whole purchase-guess-pack.ts hole in one assertion.
    const result = await resolveRequestFid(makeReq({ body: { fid: 6500 } }), {});
    expect(result).toMatchObject({ ok: false, reason: 'no_credential', status: 401 });
  });

  it('reports that nothing was presented, distinct from a bad session', async () => {
    const result = await resolveRequestFid(makeReq({}), {});
    expect(result).toMatchObject({
      ok: false,
      reason: 'no_credential',
      presentedSessionToken: false,
    });
  });
});

describe('dev mode', () => {
  it('honours devFid', async () => {
    process.env.NEXT_PUBLIC_LHAW_DEV_MODE = 'true';
    const result = await resolveRequestFid(makeReq({ body: { devFid: 1234 } }), {});
    expect(result).toMatchObject({ ok: true, fid: 1234, origin: 'dev' });
  });

  it('falls back to 6500 with no devFid, as the web UI relies on', async () => {
    process.env.NEXT_PUBLIC_LHAW_DEV_MODE = 'true';
    const result = await resolveRequestFid(makeReq({}), {});
    expect(result).toMatchObject({ ok: true, fid: 6500, origin: 'dev' });
  });

  it('is inert when the flag is off — a devFid alone proves nothing', async () => {
    const result = await resolveRequestFid(makeReq({ body: { devFid: 1234 } }), {});
    expect(result).toMatchObject({ ok: false, reason: 'no_credential' });
  });
});

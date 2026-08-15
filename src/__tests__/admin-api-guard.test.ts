import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { proxy } from '../../proxy';
import { NextRequest } from 'next/server';

/**
 * The gate in front of /api/admin/*.
 *
 * Worth testing rather than eyeballing, because both halves can fail silently
 * in opposite directions: too strict and the operator is locked out of their
 * own dashboard, too loose and the endpoints that return a round's answer or
 * move the contract's $WORD stay open to anyone who read the FID out of the
 * public JS bundle.
 */

const SECRET = 'correct-horse-battery-staple';

function req(path: string, headers: Record<string, string> = {}, cookie?: string) {
  const h = new Headers(headers);
  if (cookie) h.set('cookie', cookie);
  return new NextRequest(new URL(`https://example.com${path}`), { headers: h });
}

describe('admin API guard', () => {
  const original = process.env.ADMIN_SECRET;

  afterEach(() => {
    if (original === undefined) delete process.env.ADMIN_SECRET;
    else process.env.ADMIN_SECRET = original;
  });

  describe('when ADMIN_SECRET is not set', () => {
    beforeEach(() => {
      delete process.env.ADMIN_SECRET;
    });

    it('changes nothing, so deploying it cannot break an existing install', async () => {
      // The entire safety of shipping this rests on this test.
      const res = await proxy(req('/api/admin/operational/withdraw-word-token'));
      expect(res.status).not.toBe(401);
    });
  });

  describe('when ADMIN_SECRET is set', () => {
    beforeEach(() => {
      process.env.ADMIN_SECRET = SECRET;
    });

    it('rejects a request carrying only a devFid', async () => {
      // The whole point: the admin FIDs ship in the browser bundle, so this
      // was never a credential.
      const res = await proxy(req('/api/admin/operational/recover-stuck-round?devFid=6500&roundId=34'));
      expect(res.status).toBe(401);
    });

    it('rejects the endpoints that never had an auth check at all', async () => {
      // A per-endpoint migration would have missed these by definition.
      expect((await proxy(req('/api/admin/refresh-seed-words'))).status).toBe(401);
      expect((await proxy(req('/api/admin/operational/diagnose-guess'))).status).toBe(401);
    });

    it('accepts the secret from a header', async () => {
      const res = await proxy(req('/api/admin/me', { 'x-admin-secret': SECRET }));
      expect(res.status).not.toBe(401);
    });

    it('accepts the secret as a bearer token', async () => {
      const res = await proxy(req('/api/admin/me', { authorization: `Bearer ${SECRET}` }));
      expect(res.status).not.toBe(401);
    });

    it('accepts the secret from a cookie, so the dashboard keeps working untouched', async () => {
      // ~76 existing fetch calls in the admin UI send no custom headers. The
      // browser attaches the cookie for them.
      const res = await proxy(req('/api/admin/me', {}, `admin_secret=${SECRET}`));
      expect(res.status).not.toBe(401);
    });

    it('rejects a wrong secret, and one that is merely a prefix', async () => {
      expect((await proxy(req('/api/admin/me', { 'x-admin-secret': 'nope' }))).status).toBe(401);
      expect(
        (await proxy(req('/api/admin/me', { 'x-admin-secret': SECRET.slice(0, -1) }))).status
      ).toBe(401);
      expect(
        (await proxy(req('/api/admin/me', { 'x-admin-secret': SECRET + 'x' }))).status
      ).toBe(401);
    });

    it('leaves non-admin API routes alone', async () => {
      // Players must not need the admin key to play.
      expect((await proxy(req('/api/guess'))).status).not.toBe(401);
      expect((await proxy(req('/api/round-state'))).status).not.toBe(401);
      expect((await proxy(req('/api/verify/round?roundId=33'))).status).not.toBe(401);
    });

    it('does not gate the admin PAGE, only the admin API', async () => {
      // The page has to render in order to prompt for the key.
      expect((await proxy(req('/admin'))).status).not.toBe(401);
    });
  });

  describe('the retired siwn_fid cookie', () => {
    beforeEach(() => {
      process.env.ADMIN_SECRET = SECRET;
    });

    it('never reaches an admin handler, even alongside a valid key', async () => {
      // 58 admin endpoints still read this cookie as an identity fallback. It
      // is unsigned and client-settable, and the only thing that legitimately
      // set it — Sign In With Neynar — was retired on 2026-08-14.
      const res = await proxy(
        req('/api/admin/me', { 'x-admin-secret': SECRET }, `siwn_fid=6500; other=keep`)
      );

      expect(res.status).not.toBe(401);
      const forwarded = res.headers.get('x-middleware-override-headers');
      // Next signals rewritten request headers via these override headers.
      expect(forwarded ?? '').toContain('cookie');
      expect(res.headers.get('x-middleware-request-cookie') ?? '').not.toContain('siwn_fid');
    });

    it('keeps the other cookies on the request', async () => {
      // Stripping must not take the admin session with it.
      const res = await proxy(
        req('/api/admin/me', {}, `siwn_fid=6500; admin_secret=${SECRET}`)
      );
      expect(res.status).not.toBe(401);
      expect(res.headers.get('x-middleware-request-cookie') ?? '').toContain('admin_secret');
    });

    it('does not let the cookie authenticate on its own', async () => {
      const res = await proxy(req('/api/admin/me', {}, 'siwn_fid=6500'));
      expect(res.status).toBe(401);
    });
  });
});
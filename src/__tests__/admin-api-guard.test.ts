import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { middleware } from '../../middleware';
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

    it('changes nothing, so deploying it cannot break an existing install', () => {
      // The entire safety of shipping this rests on this test.
      const res = middleware(req('/api/admin/operational/withdraw-word-token'));
      expect(res.status).not.toBe(401);
    });
  });

  describe('when ADMIN_SECRET is set', () => {
    beforeEach(() => {
      process.env.ADMIN_SECRET = SECRET;
    });

    it('rejects a request carrying only a devFid', () => {
      // The whole point: the admin FIDs ship in the browser bundle, so this
      // was never a credential.
      const res = middleware(req('/api/admin/operational/recover-stuck-round?devFid=6500&roundId=34'));
      expect(res.status).toBe(401);
    });

    it('rejects the endpoints that never had an auth check at all', () => {
      // A per-endpoint migration would have missed these by definition.
      expect(middleware(req('/api/admin/refresh-seed-words')).status).toBe(401);
      expect(middleware(req('/api/admin/operational/diagnose-guess')).status).toBe(401);
    });

    it('accepts the secret from a header', () => {
      const res = middleware(req('/api/admin/me', { 'x-admin-secret': SECRET }));
      expect(res.status).not.toBe(401);
    });

    it('accepts the secret as a bearer token', () => {
      const res = middleware(req('/api/admin/me', { authorization: `Bearer ${SECRET}` }));
      expect(res.status).not.toBe(401);
    });

    it('accepts the secret from a cookie, so the dashboard keeps working untouched', () => {
      // ~76 existing fetch calls in the admin UI send no custom headers. The
      // browser attaches the cookie for them.
      const res = middleware(req('/api/admin/me', {}, `admin_secret=${SECRET}`));
      expect(res.status).not.toBe(401);
    });

    it('rejects a wrong secret, and one that is merely a prefix', () => {
      expect(middleware(req('/api/admin/me', { 'x-admin-secret': 'nope' })).status).toBe(401);
      expect(
        middleware(req('/api/admin/me', { 'x-admin-secret': SECRET.slice(0, -1) })).status
      ).toBe(401);
      expect(
        middleware(req('/api/admin/me', { 'x-admin-secret': SECRET + 'x' })).status
      ).toBe(401);
    });

    it('leaves non-admin API routes alone', () => {
      // Players must not need the admin key to play.
      expect(middleware(req('/api/guess')).status).not.toBe(401);
      expect(middleware(req('/api/round-state')).status).not.toBe(401);
      expect(middleware(req('/api/verify/round?roundId=33')).status).not.toBe(401);
    });

    it('does not gate the admin PAGE, only the admin API', () => {
      // The page has to render in order to prompt for the key.
      expect(middleware(req('/admin')).status).not.toBe(401);
    });
  });
});

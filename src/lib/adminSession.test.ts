import { describe, it, expect } from 'vitest';
import {
  signAdminSession,
  verifyAdminSession,
  ADMIN_SESSION_TTL_SECONDS,
} from './adminSession';

/**
 * This token is the credential that replaces `?devFid=6500`. If it can be
 * forged or altered, nothing above it matters — so every test here is an
 * attempt to get a FID accepted that the server never signed.
 */

const SECRET = 'a'.repeat(64);
const OTHER_SECRET = 'b'.repeat(64);

describe('admin session tokens', () => {
  it('round-trips the fid it was signed with', async () => {
    const token = await signAdminSession(6500, SECRET);
    expect(await verifyAdminSession(token, SECRET)).toBe(6500);
  });

  it('rejects a token signed with a different secret', async () => {
    // i.e. rotating ADMIN_SECRET invalidates every existing session, which is
    // what makes rotation an actual revocation mechanism.
    const token = await signAdminSession(6500, OTHER_SECRET);
    expect(await verifyAdminSession(token, SECRET)).toBeNull();
  });

  it('rejects a tampered payload', async () => {
    // The attack: take a valid session for a non-admin and edit the fid.
    const token = await signAdminSession(1, SECRET);
    const [, signature] = token.split('.');

    const forgedBody = btoa(JSON.stringify({ fid: 6500, exp: 2_000_000_000 }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    expect(await verifyAdminSession(`${forgedBody}.${signature}`, SECRET)).toBeNull();
  });

  it('rejects an unsigned token even when the payload looks right', async () => {
    const body = btoa(JSON.stringify({ fid: 6500, exp: 2_000_000_000 }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    expect(await verifyAdminSession(body, SECRET)).toBeNull();
    expect(await verifyAdminSession(`${body}.`, SECRET)).toBeNull();
    expect(await verifyAdminSession(`${body}.notasignature`, SECRET)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = await signAdminSession(6500, SECRET, -1);
    expect(await verifyAdminSession(token, SECRET)).toBeNull();
  });

  it('accepts a token that has not quite expired', async () => {
    const token = await signAdminSession(6500, SECRET, 5);
    expect(await verifyAdminSession(token, SECRET)).toBe(6500);
  });

  it('rejects empty, malformed and absent input without throwing', async () => {
    // Verification runs in the proxy on every admin request; an exception
    // there would be an outage, not a rejection.
    expect(await verifyAdminSession(undefined, SECRET)).toBeNull();
    expect(await verifyAdminSession(null, SECRET)).toBeNull();
    expect(await verifyAdminSession('', SECRET)).toBeNull();
    expect(await verifyAdminSession('....', SECRET)).toBeNull();
    expect(await verifyAdminSession('%%%.%%%', SECRET)).toBeNull();
    expect(await verifyAdminSession('a.b.c', SECRET)).toBeNull();
  });

  it('rejects everything when no secret is configured', async () => {
    // Must never degrade to "allow" — an unset secret is the state the guard
    // treats as "feature off", and a token must not become valid there.
    const token = await signAdminSession(6500, SECRET);
    expect(await verifyAdminSession(token, '')).toBeNull();
  });

  it('defaults to a 12 hour lifetime', async () => {
    expect(ADMIN_SESSION_TTL_SECONDS).toBe(12 * 60 * 60);
  });
});

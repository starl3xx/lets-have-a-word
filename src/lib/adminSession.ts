/**
 * Signed admin session tokens.
 *
 * Issued by /api/auth/verify after a Sign In With Farcaster signature has been
 * checked, and verified by middleware.ts on every /api/admin/* request.
 *
 * WHY A SIGNED TOKEN RATHER THAN A FID
 *
 * The hole this replaces was that the server took the caller's word for who
 * they were: `?devFid=6500`, with the admin FIDs printed in the browser
 * bundle. Verifying a SIWF signature fixes that for one request — but if the
 * server then hands back `{ fid }` and trusts the client to repeat it, the
 * next request is unauthenticated again in exactly the same way. The signature
 * has to be converted into something the client cannot mint. That is this.
 *
 * WHY HMAC AND NOT A JWT LIBRARY
 *
 * Middleware runs on the edge runtime, so the verifier cannot use Node's
 * `crypto`. Web Crypto is available in both runtimes, which lets the same
 * module sign in an API route and verify at the edge — one implementation,
 * no chance of the two drifting. A JWT library would work but adds a
 * dependency to do what thirty lines of HMAC already does correctly.
 *
 * The signing key is ADMIN_SECRET, which is already set and already
 * server-side. A separate key would be one more thing to rotate in step.
 */

const encoder = new TextEncoder();

/** Twelve hours. Long enough to work a session, short enough to matter. */
export const ADMIN_SESSION_TTL_SECONDS = 12 * 60 * 60;

export const ADMIN_SESSION_COOKIE = 'admin_session';

interface SessionPayload {
  fid: number;
  /** Unix seconds. */
  exp: number;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

/**
 * Mint a session for an already-verified admin FID.
 *
 * Callers must have verified the SIWF signature AND confirmed the FID is an
 * admin before calling this — nothing here re-checks either.
 */
export async function signAdminSession(
  fid: number,
  secret: string,
  ttlSeconds: number = ADMIN_SESSION_TTL_SECONDS
): Promise<string> {
  const payload: SessionPayload = {
    fid,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };

  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body));

  return `${body}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/**
 * Verify a session token and return the FID it attests to, or null.
 *
 * Returns null for every failure mode rather than throwing or distinguishing
 * between them: a caller cannot act differently on "bad signature" versus
 * "expired", and telling them apart only helps someone probing.
 *
 * The signature is checked with `crypto.subtle.verify`, which is constant-time
 * — the expiry is only read AFTER that check passes, so an unsigned token can
 * never influence control flow.
 */
export async function verifyAdminSession(
  token: string | undefined | null,
  secret: string
): Promise<number | null> {
  if (!token || !secret) return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [body, signature] = parts;

  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      base64UrlDecode(signature),
      encoder.encode(body)
    );
  } catch {
    // Malformed base64 in the signature segment.
    return null;
  }

  if (!valid) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body))) as SessionPayload;
    if (typeof payload.fid !== 'number' || typeof payload.exp !== 'number') return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload.fid;
  } catch {
    return null;
  }
}

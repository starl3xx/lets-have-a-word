/**
 * Signed player session tokens.
 *
 * Issued by /api/auth/siwe after a Sign-In With Ethereum signature has been
 * checked, and read by resolveRequestFid on the authenticated game endpoints.
 *
 * This is the wallet-native counterpart to Farcaster Quick Auth. A Base App
 * player has no FID and no Farcaster JWT — Base App stopped hosting Farcaster
 * mini apps on 2026-04-09 — so the only thing they can prove is control of a
 * wallet. SIWE converts that proof into this token, exactly as
 * adminSession.ts converts a SIWF signature into an admin token, and for the
 * same reason: verifying a signature authenticates ONE request. If the server
 * then trusted the client to repeat a plain `fid`, every request after the
 * first would be unauthenticated in precisely the way `?devFid=` was.
 *
 * WHY A DERIVED KEY AND NOT ADMIN_SECRET DIRECTLY
 *
 * adminSession's payload is `{ fid, exp }`. This payload is a superset of it,
 * so a player token signed with the raw ADMIN_SECRET would verify cleanly as
 * an ADMIN token — `verifyAdminSession` parses the JSON, finds `fid` and `exp`
 * of the right types, and returns the FID. Every non-admin would still be
 * refused by the `isAdminFid` check downstream, so the hole is narrow: it is
 * the admin's own player session, minted the moment they play their own game,
 * becoming a working admin credential in a cookie with a 30-day life and a
 * different security posture. Domain separation closes it for the cost of one
 * extra HMAC, and it closes it in BOTH directions — an admin token cannot be
 * replayed as a player session either.
 *
 * The key is derived rather than configured so there is no second secret to
 * set, rotate, or forget in an environment. If ADMIN_SECRET is absent the
 * derivation fails and wallet sign-in is unavailable, which is the correct
 * direction: no secret means no minting, not minting with a default.
 */

const encoder = new TextEncoder();

/**
 * Thirty days. A player is not an operator: re-signing a wallet message is a
 * modal and a gas-free signature, but doing it every twelve hours in the
 * middle of a round is the kind of friction that loses the guess.
 */
export const PLAYER_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export const PLAYER_SESSION_COOKIE = 'lhaw_player_session';

/**
 * Header the client may present the same token in, when a cookie will not do.
 *
 * Base App's webview accepts the Set-Cookie on the sign-in response and then
 * never sends it back: a player signs in successfully, sees their $WORD
 * balance, and every guess arrives with no credential at all. Observed in
 * production 2026-08-27. Nothing server-side can fix that, because the
 * credential never leaves the device.
 *
 * The cookie remains the PREFERRED path and is still set — it is HttpOnly and
 * works everywhere else. This is a fallback the client uses only when it holds
 * a token it was handed directly.
 */
export const PLAYER_SESSION_HEADER = 'x-player-session';

/** Label mixed into the key derivation. Changing it invalidates every session. */
const KEY_DERIVATION_LABEL = 'lhaw:player-session:v1';

/** How the player proved who they are. */
export type PlayerOrigin = 'farcaster' | 'wallet';

export interface PlayerSession {
  fid: number;
  origin: PlayerOrigin;
  /** Lowercased address that signed, present only for wallet origin. */
  wallet?: string;
}

interface PlayerSessionPayload extends PlayerSession {
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

/**
 * HMAC(ADMIN_SECRET, label) as the player signing key.
 *
 * One extra HMAC buys a key that cannot verify an admin token and that an
 * admin token cannot verify against. See the note at the top of the file.
 */
async function playerKey(secret: string): Promise<CryptoKey> {
  const rootKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const derived = await crypto.subtle.sign(
    'HMAC',
    rootKey,
    encoder.encode(KEY_DERIVATION_LABEL)
  );
  return crypto.subtle.importKey(
    'raw',
    derived,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

/**
 * Mint a session for an already-verified player.
 *
 * Callers must have verified the SIWE signature and resolved the wallet to a
 * FID before calling this — nothing here re-checks either.
 */
export async function signPlayerSession(
  session: PlayerSession,
  secret: string,
  ttlSeconds: number = PLAYER_SESSION_TTL_SECONDS
): Promise<string> {
  const payload: PlayerSessionPayload = {
    ...session,
    wallet: session.wallet?.toLowerCase(),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };

  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    'HMAC',
    await playerKey(secret),
    encoder.encode(body)
  );

  return `${body}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/**
 * The one distinction inspection makes on failure: `expired` is true ONLY
 * when the HMAC verified and the payload parsed cleanly but its `exp` has
 * passed — a token this server provably minted. Nobody can produce that
 * without the secret, which is what makes it safe to key guaranteed-delivery
 * telemetry on (Bugbot, PR #283: keying on "any token-shaped bytes arrived"
 * let an attacker farm the awaited Sentry flush with garbage headers).
 */
export type PlayerSessionInspection =
  | { ok: true; session: PlayerSession }
  | { ok: false; expired: boolean };

/**
 * Inspect a session token: verify, and on failure say only whether it was an
 * authentic-but-expired token. The signature is checked first with
 * `crypto.subtle.verify`, and the payload is only parsed after that check
 * passes, so an unsigned token never influences control flow. Nothing about
 * the distinction reaches the CLIENT — callers answer the same 401 with the
 * same message either way; `expired` feeds telemetry, not responses.
 */
export async function inspectPlayerSession(
  token: string | undefined | null,
  secret: string
): Promise<PlayerSessionInspection> {
  const refused: PlayerSessionInspection = { ok: false, expired: false };
  if (!token || !secret) return refused;

  const parts = token.split('.');
  if (parts.length !== 2) return refused;

  const [body, signature] = parts;

  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      'HMAC',
      await playerKey(secret),
      base64UrlDecode(signature),
      encoder.encode(body)
    );
  } catch {
    // Malformed base64 in the signature segment.
    return refused;
  }

  if (!valid) return refused;

  try {
    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(body))
    ) as PlayerSessionPayload;

    if (typeof payload.fid !== 'number' || !Number.isInteger(payload.fid) || payload.fid <= 0) {
      return refused;
    }
    if (payload.origin !== 'farcaster' && payload.origin !== 'wallet') return refused;
    if (typeof payload.exp !== 'number') return refused;
    if (payload.exp <= Math.floor(Date.now() / 1000)) {
      // Authentic — the HMAC passed and the payload is ours — just old.
      return { ok: false, expired: true };
    }

    return {
      ok: true,
      session: { fid: payload.fid, origin: payload.origin, wallet: payload.wallet },
    };
  } catch {
    return refused;
  }
}

/**
 * Verify a session token and return what it attests to, or null.
 *
 * Returns null for every failure mode rather than distinguishing them: a
 * caller cannot act differently on "bad signature" versus "expired", and
 * telling them apart only helps someone probing. Callers that need the
 * telemetry-only expired distinction use inspectPlayerSession.
 */
export async function verifyPlayerSession(
  token: string | undefined | null,
  secret: string
): Promise<PlayerSession | null> {
  const inspection = await inspectPlayerSession(token, secret);
  return inspection.ok ? inspection.session : null;
}

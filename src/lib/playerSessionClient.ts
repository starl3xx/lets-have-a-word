/**
 * Client-side custody of the wallet player's session token.
 *
 * WHY THIS EXISTS AT ALL. Sign-in sets an HttpOnly cookie, and in an ordinary
 * browser that is the whole story — the cookie rides along and nothing here is
 * needed. Base App's webview is not an ordinary browser: it accepts the
 * Set-Cookie on the sign-in response and then never sends it back. Observed in
 * production on 2026-08-27, where a player signed in successfully, saw their
 * $WORD balance, and every guess arrived with no credential at all.
 *
 * THE TRADE-OFF, STATED PLAINLY. Holding the token in localStorage means a
 * script on the page can read it, which an HttpOnly cookie prevents. That is a
 * real loss and it is taken knowingly: HttpOnly protects a credential that is
 * never transmitted, which is worth nothing. The cookie is still set and is
 * still tried first server-side, so browsers that behave normally keep the
 * stronger guarantee and only cookie-hostile hosts fall back to this.
 *
 * What the token can do is bounded: it authenticates a player to play as
 * themselves. It cannot move funds — every purchase is an onchain transaction
 * signed by the wallet, not by this.
 */

import { PLAYER_SESSION_HEADER } from './playerSession';

const STORAGE_KEY = 'lhaw.playerSession';

export interface StoredPlayerSession {
  token: string;
  /**
   * Kept alongside the token so a transient failure of /api/auth/me does not
   * cost the player their session. Without it, the only way to learn who the
   * token belongs to is to ask the server, and a 500 would be indistinguishable
   * from a rejection.
   */
  fid: number;
}

/** In-memory mirror, so a host that also blocks storage still works for the visit. */
let inMemory: StoredPlayerSession | null = null;

export function setStoredPlayerSession(session: StoredPlayerSession | null): void {
  inMemory = session;
  if (typeof window === 'undefined') return;
  try {
    if (session) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode, or a webview with storage disabled. The in-memory copy
    // still carries the current visit; the player signs in again next time.
  }
}

export function getStoredPlayerSession(): StoredPlayerSession | null {
  if (inMemory) return inMemory;
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredPlayerSession>;
    if (typeof parsed?.token !== 'string' || typeof parsed?.fid !== 'number') return null;
    inMemory = { token: parsed.token, fid: parsed.fid };
    return inMemory;
  } catch {
    // Unparseable — treat as absent rather than throwing on every request.
    return null;
  }
}

/**
 * Forget the session. Called ONLY when the server has definitively refused the
 * token with a 401.
 *
 * Not on a 500, a 503, a 429 or a dropped connection: those say nothing about
 * whether the token is valid, and discarding it would cost the player a full
 * wallet signature to recover from someone else's transient fault.
 */
export function clearStoredPlayerSession(): void {
  setStoredPlayerSession(null);
}

/**
 * Headers to attach to an authenticated request.
 *
 * Empty when there is no token, which is the normal case for a Farcaster
 * player — they authenticate with a Quick Auth JWT and never touch this.
 */
export function playerSessionHeaders(): Record<string, string> {
  const session = getStoredPlayerSession();
  return session ? { [PLAYER_SESSION_HEADER]: session.token } : {};
}

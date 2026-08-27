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

/** In-memory mirror, so a host that also blocks storage still works for the visit. */
let inMemoryToken: string | null = null;

export function setStoredPlayerSession(token: string | null): void {
  inMemoryToken = token;
  if (typeof window === 'undefined') return;
  try {
    if (token) window.localStorage.setItem(STORAGE_KEY, token);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode, or a webview with storage disabled. The in-memory copy
    // still carries the current visit; the player signs in again next time.
  }
}

export function getStoredPlayerSession(): string | null {
  if (inMemoryToken) return inMemoryToken;
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    inMemoryToken = stored;
    return stored;
  } catch {
    return null;
  }
}

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
  const token = getStoredPlayerSession();
  return token ? { [PLAYER_SESSION_HEADER]: token } : {};
}

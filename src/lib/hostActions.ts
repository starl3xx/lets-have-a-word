/**
 * Farcaster host actions, made safe to call from anywhere.
 *
 * THE FAILURE THIS EXISTS FOR. Every `sdk.actions.*` promise NEVER SETTLES
 * outside a Farcaster host — it does not resolve and it does not reject, so a
 * `catch` can never run and a `finally` can never run. Base App stopped being a
 * host on 2026-04-09, so in Base App the standard shape
 *
 *     setIsSharing(true);
 *     await sdk.actions.composeCast(...);   // never returns
 *     setIsSharing(false);                  // never runs
 *
 * leaves a spinner up forever. On 2026-08-27 that was reported from a device on
 * two screens at once: the share-for-a-guess modal disabled its own "Not now"
 * button, leaving a backdrop tap as the only escape, and the winner screen
 * disabled the X share button — the one that works — because the dead Farcaster
 * button beside it shared the same pending flag.
 *
 * TWO RULES, encoded here so they are not re-litigated per call site:
 *   1. Never await a host action unbounded. `withHostTimeout` turns a hang into
 *      a rejection, which every existing catch already handles.
 *   2. A pending host action may disable ITS OWN control and nothing else.
 *      That one is a review rule, not something a helper can enforce.
 *
 * The timeout is deliberately long: it is a backstop against a promise that
 * will never settle, not a latency budget for a host that is merely slow.
 */

import { FARCASTER_FALLBACK_SESSION_TTL_SECONDS } from './playerSession';

/**
 * For actions the host answers BY ITSELF: viewToken, viewProfile,
 * getCapabilities. Long enough that no real host trips it, short enough that a
 * failure feels like a failure.
 */
export const HOST_ACTION_TIMEOUT_MS = 8_000;

/**
 * For actions that wait on the PLAYER, not the host — composeCast above all.
 *
 * `composeCast` does not resolve when the composer opens; it resolves when the
 * player posts or dismisses it. Someone writing a cast about their jackpot can
 * easily take a minute, so an 8s bound here would reject mid-compose ON A REAL
 * HOST: SharePromptModal would report "Failed to open share dialog" and never
 * run the verification that awards the free guess, and the winner card would
 * show an error while the player was still typing. That is a worse bug than
 * the hang it was meant to prevent, and it would land on the Farcaster
 * majority rather than the Base App minority (Bugbot, PR #289).
 *
 * So the bound here is a backstop against a leaked promise, NOT a latency
 * budget. The real defence against the off-host hang is not calling
 * composeCast off-host at all — every call site is host-gated, and off-host
 * shares go to X, which works everywhere.
 */
export const HOST_COMPOSE_TIMEOUT_MS = 180_000;

/**
 * Bound a host action so it always settles.
 *
 * Rejects with a labelled error on timeout, so callers keep their existing
 * error handling and their finally blocks actually run.
 */
export async function withHostTimeout<T>(
  action: Promise<T>,
  label: string,
  timeoutMs: number = HOST_ACTION_TIMEOUT_MS
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      action,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} did not respond (no Farcaster host?)`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Open the X composer with prepopulated text.
 *
 * TWO ATTEMPTS, BOTH INSIDE THE CLICK GESTURE, in this order:
 *
 *   1. `twitter://post`, via a programmatic anchor click. If the X app is
 *      installed and the host hands unknown schemes to the OS, the compose
 *      lands in the app the player is already logged into.
 *   2. `x.com/intent/tweet` in a new tab, unconditionally.
 *
 * WHY BOTH RATHER THAN ONE THEN THE OTHER. An earlier version fired the scheme
 * and set an 800ms timer to fall back. Bugbot killed it, correctly: a delayed
 * `window.open` is outside the user gesture, so popup blockers swallow it and
 * the share silently does nothing. Firing both synchronously means the web tab
 * is guaranteed — the behaviour before any of this — while the scheme gets a
 * real chance. Worst case the player gets the tab they get today; best case
 * they land in the app and the tab is behind them.
 *
 * A HIDDEN IFRAME, not a location assignment and not an anchor click. Both of
 * those navigate the TOP document, so a scheme the host does not handle can
 * replace the game with an error page — including from the winner screen. An
 * anchor without `target` is still a same-window navigation and carries exactly
 * that risk (Bugbot, PR #294). An iframe cannot touch the top document by
 * construction: an unhandled scheme fails inside the frame and the game is
 * untouched.
 *
 * REPORTED FROM A DEVICE 2026-08-27: Base App opens the https link in its own
 * in-app browser rather than handing it to the X app. Whether it honours the
 * scheme is the host's decision and not something a page can force — this is
 * the best a page can do, and it is never worse than the web tab alone.
 */
export function openXComposer(text: string, url?: string): void {
  if (typeof window === 'undefined') return;

  const params = new URLSearchParams({ text });
  if (url) params.set('url', url);
  const webUrl = `https://x.com/intent/tweet?${params.toString()}`;

  // The app scheme carries one text field, so the link rides inside it.
  const appMessage = url ? `${text}\n\n${url}` : text;

  try {
    const frame = document.createElement('iframe');
    frame.style.display = 'none';
    frame.src = `twitter://post?message=${encodeURIComponent(appMessage)}`;
    document.body.appendChild(frame);
    // Tidy-up only, not a fallback: the web tab below has already opened by
    // the time this runs, and removing the frame has no effect on whether the
    // OS took the scheme.
    window.setTimeout(() => frame.remove(), 1_000);
  } catch {
    // Host refused the scheme outright. The web tab below still opens.
  }

  window.open(webUrl, '_blank', 'noopener,noreferrer');
}

/**
 * Styling for a button that opens X, so the three share surfaces cannot drift
 * apart from each other or from the winner card's long-standing black button.
 *
 * The colour is not decoration: a purple Farcaster-styled button that opens X
 * misreports where the post is going, the same way the Farcaster arch icon did.
 * Padding is left to the call site, which owns its own layout.
 */
export const X_BUTTON_CLASS =
  'bg-black hover:bg-gray-800 active:scale-95 text-white font-bold rounded-btn shadow-btn transition-all duration-fast';

/**
 * Ask the host for a Quick Auth token, bounded, and never throw.
 *
 * CALLED PER GUESS, NOT ONCE AT LOAD. The page used to fetch the token one
 * time, when the Farcaster context arrived, and keep it in React state. Two
 * things break that:
 *   - The fetch fails. On 2026-10-13 Farcaster's /verify-siwf answered 500
 *     (Sentry LETS-HAVE-A-WORD-32), the page kept no token, and every guess
 *     went out with a bare miniAppFid, which /api/guess refuses by design. The
 *     player saw "Please refresh the app to sign in securely" with three paid
 *     guesses in hand, and nothing on the page ever asked again.
 *   - The token expires. The SDK renews its own copy 15s before expiry; the
 *     copy in React state never changes.
 * The SDK's getToken returns its cached token while it is valid and joins a
 * request already in flight, so asking per guess costs nothing when all is
 * well.
 *
 * A late answer still counts: `onToken` runs even after the timeout has fired,
 * so a slow host fixes the NEXT guess instead of being thrown away.
 */
export async function requestQuickAuthToken(
  getToken: () => Promise<{ token?: string | null }>,
  onToken: (token: string) => void,
  timeoutMs: number = HOST_ACTION_TIMEOUT_MS
): Promise<string | null> {
  try {
    const pending = getToken().then(({ token }) => {
      if (token) onToken(token);
      return token || null;
    });
    return await withHostTimeout(pending, 'quickAuth.getToken', timeoutMs);
  } catch (error) {
    console.error('[QuickAuth] Could not get a token:', error);
    return null;
  }
}

/** The host's sign-in action, as `sdk.actions.signIn` provides it. */
export type HostSignIn = (options: {
  nonce: string;
  acceptAuthAddress: boolean;
}) => Promise<{ message: string; signature: string }>;

/** The fallback session for this page. In memory only, never in storage. */
let fallbackSession: { token: string; fid: number; reuseUntil: number } | null = null;

/** Forget the fallback session, after the server refuses it with a 401. */
export function forgetFarcasterFallbackSession(): void {
  fallbackSession = null;
}

/**
 * Sign in WITHOUT Farcaster's Quick Auth server, for when that server is down.
 *
 * Quick Auth has two steps. The host signs a Sign In With Farcaster message,
 * then Farcaster's server at auth.farcaster.xyz checks the signature and
 * returns a JWT. From 01:00 UTC on 2026-10-14 that server answered 500 to every
 * player who opened the game (Sentry LETS-HAVE-A-WORD-32 and -3P), while the
 * host still signed. So this asks the host for the same signature with OUR
 * nonce, and /api/auth/verify checks it against the Farcaster registry on
 * Optimism by itself. The answer is a one-hour player session, which
 * resolveRequestFid already accepts.
 *
 * Never throws. Returns null on any failure. It also returns null when the
 * signature belongs to an FID other than the one the page shows, so a guess
 * cannot go out under an account the player cannot see.
 *
 * The session is reused until five minutes before it expires, so a run of
 * guesses during an outage costs one signature. As with Quick Auth, a session
 * that arrives after the timeout is kept for the next guess.
 */
export async function requestFarcasterFallbackSession(
  signIn: HostSignIn,
  expectedFid: number,
  options: {
    referrerFid?: number | null;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    now?: () => number;
  } = {}
): Promise<string | null> {
  const {
    referrerFid = null,
    fetchImpl = fetch,
    timeoutMs = HOST_ACTION_TIMEOUT_MS,
    now = Date.now,
  } = options;

  if (fallbackSession && fallbackSession.fid === expectedFid && now() < fallbackSession.reuseUntil) {
    return fallbackSession.token;
  }

  const signInThroughOurServer = async (): Promise<string | null> => {
    const nonceResponse = await fetchImpl('/api/auth/nonce');
    if (!nonceResponse.ok) return null;
    const { nonce } = (await nonceResponse.json()) as { nonce?: unknown };
    if (typeof nonce !== 'string' || !nonce) return null;

    const { message, signature } = await signIn({ nonce, acceptAuthAddress: true });

    const verifyResponse = await fetchImpl('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        signature,
        nonce,
        playerSession: true,
        ref: referrerFid ?? undefined,
      }),
    });
    if (!verifyResponse.ok) return null;
    const data = (await verifyResponse.json()) as { fid?: unknown; sessionToken?: unknown };
    if (typeof data.sessionToken !== 'string' || !data.sessionToken) return null;
    if (data.fid !== expectedFid) {
      console.error(
        `[SignInFallback] The signature is for FID ${String(data.fid)}, but the page shows FID ${expectedFid}. Not using it.`
      );
      return null;
    }

    fallbackSession = {
      token: data.sessionToken,
      fid: expectedFid,
      reuseUntil: now() + (FARCASTER_FALLBACK_SESSION_TTL_SECONDS - 5 * 60) * 1000,
    };
    return data.sessionToken;
  };

  try {
    return await withHostTimeout(signInThroughOurServer(), 'Sign-in fallback', timeoutMs);
  } catch (error) {
    console.error('[SignInFallback] Could not sign in without Quick Auth:', error);
    return null;
  }
}

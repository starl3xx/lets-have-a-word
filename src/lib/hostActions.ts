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
 * A plain web intent, so it works in every host including Base App's webview —
 * unlike `composeCast`, which needs a Farcaster host. Already the mechanism
 * behind the winner card's "Share on X" button; centralised here so the other
 * share surfaces do not each re-derive the URL.
 */
export function openXComposer(text: string, url?: string): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams({ text });
  if (url) params.set('url', url);
  window.open(
    `https://twitter.com/intent/tweet?${params.toString()}`,
    '_blank',
    'noopener,noreferrer'
  );
}

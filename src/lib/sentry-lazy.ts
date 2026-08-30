/**
 * Lazy Sentry loader — the ONLY place the client may load @sentry/nextjs.
 *
 * The Sentry client SDK is ~123 KB gz, the second-largest single item in the
 * first-load bundle, and instrumentation-client.ts loads unconditionally
 * before hydration (Next convention) — so it sat on the splash-screen
 * critical path of every open. Loading it after first paint takes it off
 * that path without losing the telemetry that matters:
 *
 *   - Errors thrown BEFORE the SDK arrives are caught by two tiny window
 *     handlers, buffered, and replayed into Sentry as soon as init runs.
 *     The honest cost is narrower than "the first second is unreported":
 *     only an error that prevents the page from EVER reaching idle (so the
 *     load never fires) is lost entirely.
 *   - ErrorBoundary reports through captureExceptionLazy below, which
 *     force-loads the SDK on demand — a crash is exactly the moment the
 *     download is worth it.
 *
 * Nothing here may import @sentry/nextjs statically; `import type` only.
 */

type SentryModule = typeof import('@sentry/nextjs');

const SENTRY_ENABLED =
  process.env.NODE_ENV === 'production' && !!process.env.NEXT_PUBLIC_SENTRY_DSN;

let sentryPromise: Promise<SentryModule> | null = null;

/**
 * Stack-frame URL patterns for extension noise, used twice: as the SDK's
 * denyUrls AND as the replay filter for buffered errors. The buffer must
 * screen by the ErrorEvent's own filename because a cross-origin or
 * extension script often delivers no error object — just a message — and an
 * event with no stack frames sails straight past denyUrls. The pre-idle
 * window is exactly when wallet-extension inpage collisions fire, so an
 * unfiltered replay would reintroduce the noise denyUrls exists to drop.
 */
const EXTENSION_DENY_URLS = [
  // Wallet extension injected scripts (inpage.js, inpage.iife.js, ...)
  // Sentry rewrites the origin to app:///, so the filename survives.
  /inpage\./i,
  // Extension protocols, when the origin does reach us.
  /^chrome-extension:\/\//i,
  /^moz-extension:\/\//i,
  /^safari-(web-)?extension:\/\//i,
  /extensions\//i,
];

interface EarlyError {
  payload: unknown;
  /** ErrorEvent.filename — the URL of the script that threw, if known. */
  sourceUrl: string | null;
}

/** Errors seen before the SDK loaded, replayed after init. Bounded. */
const earlyErrors: EarlyError[] = [];
const EARLY_ERROR_LIMIT = 20;

function onEarlyError(event: ErrorEvent): void {
  if (earlyErrors.length < EARLY_ERROR_LIMIT) {
    earlyErrors.push({
      payload: event.error ?? event.message,
      sourceUrl: event.filename || null,
    });
  }
}

function onEarlyRejection(event: PromiseRejectionEvent): void {
  if (earlyErrors.length < EARLY_ERROR_LIMIT) {
    earlyErrors.push({ payload: event.reason, sourceUrl: null });
  }
}

function detachEarlyHandlers(): void {
  window.removeEventListener('error', onEarlyError);
  window.removeEventListener('unhandledrejection', onEarlyRejection);
}

/**
 * Import and initialize the SDK (idempotent). The init options live here —
 * instrumentation-client.ts is just the scheduler.
 */
export function loadSentry(): Promise<SentryModule> {
  if (!sentryPromise) {
    sentryPromise = import('@sentry/nextjs').then((Sentry) => {
      Sentry.init({
        dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

        // Only enable in production, and only when a DSN is configured.
        enabled: SENTRY_ENABLED,

        tracesSampleRate: 0.1,
        debug: false,

        // Replay is disabled by default - enable if needed for session replay
        replaysOnErrorSampleRate: 0,
        replaysSessionSampleRate: 0,

        // Filter out noisy errors.
        //
        // ignoreErrors matches the MESSAGE; filtering by where the code came
        // from is denyUrls below.
        ignoreErrors: [
          // Network errors that are expected
          'Network request failed',
          'Failed to fetch',
          'Load failed',
          // Rate limiting (expected behavior)
          'Too many requests',
        ],

        /**
         * Matched against the stack frame URLs, which is how extension noise
         * is actually excluded. Every wallet extension injects an `inpage`
         * script into every page; two of them collide over minified globals
         * and throw from inpage.iife.js, attributed to us because
         * window.onerror catches everything on the page. The same list
         * screens the pre-SDK buffer replay above, where no stack exists.
         */
        denyUrls: EXTENSION_DENY_URLS,

        beforeSend(event) {
          return event;
        },
      });

      // The SDK's own global handlers are live now; replay what they missed.
      // Screened by source URL first: an extension error buffered without an
      // error object has no stack frames for denyUrls to match, so the
      // ErrorEvent's own filename is the only signal, and skipping here is
      // what keeps pre-idle inpage noise out. Replays are marked unhandled —
      // a startup crash is a crash, not a caught exception.
      detachEarlyHandlers();
      for (const entry of earlyErrors.splice(0)) {
        const src = entry.sourceUrl;
        if (src && EXTENSION_DENY_URLS.some((re) => re.test(src))) continue;
        Sentry.captureException(entry.payload, {
          mechanism: { handled: false, type: 'pre-sentry-buffer' },
          captureContext: { tags: { caught: 'pre-sentry-buffer' } },
        });
      }

      return Sentry;
    });
  }
  return sentryPromise;
}

/** The pending SDK, or null if nothing has asked for it yet. */
export function sentryIfStarted(): Promise<SentryModule> | null {
  return sentryPromise;
}

/**
 * captureException for call sites that must not carry the SDK's weight
 * (ErrorBoundary). Force-loads on demand: a crash is exactly the moment the
 * download is worth it, and the error object is held until it arrives.
 */
export function captureExceptionLazy(
  error: unknown,
  context?: Parameters<SentryModule['captureException']>[1]
): void {
  loadSentry()
    .then((Sentry) => Sentry.captureException(error, context))
    .catch(() => {
      // The SDK failed to load (offline, blocked). Nothing to report to.
    });
}

/**
 * Buffer early errors now, load the SDK once the page has painted and gone
 * idle. Called once from instrumentation-client.ts.
 */
export function scheduleSentryLoad(): void {
  if (typeof window === 'undefined' || !SENTRY_ENABLED) return;

  window.addEventListener('error', onEarlyError);
  window.addEventListener('unhandledrejection', onEarlyRejection);

  const start = (): void => {
    // typeof-check, not `'requestIdleCallback' in window`: lib.dom declares
    // requestIdleCallback unconditionally, so the `in` guard narrows window
    // to `never` in the else branch and the fallback fails tsc.
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => void loadSentry(), { timeout: 5_000 });
    } else {
      setTimeout(() => void loadSentry(), 2_000);
    }
  };

  if (document.readyState === 'complete') {
    start();
  } else {
    window.addEventListener('load', start, { once: true });
  }
}

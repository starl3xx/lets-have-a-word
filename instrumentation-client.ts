/**
 * Sentry Client Configuration (instrumentation-client.ts, the Turbopack-era location)
 * Milestone 9.1 - Error Monitoring
 *
 * This file configures the initialization of Sentry on the client.
 * The config you add here will be used whenever a page is visited.
 * https://docs.sentry.io/platforms/javascript/guides/nextjs/
 */

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Only enable in production, and only when a DSN is configured — this file
  // loads unconditionally (Next convention), unlike the old sentry.client
  // .config.ts that only loaded under the DSN-gated withSentryConfig
  enabled: process.env.NODE_ENV === 'production' && !!process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Adjust this value in production, or use tracesSampler for greater control
  tracesSampleRate: 0.1,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,

  // Replay is disabled by default - enable if needed for session replay
  replaysOnErrorSampleRate: 0,
  replaysSessionSampleRate: 0,

  // You can remove this option if you're not planning to use the Sentry Replay integration
  // integrations: [
  //   Sentry.replayIntegration(),
  // ],

  // Filter out noisy errors.
  //
  // ignoreErrors matches the MESSAGE. The two extension patterns below have
  // therefore never matched anything: an extension's error message is whatever
  // its own minified code threw, not a path. Filtering by where the code CAME
  // from is denyUrls, and that was missing entirely.
  ignoreErrors: [
    // Network errors that are expected
    'Network request failed',
    'Failed to fetch',
    'Load failed',
    // Rate limiting (expected behavior)
    'Too many requests',
  ],

  /**
   * Matched against the stack frame URLs, which is how extension noise is
   * actually excluded.
   *
   * Every wallet extension injects a script into every page, conventionally
   * named `inpage`. Two of them on one page collide over minified globals and
   * throw things like "Identifier 'T' has already been declared" from
   * `inpage.iife.js`, attributed to us because window.onerror catches
   * everything on the page. It is a fight between two extensions on somebody's
   * laptop and there is nothing to fix in this app.
   *
   * Worth having before a traffic spike rather than after: a wallet-heavy
   * audience means a lot of extensions, and this noise buries real errors in
   * exactly the window where seeing them matters.
   */
  denyUrls: [
    // Wallet extension injected scripts (inpage.js, inpage.iife.js, ...).
    // Sentry rewrites the origin to app:///, so the filename is what survives.
    /inpage\./i,
    // Extension protocols, when the origin does reach us.
    /^chrome-extension:\/\//i,
    /^moz-extension:\/\//i,
    /^safari-(web-)?extension:\/\//i,
    /extensions\//i,
  ],

  // Add context about the user (FID if available)
  beforeSend(event) {
    // You can add custom context here
    return event;
  },
});

// Next 16 / Turbopack navigation instrumentation hook
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

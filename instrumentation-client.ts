/**
 * Sentry Client Configuration (instrumentation-client.ts, the Turbopack-era location)
 * Milestone 9.1 - Error Monitoring
 *
 * This file loads unconditionally before hydration (Next convention), which
 * is exactly why it no longer imports @sentry/nextjs statically: the SDK is
 * ~123 KB gz and sat on the splash-screen critical path of every open. All
 * the actual configuration — DSN, ignoreErrors, the wallet-extension
 * denyUrls — lives in src/lib/sentry-lazy.ts, which buffers pre-SDK errors
 * and loads the real SDK after first paint.
 */

import { scheduleSentryLoad, sentryIfStarted } from './src/lib/sentry-lazy';

scheduleSentryLoad();

// Next 16 / Turbopack navigation instrumentation hook. Forwarded only once
// the SDK has started loading: a transition that early is part of the first
// load, which the SDK cannot trace retroactively anyway (and tracing samples
// at 0.1).
export const onRouterTransitionStart = (
  ...args: Parameters<typeof import('@sentry/nextjs')['captureRouterTransitionStart']>
): void => {
  void sentryIfStarted()
    ?.then((Sentry) => Sentry.captureRouterTransitionStart(...args))
    // A rejected SDK load must not turn every later navigation into an
    // unhandled rejection.
    .catch(() => {});
};

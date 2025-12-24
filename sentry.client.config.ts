/**
 * Sentry Client Configuration
 * Milestone 9.1 - Error Monitoring
 *
 * This file configures the initialization of Sentry on the client.
 * The config you add here will be used whenever a page is visited.
 * https://docs.sentry.io/platforms/javascript/guides/nextjs/
 */

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Only enable in production
  enabled: process.env.NODE_ENV === 'production',

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

  // Filter out noisy errors
  ignoreErrors: [
    // Browser extensions
    /extensions\//i,
    /^chrome:\/\//i,
    // Network errors that are expected
    'Network request failed',
    'Failed to fetch',
    'Load failed',
    // Rate limiting (expected behavior)
    'Too many requests',
  ],

  // Add context about the user (FID if available)
  beforeSend(event) {
    // You can add custom context here
    return event;
  },
});

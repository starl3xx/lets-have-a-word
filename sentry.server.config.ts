/**
 * Sentry Server Configuration
 * Milestone 9.1 - Error Monitoring
 *
 * This file configures the initialization of Sentry on the server.
 * The config you add here will be used whenever the server handles a request.
 * https://docs.sentry.io/platforms/javascript/guides/nextjs/
 */

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Only enable in production
  enabled: process.env.NODE_ENV === 'production',

  // Adjust this value in production, or use tracesSampler for greater control
  tracesSampleRate: 0.1,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,

  // Capture unhandled promise rejections
  integrations: [],

  // Filter out noisy errors
  ignoreErrors: [
    // Expected errors
    'ROUND_ALREADY_RESOLVED',
    // Rate limiting (expected behavior)
    'Too many requests',
  ],

  // Add custom context
  beforeSend(event, hint) {
    // Add round context if available
    const error = hint.originalException;
    if (error && typeof error === 'object' && 'roundId' in error) {
      event.tags = event.tags || {};
      event.tags.roundId = String((error as any).roundId);
    }
    return event;
  },
});

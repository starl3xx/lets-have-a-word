/**
 * Next.js Instrumentation (stable since Next 15)
 *
 * register() runs once per server runtime and loads the matching Sentry
 * server init. onRequestError is the framework-level catch-all: Next calls
 * it for every server-side error with router/route context, so an error in
 * getServerSideProps or an API route reaches Sentry even when no local
 * try/catch reports it.
 */
import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;

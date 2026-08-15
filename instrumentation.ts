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
  // Everything server-side runs on Node now — proxy.ts is Node-only in
  // Next 16 and no route opts into the Edge runtime, so there is no edge
  // branch here. Gated on the DSN like the old next.config wrapping was,
  // so a DSN-less environment stays Sentry-free.
  if (process.env.NEXT_RUNTIME === 'nodejs' && (process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN)) {
    await import('./sentry.server.config');
  }
}

export const onRequestError = Sentry.captureRequestError;

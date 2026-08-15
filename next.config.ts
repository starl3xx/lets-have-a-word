import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Disable type checking during build (we run tsc separately)
  typescript: {
    ignoreBuildErrors: true,
  },
  // A stray package-lock.json in the home directory otherwise makes
  // Turbopack infer the wrong workspace root
  turbopack: {
    root: __dirname,
  },
  // Uncomment and add your tunnel origin when testing the mini app against
  // `next dev` from a phone or tunnel (Next 16 blocks cross-origin dev asset
  // requests by default):
  // allowedDevOrigins: ['https://your-tunnel.example.com'],
};

// Sentry build-time options (source-map upload). Uses the current option
// shape — the webpack-plugin-era options (dryRun, hideSourceMaps) are gone,
// and upload only happens when SENTRY_AUTH_TOKEN is present.
const sentryBuildOptions = {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },
};

// Only wrap with Sentry if DSN is configured
const finalConfig = process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(nextConfig, sentryBuildOptions)
  : nextConfig;

export default finalConfig;

import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The git sha this client bundle was built from, inlined at build time.
  // Compared against /api/round-state's buildSha so a page that Base App has
  // resumed from memory can notice it is running a stale deploy and reload
  // (src/lib/buildFreshness.ts). 'dev' disables the check outside Vercel.
  env: {
    NEXT_PUBLIC_BUILD_SHA: process.env.VERCEL_GIT_COMMIT_SHA || 'dev',
  },
  // Disable type checking during build (we run tsc separately)
  typescript: {
    ignoreBuildErrors: true,
  },
  // Everything in public/ ships with Vercel's default max-age=0
  // must-revalidate, so returning players re-validated every font file on
  // every visit. Fonts are safe to mark immutable: THE RULE is that a
  // changed font gets a NEW FILENAME (soehne-buch-v2.woff2), never an
  // in-place edit — an in-place edit would be invisible to returning
  // clients for a year. Scoped to /fonts only; images are left on the
  // default until they get hashed names.
  async headers() {
    return [
      {
        source: '/fonts/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },
  // A stray package-lock.json in the home directory otherwise makes
  // Turbopack infer the wrong workspace root
  turbopack: {
    root: __dirname,
    // @solana/web3.js arrives through @farcaster/miniapp-core's CJS star
    // re-export (no sideEffects flag, so it cannot be tree-shaken) and cost
    // every player ~60 KB gz on first load, in a Base-only game with zero
    // Solana code. The stub exports every member miniapp-core (and
    // @coinbase/cdp-sdk via @base-org/account) references, each throwing a
    // clear error if a Solana path is ever actually driven. The alias is
    // global to client AND server graphs. RE-CHECK on every
    // @farcaster/miniapp-sdk and @base-org/* upgrade.
    resolveAlias: {
      '@solana/web3.js': './src/lib/solana-stub.ts',
    },
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

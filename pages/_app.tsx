/**
 * _app.tsx - Root Application Component
 *
 * BUG FIX #5 (2025-11-24) - FINAL FIX for /admin/analytics 500 error:
 * Removed WagmiProvider and all Farcaster-related imports from _app.tsx.
 *
 * Root cause:
 * The wagmi config imports @farcaster/miniapp-wagmi-connector, which has
 * @farcaster/miniapp-sdk as a peer dependency. This caused the miniapp SDK
 * to be bundled into the server-side code for ALL pages, including /admin/analytics.
 * This caused "SyntaxError: Cannot use import statement outside a module" errors
 * in Vercel because the miniapp SDK is not compatible with Node.js server environment.
 *
 * Solution:
 * - Removed WagmiProvider and QueryClientProvider from _app.tsx entirely
 * - Moved both providers to pages/index.tsx (main game page only)
 * - Admin analytics (/admin/analytics) now has ZERO dependency on Farcaster ecosystem
 * - Admin auth uses SIWN only (NeynarContextProvider is scoped to analytics page)
 *
 * Architecture:
 * - _app.tsx: Minimal, no providers, just global styles
 * - pages/index.tsx: Game page with WagmiProvider + Farcaster SDK
 * - pages/admin/analytics.tsx: Admin page with NeynarContextProvider only
 *
 * Important: @farcaster/miniapp-sdk and wagmi should ONLY be used in:
 * - pages/index.tsx (main game page)
 * - Game-specific components (UserState, SharePromptModal, etc.)
 * - NEVER in _app.tsx, admin pages, or server-side code
 */

import type { AppProps } from 'next/app';
import '../styles/globals.css';
import ErrorBoundary from '../components/ErrorBoundary';

export default function App({ Component, pageProps }: AppProps) {
  // Minimal root app - ErrorBoundary for crash reporting to Sentry
  // Each page handles its own providers:
  // - Game page (/) has WagmiProvider + QueryClientProvider
  // - Admin analytics (/admin/analytics) has NeynarContextProvider
  return (
    <ErrorBoundary>
      <Component {...pageProps} />
    </ErrorBoundary>
  );
}

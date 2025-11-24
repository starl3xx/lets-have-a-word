/**
 * _app.tsx - Root Application Component
 *
 * BUG FIX #4 (2025-11-24):
 * Removed @farcaster/miniapp-sdk import to prevent server-side bundling issues.
 *
 * Root cause:
 * @farcaster/miniapp-sdk was imported in _app.tsx, which meant it was included
 * in the server-side bundle for ALL pages, including /admin/analytics.
 * This caused "SyntaxError: Cannot use import statement outside a module" errors
 * in Vercel because the miniapp SDK is not compatible with Node.js server environment.
 *
 * Solution:
 * - Removed @farcaster/miniapp-sdk import from _app.tsx
 * - Moved Farcaster SDK initialization to pages/index.tsx (main game page only)
 * - Admin analytics (/admin/analytics) now has NO dependency on miniapp SDK
 * - Admin auth uses SIWN only, not Farcaster mini-app context
 *
 * Important: @farcaster/miniapp-sdk should ONLY be imported in:
 * - pages/index.tsx (main game page)
 * - Game-specific components (SharePromptModal, WinnerShareCard, etc.)
 * - NEVER in _app.tsx, admin pages, or server-side code
 */

import type { AppProps } from 'next/app';
import '../styles/globals.css';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { config } from '../src/config/wagmi';

// Create a client for React Query
const queryClient = new QueryClient();

export default function App({ Component, pageProps }: AppProps) {
  // Simple, clean provider tree
  // Farcaster SDK initialization moved to pages/index.tsx (game page only)
  // Neynar is only used on /admin/analytics page (handled there)
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <Component {...pageProps} />
      </QueryClientProvider>
    </WagmiProvider>
  );
}

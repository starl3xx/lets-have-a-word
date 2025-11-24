/**
 * _app.tsx - Root Application Component
 *
 * BUG FIX #3 (2025-11-24) - FINAL FIX:
 * Removed NeynarContextProvider entirely from _app.tsx.
 *
 * Root cause discovered:
 * NeynarContextProvider does NOT support server-side rendering. When included in _app.tsx,
 * it causes React error #31 during SSR with the message:
 * "Objects are not valid as a React child (found: object with keys {$$typeof, type, key, ref, props})"
 *
 * Previous attempts:
 * 1. Conditional returns based on isMounted → Changed tree structure → React #31
 * 2. Build-time conditional → Still tried to SSR the provider → React #31
 *
 * Final solution:
 * Do NOT include NeynarContextProvider in the root _app.tsx at all.
 * Only use it on specific pages that need it (/admin/analytics), and handle it
 * client-side only within those pages.
 *
 * This keeps the main game page (/) free from any Neynar dependencies and prevents
 * any SSR issues with the Neynar provider.
 */

import type { AppProps } from 'next/app';
import { useEffect } from 'react';
import '../styles/globals.css';
import sdk from '@farcaster/miniapp-sdk';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { config } from '../src/config/wagmi';

// Create a client for React Query
const queryClient = new QueryClient();

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    // Initialize Farcaster Miniapp SDK
    const initFarcaster = async () => {
      try {
        // Add frame context to the app
        const context = await sdk.context;
        console.log('Farcaster context:', context);

        // Signal that the app is ready
        sdk.actions.ready();
      } catch (error) {
        console.log('Not in Farcaster context:', error);
      }
    };

    initFarcaster();
  }, []);

  // Simple, clean provider tree without Neynar
  // Neynar is only used on /admin/analytics page (handled there)
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <Component {...pageProps} />
      </QueryClientProvider>
    </WagmiProvider>
  );
}

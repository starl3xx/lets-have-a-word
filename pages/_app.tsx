/**
 * _app.tsx - Root Application Component
 *
 * BUG FIX (2025-11-24):
 * Fixed React error #31 caused by conditional returns changing component tree structure.
 *
 * Root cause:
 * The original code had multiple conditional return statements that rendered different
 * JSX structures based on isMounted and neynarClientId. This caused hydration mismatches:
 * - SSR: Rendered without NeynarContextProvider (isMounted=false)
 * - Client initial: Rendered without NeynarContextProvider (isMounted=false)
 * - After useEffect: Rendered WITH NeynarContextProvider (isMounted=true + clientId set)
 *
 * When the component structure changes between renders, React throws error #31 because
 * it receives an unexpected element type during reconciliation.
 *
 * Solution:
 * Always render a CONSISTENT component tree structure. Use a ConditionalNeynarProvider
 * wrapper that renders the provider only when safe (client-side + clientId set), but
 * always exists in the tree as a passthrough wrapper.
 */

import type { AppProps } from 'next/app';
import { useEffect, useState, type ReactNode } from 'react';
import '../styles/globals.css';
import sdk from '@farcaster/miniapp-sdk';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { config } from '../src/config/wagmi';
import { NeynarContextProvider, Theme } from '@neynar/react';

// Create a client for React Query
const queryClient = new QueryClient();

/**
 * Conditional Neynar Provider Wrapper
 * Always renders consistently, but only activates Neynar provider when safe
 */
function ConditionalNeynarProvider({ children }: { children: ReactNode }) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Only use Neynar provider if client ID is set AND we're on the client
  const neynarClientId = process.env.NEXT_PUBLIC_NEYNAR_CLIENT_ID;
  const shouldUseNeynar = isMounted && neynarClientId;

  if (shouldUseNeynar) {
    return (
      <NeynarContextProvider
        settings={{
          clientId: neynarClientId,
          defaultTheme: Theme.Light,
        }}
      >
        {children}
      </NeynarContextProvider>
    );
  }

  // Passthrough - no Neynar provider, just render children
  return <>{children}</>;
}

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

  // IMPORTANT: Always return the same component structure
  // The ConditionalNeynarProvider handles the logic internally without changing the tree
  return (
    <ConditionalNeynarProvider>
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <Component {...pageProps} />
        </QueryClientProvider>
      </WagmiProvider>
    </ConditionalNeynarProvider>
  );
}

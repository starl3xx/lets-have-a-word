import type { AppProps } from 'next/app';
import { useEffect, useState } from 'react';
import '../styles/globals.css';
import sdk from '@farcaster/miniapp-sdk';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { config } from '../src/config/wagmi';
import { NeynarContextProvider, Theme } from '@neynar/react';

// Create a client for React Query
const queryClient = new QueryClient();

export default function App({ Component, pageProps }: AppProps) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);

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

  // Don't render Neynar provider on server
  if (!isMounted) {
    return (
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <Component {...pageProps} />
        </QueryClientProvider>
      </WagmiProvider>
    );
  }

  // Only use Neynar provider if client ID is set
  const neynarClientId = process.env.NEXT_PUBLIC_NEYNAR_CLIENT_ID;

  if (neynarClientId) {
    return (
      <NeynarContextProvider
        settings={{
          clientId: neynarClientId,
          defaultTheme: Theme.Light,
        }}
      >
        <WagmiProvider config={config}>
          <QueryClientProvider client={queryClient}>
            <Component {...pageProps} />
          </QueryClientProvider>
        </WagmiProvider>
      </NeynarContextProvider>
    );
  }

  // Fallback without Neynar provider (for dev without env vars)
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <Component {...pageProps} />
      </QueryClientProvider>
    </WagmiProvider>
  );
}

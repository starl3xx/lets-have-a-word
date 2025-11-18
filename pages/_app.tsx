import type { AppProps } from 'next/app';
import { useEffect } from 'react';
import '../styles/globals.css';
import sdk from '@farcaster/miniapp-sdk';

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

  return <Component {...pageProps} />;
}

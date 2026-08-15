/**
 * useIsInMiniApp Hook
 *
 * Resolves whether the app is running inside a Farcaster mini-app host
 * (Farcaster mobile webview or web-client iframe) vs. plain web.
 *
 * Starts as `false` (plain-web behavior) and flips to `true` once the SDK
 * confirms a host. On plain web the SDK short-circuits synchronously, so
 * web visitors never flicker; inside a host the context handshake resolves
 * in milliseconds, before a user can realistically click anything.
 */
import { useEffect, useState } from 'react';
import sdk from '@farcaster/miniapp-sdk';

// Module-level cache so late-mounting components get the answer synchronously.
let cachedResult: boolean | null = null;

export function useIsInMiniApp(): boolean {
  const [isInMiniApp, setIsInMiniApp] = useState<boolean>(cachedResult === true);

  useEffect(() => {
    if (cachedResult !== null) {
      setIsInMiniApp(cachedResult);
      return;
    }
    let mounted = true;
    sdk
      .isInMiniApp()
      .then((result) => {
        cachedResult = result;
        if (mounted) setIsInMiniApp(result);
      })
      .catch(() => {
        cachedResult = false;
        if (mounted) setIsInMiniApp(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  return isInMiniApp;
}

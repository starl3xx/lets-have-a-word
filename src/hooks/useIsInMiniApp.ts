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

// Caches only a confirmed `true`, mirroring the SDK: a `false` inside a host
// iframe can be transient (slow context handshake losing the SDK's 1s race),
// so it must be re-asked on the next mount rather than remembered forever.
let confirmedInMiniApp = false;

export function useIsInMiniApp(): boolean {
  const [isInMiniApp, setIsInMiniApp] = useState<boolean>(confirmedInMiniApp);

  useEffect(() => {
    if (confirmedInMiniApp) {
      setIsInMiniApp(true);
      return;
    }
    let mounted = true;
    sdk
      .isInMiniApp()
      .then((result) => {
        if (result) confirmedInMiniApp = true;
        if (mounted) setIsInMiniApp(result);
      })
      .catch(() => {
        if (mounted) setIsInMiniApp(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  return isInMiniApp;
}

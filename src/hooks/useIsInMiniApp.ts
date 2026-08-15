/**
 * useIsInMiniApp Hook
 *
 * Resolves whether the app is running inside a Farcaster mini-app host
 * (Farcaster mobile webview or web-client iframe) vs. anywhere else — which
 * includes plain web AND non-host webviews such as in-app browsers, where
 * sdk.actions.* calls never settle and real anchors/window.open are the
 * paths that work.
 *
 * Returns { inMiniApp, resolved }. `inMiniApp` starts false and flips once a
 * host confirms the handshake. `resolved` says probing has finished: until
 * then `inMiniApp` can still flip, and click handlers that need window.open
 * (which popup blockers kill after an awaited delay) should trust `inMiniApp`
 * only once `resolved` is true, awaiting sdk.isInMiniApp() themselves in the
 * brief pending window.
 */
import { useEffect, useState } from 'react';
import sdk from '@farcaster/miniapp-sdk';

export interface MiniAppProbe {
  inMiniApp: boolean;
  resolved: boolean;
}

// Caches only a confirmed `true`, mirroring the SDK: a `false` inside a host
// can be transient (slow context handshake losing the SDK's 1s race), so it
// must be re-asked rather than remembered forever.
let confirmedInMiniApp = false;

// An iframe or RN webview *might* be a host; a top-level plain window cannot
// be. This only decides whether a first `false` deserves a second probe —
// it must never be treated as host-confirmation itself (non-host webviews
// like in-app browsers also match it).
function inMaybeHostEnvironment(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window !== window.parent ||
      (window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView != null)
  );
}

export function useIsInMiniApp(): MiniAppProbe {
  const [probe, setProbe] = useState<MiniAppProbe>(() =>
    confirmedInMiniApp
      ? { inMiniApp: true, resolved: true }
      : { inMiniApp: false, resolved: false }
  );

  useEffect(() => {
    if (confirmedInMiniApp) {
      setProbe({ inMiniApp: true, resolved: true });
      return;
    }
    let mounted = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const settle = (inMiniApp: boolean) => {
      if (inMiniApp) confirmedInMiniApp = true;
      if (mounted) setProbe({ inMiniApp, resolved: true });
    };

    sdk
      .isInMiniApp()
      .then((result) => {
        if (result || !inMaybeHostEnvironment()) {
          settle(result);
          return;
        }
        // False inside an iframe/RN webview can mean the host lost the SDK's
        // 1s race on a cold start. Probe once more before the no is final.
        retryTimer = setTimeout(() => {
          sdk
            .isInMiniApp()
            .then(settle)
            .catch(() => settle(false));
        }, 1500);
      })
      .catch(() => settle(false));

    return () => {
      mounted = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  return probe;
}

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

// Base App (Coinbase Wallet) is an RN webview, so it passes the maybe-host
// check above — but it stopped hosting Farcaster mini apps on 2026-04-09 and
// will never answer the handshake. Without this, every Base App open pays the
// full retry (~1s race + 1.5s wait + ~1s race) staring at a boot screen for a
// no that was certain from the user agent. If Base App ever hosts again, the
// FIRST probe answers true and this is never consulted.
function isKnownNonHostWebview(): boolean {
  return typeof navigator !== 'undefined' && /CoinbaseWalletRN/i.test(navigator.userAgent);
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
    let settled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const settle = (inMiniApp: boolean) => {
      if (settled) return;
      settled = true;
      if (inMiniApp) confirmedInMiniApp = true;
      if (mounted) setProbe({ inMiniApp, resolved: true });
    };

    // Hard stop: `resolved` gates the entire first paint now (the boot screen
    // in index.tsx), so a probe that never settles must not mean a page that
    // never renders. 5s is past every legitimate path — first race, retry
    // wait, second race — and only fires if the SDK promise itself hangs.
    const hardStop = setTimeout(() => settle(false), 5000);

    sdk
      .isInMiniApp()
      .then((result) => {
        if (result || !inMaybeHostEnvironment() || isKnownNonHostWebview()) {
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
      clearTimeout(hardStop);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  return probe;
}

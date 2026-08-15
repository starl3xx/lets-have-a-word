/**
 * ExternalLink Component
 *
 * The one way to open an external URL from the app. Renders a real anchor
 * so plain-web visitors get a working link (click, cmd-click, right-click
 * copy), and intercepts the click to route through the mini-app SDK's
 * openUrl() only when actually running inside a Farcaster host — where a
 * bare target="_blank" anchor is unreliable and sdk.actions.openUrl() is
 * the supported path.
 *
 * Do not call sdk.actions.openUrl() directly from onClick handlers: outside
 * a mini-app host that call has no listener and silently does nothing,
 * which is exactly the bug this component exists to prevent.
 */
import sdk from '@farcaster/miniapp-sdk';
import { useIsInMiniApp } from '../src/hooks/useIsInMiniApp';

interface ExternalLinkProps {
  href: string;
  className?: string;
  children: React.ReactNode;
}

export default function ExternalLink({ href, className, children }: ExternalLinkProps) {
  const { inMiniApp } = useIsInMiniApp();

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      onClick={(event) => {
        // Intercept only on a CONFIRMED host. Anywhere else — plain web and
        // non-host webviews such as in-app browsers — the real anchor is the
        // path that works, and openUrl would never settle; nothing here may
        // block it. Environment hints (iframe, ReactNativeWebView) are not
        // confirmation and must not preventDefault.
        if (inMiniApp) {
          event.preventDefault();
          sdk.actions.openUrl(href);
        }
      }}
    >
      {children}
    </a>
  );
}

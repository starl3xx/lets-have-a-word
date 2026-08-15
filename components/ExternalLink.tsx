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
  const isInMiniApp = useIsInMiniApp();

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      onClick={(event) => {
        if (isInMiniApp) {
          event.preventDefault();
          sdk.actions.openUrl(href);
        }
      }}
    >
      {children}
    </a>
  );
}

/**
 * Next.js Proxy (formerly middleware.ts) - Prelaunch Splash Routing
 * OG Hunter Campaign: Route gate for prelaunch mode
 *
 * When NEXT_PUBLIC_PRELAUNCH_MODE=1:
 * - Redirects all non-admin, non-API routes to /splash
 * - Allows through:
 *   - /admin/* routes
 *   - /api/* routes
 *   - /splash page itself
 *   - /.well-known/* (Farcaster manifest)
 *   - Static assets (_next, images, etc.)
 *   - /verify page (for transparency)
 *   - /archive/* pages (for transparency)
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyAdminSession, ADMIN_SESSION_COOKIE } from './src/lib/adminSession';

/**
 * Routes that should always be accessible (even in prelaunch mode)
 *
 * ALLOWLIST RATIONALE:
 * - /splash       : The prelaunch landing page itself (must be accessible!)
 * - /admin        : Admin dashboard for operators (protected by auth)
 * - /api          : All API endpoints including:
 *                   - /api/webhook (Farcaster mini app events - CRITICAL for OG Hunter)
 *                   - /api/og-hunter/* (status, verify-cast, claim)
 *                   - /api/analytics/log (event tracking)
 *                   - /api/user-state (user initialization)
 * - /.well-known  : Farcaster manifest (farcaster.json) - REQUIRED for mini app add flow
 * - /verify       : Onchain verification page (transparency)
 * - /archive      : Round archive pages (transparency)
 * - /_next        : Next.js static assets (JS, CSS bundles)
 * - /favicon.ico  : Browser favicon
 * - /LHAW-        : App assets (icons, hero images)
 * - /screenshot   : Screenshot images for embeds
 */
const ALLOWED_PATHS = [
  '/splash',
  '/admin',
  '/api',
  '/.well-known',
  '/verify',
  '/archive',
  '/_next',
  '/favicon.ico',
  '/LHAW-',
  '/screenshot',
];

// Static file extensions that should always pass through
const STATIC_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.ico',
  '.webp',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.css',
  '.js',
  '.json',
  '.txt',
  '.xml',
];

/**
 * Constant-time string comparison.
 *
 * `crypto.timingSafeEqual` is a Node API and middleware runs on the edge
 * runtime, so it is written out. The practical risk from a non-constant-time
 * compare over HTTP is negligible next to network jitter — this is here so the
 * next person does not have to work that out before trusting the line.
 */
function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Gate for /api/admin/*.
 *
 * Until this existed, the only thing standing in front of ~80 admin endpoints
 * was a FID supplied by the caller — as a query parameter, a body field, or an
 * unsigned `siwn_fid` cookie. The admin FIDs were not secret either: they were
 * hardcoded in the admin sign-in component and shipped inside the browser
 * bundle, so `?devFid=6500` was public knowledge rather than a guess. Three
 * endpoints had no check at all.
 *
 * That reaches endpoints which return a round's decrypted answer, send the
 * contract's entire $WORD balance to a caller-supplied address, and pay ETH out
 * of the operator wallet.
 *
 * The gate lives here rather than in each handler for two reasons: one place
 * cannot be forgotten when an endpoint is added, and it covers the three that
 * never had a check in the first place — which a per-endpoint migration would
 * have missed by definition.
 *
 * DORMANT UNTIL CONFIGURED. With ADMIN_SECRET unset this returns immediately
 * and every endpoint behaves exactly as it does today, so deploying this
 * changes nothing on its own. Set ADMIN_SECRET to close the hole.
 *
 * Accepts the secret from a header (for curl and scripts) or a cookie (so the
 * dashboard's existing ~76 fetch calls keep working untouched — the browser
 * attaches it automatically on same-origin requests). A bearer secret in the
 * browser is still a bearer secret, and an XSS on the admin page would reach
 * it. That is a far smaller surface than a value printed in the public bundle.
 */
async function guardAdminApi(request: NextRequest): Promise<NextResponse | null> {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return null;

  // Preferred: a session minted by /api/auth/verify after checking a Sign In
  // With Farcaster signature. This is an assertion about WHICH admin, signed by
  // the server, and it is HttpOnly so page scripts cannot read or copy it.
  const sessionFid = await verifyAdminSession(
    request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    secret
  );
  if (sessionFid !== null) return null;

  // Break-glass: the raw secret, for curl, scripts and recovering when
  // sign-in itself is broken. Weaker than the session — it says only "someone
  // holds the key", not who — so it is checked second and kept deliberately.
  const provided =
    request.headers.get('x-admin-secret') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    request.cookies.get('admin_secret')?.value ??
    '';

  if (secretsMatch(provided, secret)) return null;

  return new NextResponse(
    JSON.stringify({ error: 'Admin authentication required' }),
    { status: 401, headers: { 'content-type': 'application/json' } }
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Before anything else, and independent of prelaunch mode.
  if (pathname.startsWith('/api/admin/')) {
    const denied = await guardAdminApi(request);
    if (denied) return denied;

    // Strip `siwn_fid` before it reaches any handler.
    //
    // 58 admin endpoints still read that cookie as an identity fallback, in
    // two different shapes. It is unsigned and client-settable, and Sign In
    // With Neynar — the only thing that ever legitimately set it — was retired
    // on 2026-08-14, so a request carrying one today is either stale or
    // forged.
    //
    // Removing it here rather than editing 58 handlers: the shapes differ
    // enough that a blanket edit would risk changing control flow in files
    // nobody is going to re-read. This kills the path centrally whatever the
    // handler does with it.
    //
    // Defence in depth rather than the primary control — the guard above
    // already rejects unauthenticated callers. This is what stops the cookie
    // mattering again if ADMIN_SECRET is ever lost or unset.
    if (request.cookies.has('siwn_fid')) {
      const headers = new Headers(request.headers);
      const cookies = request.cookies
        .getAll()
        .filter((c) => c.name !== 'siwn_fid')
        .map((c) => `${c.name}=${c.value}`)
        .join('; ');

      if (cookies) headers.set('cookie', cookies);
      else headers.delete('cookie');

      return NextResponse.next({ request: { headers } });
    }
  }

  // Check if prelaunch mode is enabled
  const isPrelaunchMode = process.env.NEXT_PUBLIC_PRELAUNCH_MODE === '1';

  // If prelaunch mode is disabled, pass through everything
  if (!isPrelaunchMode) {
    return NextResponse.next();
  }

  // Check if path is in allowed list
  const isAllowedPath = ALLOWED_PATHS.some(path =>
    pathname === path || pathname.startsWith(path + '/')
  );

  if (isAllowedPath) {
    return NextResponse.next();
  }

  // Check if it's a static file
  const isStaticFile = STATIC_EXTENSIONS.some(ext =>
    pathname.toLowerCase().endsWith(ext)
  );

  if (isStaticFile) {
    return NextResponse.next();
  }

  // Redirect all other routes to /splash
  const url = request.nextUrl.clone();
  url.pathname = '/splash';

  // Preserve query parameters (for referral tracking, etc.)
  return NextResponse.redirect(url);
}

// Configure which paths the middleware runs on
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};

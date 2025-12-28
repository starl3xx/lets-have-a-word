/**
 * Next.js Middleware - Prelaunch Splash Routing
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

// Routes that should always be accessible (even in prelaunch mode)
const ALLOWED_PATHS = [
  '/splash',
  '/admin',
  '/api',
  '/.well-known',
  '/verify',
  '/archive',
  '/_next',
  '/favicon.ico',
  '/LHAW-',        // All LHAW assets (icons, images)
  '/screenshot',   // Screenshot images
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

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

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

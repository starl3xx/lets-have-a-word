/**
 * Analytics Dashboard
 * Milestone 5.2: Analytics system
 *
 * Web-only admin dashboard with SIWN authentication
 * Displays DAU, WAU, free/paid ratio, jackpot growth, referral funnel, and raw events
 *
 * BUG FIX #6 (2025-11-24) - FINAL FIX for React error #31:
 * Fixed hydration mismatch by making the entire dashboard client-side only.
 *
 * Root cause:
 * NeynarProviderWrapper was conditionally rendering different component trees on server vs client:
 * - Server: <>{children}</>
 * - Client after mount: <NeynarContextProvider>{children}</NeynarContextProvider>
 * This hydration mismatch caused React error #31: "Objects are not valid as a React child"
 *
 * Solution:
 * - Use dynamic import with ssr: false for the entire dashboard
 * - Ensures consistent rendering (no SSR/client mismatch)
 * - Neynar components are always client-side only
 */

import dynamic from 'next/dynamic';

// Load the entire dashboard client-side only to prevent hydration mismatches
const AnalyticsDashboardClientOnly = dynamic(
  () => import('../../components/AnalyticsDashboardClient'),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow-md">
          <p className="text-gray-600">Loading analytics...</p>
        </div>
      </div>
    ),
  }
);

export default function AnalyticsDashboard() {
  return <AnalyticsDashboardClientOnly />;
}

// Disable static generation for this page (client-side only for Neynar)
export async function getServerSideProps() {
  return {
    props: {},
  };
}

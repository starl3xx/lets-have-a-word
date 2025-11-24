/**
 * Analytics Dashboard Client Component
 * Client-side only component for admin analytics dashboard
 *
 * This component is dynamically imported with ssr: false to prevent hydration mismatches
 * with Neynar SIWN authentication components.
 */

'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useNeynarContext, NeynarAuthButton, NeynarContextProvider, Theme } from '@neynar/react';
import Head from 'next/head';

// Tab types
type TabType = 'dau' | 'wau' | 'free-paid' | 'jackpot' | 'referral' | 'events';

/**
 * Dashboard content component
 */
function AnalyticsDashboardContent() {
  // Check if Neynar is configured
  const neynarConfigured = !!process.env.NEXT_PUBLIC_NEYNAR_CLIENT_ID;

  // Get Neynar context (safe to use since we're client-side only)
  let user = null;
  let isAuthenticated = false;

  try {
    const neynarContext = useNeynarContext();
    user = neynarContext.user;
    isAuthenticated = neynarContext.isAuthenticated;
  } catch (error) {
    console.warn('Neynar context unavailable:', error);
  }

  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('dau');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // Check admin status when authenticated
  useEffect(() => {
    if (isAuthenticated && user) {
      checkAdminStatus();
    }
  }, [isAuthenticated, user]);

  // Fetch data when tab changes or admin status is confirmed
  useEffect(() => {
    if (isAdmin) {
      fetchData();
    }
  }, [activeTab, isAdmin]);

  const checkAdminStatus = async () => {
    try {
      const fid = user?.fid;
      if (!fid) {
        setIsAdmin(false);
        return;
      }

      const response = await fetch(`/api/admin/me?devFid=${fid}`);
      const result = await response.json();

      if (response.ok && result.isAdmin) {
        setIsAdmin(true);
      } else {
        setIsAdmin(false);
      }
    } catch (err) {
      console.error('Failed to check admin status:', err);
      setIsAdmin(false);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    setError(null);

    try {
      const fid = user?.fid || '';
      const response = await fetch(`/api/admin/analytics/${activeTab}?devFid=${fid}`);

      if (!response.ok) {
        throw new Error('Failed to fetch data');
      }

      const result = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  // Check if Neynar is configured
  if (!neynarConfigured) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <Head>
          <title>Analytics - Let&apos;s Have A Word</title>
        </Head>
        <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full">
          <h1 className="text-2xl font-bold mb-4 text-orange-600">Configuration Required</h1>
          <p className="mb-4 text-gray-600">
            The analytics dashboard requires Neynar SIWN to be configured.
          </p>
          <p className="text-sm text-gray-500 font-mono bg-gray-50 p-2 rounded">
            NEXT_PUBLIC_NEYNAR_CLIENT_ID is not set
          </p>
        </div>
      </div>
    );
  }

  // Not authenticated - show login button
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <Head>
          <title>Analytics - Let&apos;s Have A Word</title>
        </Head>
        <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full">
          <h1 className="text-2xl font-bold mb-4">Analytics Dashboard</h1>
          <p className="mb-6 text-gray-600">
            Sign in with your Farcaster account to access the analytics dashboard.
          </p>
          <NeynarAuthButton />
        </div>
      </div>
    );
  }

  // Authenticated but checking admin status
  if (isAdmin === null) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <Head>
          <title>Analytics - Let&apos;s Have A Word</title>
        </Head>
        <div className="bg-white p-8 rounded-lg shadow-md">
          <p className="text-gray-600">Checking admin access...</p>
        </div>
      </div>
    );
  }

  // Not an admin
  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <Head>
          <title>Analytics - Let&apos;s Have A Word</title>
        </Head>
        <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full">
          <h1 className="text-2xl font-bold mb-4 text-red-600">Access Denied</h1>
          <p className="mb-6 text-gray-600">
            You do not have permission to access the analytics dashboard.
          </p>
          <p className="text-sm text-gray-500">
            FID: {user?.fid}
          </p>
        </div>
      </div>
    );
  }

  // Admin - show dashboard
  return (
    <div className="min-h-screen bg-gray-100">
      <Head>
        <title>Analytics Dashboard - Let&apos;s Have A Word</title>
      </Head>

      {/* Header */}
      <div className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Analytics Dashboard</h1>
              <p className="text-sm text-gray-600">
                Signed in as @{user?.username || user?.display_name} (FID: {user?.fid})
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="border-b border-gray-200 mb-6">
          <nav className="-mb-px flex space-x-8">
            {[
              { id: 'dau', label: 'DAU' },
              { id: 'wau', label: 'WAU' },
              { id: 'free-paid', label: 'Free/Paid Ratio' },
              { id: 'jackpot', label: 'Jackpot Growth' },
              { id: 'referral', label: 'Referral Funnel' },
              { id: 'events', label: 'Raw Events' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabType)}
                className={`
                  py-2 px-1 border-b-2 font-medium text-sm
                  ${
                    activeTab === tab.id
                      ? 'border-purple-600 text-purple-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }
                `}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="bg-white rounded-lg shadow p-6">
          {loading && (
            <div className="text-center py-12">
              <p className="text-gray-600">Loading data...</p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded p-4 mb-4">
              <p className="text-red-800">Error: {error}</p>
            </div>
          )}

          {!loading && !error && data && (
            <div>
              {activeTab === 'dau' && <DAUView data={data} />}
              {activeTab === 'wau' && <WAUView data={data} />}
              {activeTab === 'free-paid' && <FreePaidView data={data} />}
              {activeTab === 'jackpot' && <JackpotView data={data} />}
              {activeTab === 'referral' && <ReferralView data={data} />}
              {activeTab === 'events' && <EventsView data={data} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// DAU View Component
function DAUView({ data }: { data: any[] }) {
  if (!data || data.length === 0) {
    return <p className="text-gray-600">No DAU data available</p>;
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Daily Active Users</h2>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Active Users</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {data.map((row, i) => (
              <tr key={i}>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{row.day}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{row.active_users}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// WAU View Component
function WAUView({ data }: { data: any[] }) {
  if (!data || data.length === 0) {
    return <p className="text-gray-600">No WAU data available</p>;
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Weekly Active Users</h2>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Week Start</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Active Users</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {data.map((row, i) => (
              <tr key={i}>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{row.week_start}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{row.active_users}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Free/Paid View Component
function FreePaidView({ data }: { data: any[] }) {
  if (!data || data.length === 0) {
    return <p className="text-gray-600">No free/paid data available</p>;
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Free vs Paid Guesses</h2>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Free Guesses</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Paid Guesses</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ratio</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {data.map((row, i) => (
              <tr key={i}>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{row.day}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{row.free_guesses}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{row.paid_guesses}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {row.free_to_paid_ratio ? row.free_to_paid_ratio.toFixed(2) : 'N/A'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Jackpot View Component
function JackpotView({ data }: { data: any[] }) {
  if (!data || data.length === 0) {
    return <p className="text-gray-600">No jackpot data available</p>;
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Jackpot Growth</h2>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Round ID</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Jackpot (ETH)</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Winner FID</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {data.map((row, i) => (
              <tr key={i}>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{row.day}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{row.round_id}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{row.jackpot_eth}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{row.winner_fid || 'N/A'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Referral View Component
function ReferralView({ data }: { data: any[] }) {
  if (!data || data.length === 0) {
    return <p className="text-gray-600">No referral data available</p>;
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Referral Funnel</h2>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Shares</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Joins</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Wins</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Bonus Unlocked</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {data.map((row, i) => (
              <tr key={i}>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{row.day}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{row.referral_shares}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{row.referral_joins}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{row.referral_wins}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{row.bonus_unlocked}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Events View Component
function EventsView({ data }: { data: any }) {
  if (!data || !data.events || data.events.length === 0) {
    return <p className="text-gray-600">No events available</p>;
  }

  const [expandedId, setExpandedId] = useState<number | null>(null);

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Raw Events</h2>
      <p className="text-sm text-gray-600 mb-4">
        Showing {data.events.length} of {data.total} events (Page {data.page})
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created At</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Event Type</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User ID</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Round ID</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {data.events.map((event: any) => (
              <>
                <tr key={event.id} className={expandedId === event.id ? 'bg-gray-50' : ''}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {new Date(event.created_at).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{event.event_type}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{event.user_id || 'N/A'}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{event.round_id || 'N/A'}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <button
                      onClick={() => setExpandedId(expandedId === event.id ? null : event.id)}
                      className="text-purple-600 hover:text-purple-800"
                    >
                      {expandedId === event.id ? 'Hide' : 'Show'} Data
                    </button>
                  </td>
                </tr>
                {expandedId === event.id && (
                  <tr>
                    <td colSpan={5} className="px-6 py-4 bg-gray-50">
                      <pre className="text-xs overflow-auto">{JSON.stringify(event.data, null, 2)}</pre>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Main export - wraps the dashboard content with Neynar provider
export default function AnalyticsDashboardClient() {
  const neynarClientId = process.env.NEXT_PUBLIC_NEYNAR_CLIENT_ID;

  if (!neynarClientId) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full">
          <h1 className="text-2xl font-bold mb-4 text-orange-600">Configuration Required</h1>
          <p className="mb-4 text-gray-600">
            The analytics dashboard requires Neynar SIWN to be configured.
          </p>
          <p className="text-sm text-gray-500 font-mono bg-gray-50 p-2 rounded">
            NEXT_PUBLIC_NEYNAR_CLIENT_ID is not set
          </p>
        </div>
      </div>
    );
  }

  return (
    <NeynarContextProvider
      settings={{
        clientId: neynarClientId,
        defaultTheme: Theme.Light,
      }}
    >
      <AnalyticsDashboardContent />
    </NeynarContextProvider>
  );
}

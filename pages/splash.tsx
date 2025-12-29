/**
 * Splash Page - Prelaunch OG Hunter Campaign
 *
 * Landing page shown during prelaunch mode (NEXT_PUBLIC_PRELAUNCH_MODE=1).
 * Features the OG Hunter badge campaign with two-step verification:
 * 1. Add the app
 * 2. Share via Farcaster cast
 *
 * Rewards: OG Hunter badge + 500 XP
 */

import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import sdk from '@farcaster/miniapp-sdk';
import type { OgHunterStatus } from '../src/lib/og-hunter';

// Font family consistent with main app
const FONT_FAMILY = "'Soehne', 'SF Pro Display', system-ui, -apple-system, sans-serif";

// Farcaster Mini App embed metadata (must be stringified JSON)
const fcFrameEmbed = JSON.stringify({
  version: "1",
  imageUrl: "https://letshaveaword.fun/LHAW-hero3.png",
  button: {
    title: "Play now",
    action: {
      type: "launch_frame",
      name: "Let's Have A Word!",
      url: "https://letshaveaword.fun",
      splashImageUrl: "https://letshaveaword.fun/LHAW-splash.png",
      splashBackgroundColor: "#8c81a8"
    }
  }
});

// Helper to log analytics events (fire-and-forget)
function logAnalytics(eventType: string, fid?: number, data?: Record<string, unknown>) {
  fetch('/api/analytics/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventType,
      userId: fid?.toString(),
      data,
    }),
  }).catch(() => {
    // Silently ignore - analytics should never block UI
  });
}

export default function SplashPage() {
  const [fid, setFid] = useState<number | null>(null);
  const [status, setStatus] = useState<OgHunterStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAddingApp, setIsAddingApp] = useState(false);
  const [hasAddedLocally, setHasAddedLocally] = useState(false); // Track local add before webhook confirms
  const [isVerifying, setIsVerifying] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize SDK and get FID
  useEffect(() => {
    const initializeSdk = async () => {
      try {
        const context = await sdk.context;
        if (context?.user?.fid) {
          setFid(context.user.fid);
        }
        await sdk.actions.ready();
      } catch (err) {
        console.error('[Splash] SDK initialization error:', err);
      }
    };

    initializeSdk();
  }, []);

  // Fetch OG Hunter status when FID is available
  const fetchStatus = useCallback(async () => {
    if (!fid) return;

    try {
      const response = await fetch(`/api/og-hunter/status?fid=${fid}`);
      const data = await response.json();
      setStatus(data);
    } catch (err) {
      console.error('[Splash] Error fetching status:', err);
    } finally {
      setIsLoading(false);
    }
  }, [fid]);

  useEffect(() => {
    if (fid) {
      fetchStatus();
      // Log splash view
      logAnalytics('splash_view', fid);
    } else {
      // Still loading SDK context
      const timeout = setTimeout(() => setIsLoading(false), 3000);
      return () => clearTimeout(timeout);
    }
  }, [fid, fetchStatus]);

  // Handle "Add Mini App" click
  const handleAddMiniApp = async () => {
    setIsAddingApp(true);
    setError(null);
    logAnalytics('og_hunter_add_miniapp_click', fid || undefined);

    try {
      const result = await sdk.actions.addMiniApp();

      // If user added the app, show immediate feedback
      if (result.added || result.notificationDetails) {
        setHasAddedLocally(true);
        // Small delay to allow webhook to process, then fetch confirmed status
        await new Promise(resolve => setTimeout(resolve, 1500));
        await fetchStatus();
      }
    } catch (err) {
      console.log('[Splash] Mini app add declined or failed:', err);
      // User likely cancelled - this is fine
    } finally {
      setIsAddingApp(false);
    }
  };

  // Handle "Cast This" click - opens composer with embed
  const handleCastIntent = async () => {
    if (!status) return;
    logAnalytics('og_hunter_cast_intent_click', fid || undefined);

    // Use composeCast with embeds for auto-loading embed preview
    await sdk.actions.composeCast({
      text: status.shareText,
      embeds: ['https://letshaveaword.fun'],
    });
  };

  // Handle "Verify My Cast" click
  const handleVerifyCast = async () => {
    if (!fid) return;

    setIsVerifying(true);
    setError(null);

    try {
      const response = await fetch('/api/og-hunter/verify-cast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fid }),
      });

      const data = await response.json();

      if (data.success) {
        setStatus(data.status);
        logAnalytics('og_hunter_verify_cast_success', fid);
      } else {
        setError(data.error || 'Failed to verify cast');
        logAnalytics('og_hunter_verify_cast_fail', fid, { reason: data.error });
      }
    } catch (err) {
      console.error('[Splash] Error verifying cast:', err);
      setError('Failed to verify cast. Please try again.');
      logAnalytics('og_hunter_verify_cast_fail', fid, { reason: 'network_error' });
    } finally {
      setIsVerifying(false);
    }
  };

  // Handle "Claim Badge" click
  const handleClaimBadge = async () => {
    if (!fid) return;

    setIsClaiming(true);
    setError(null);

    try {
      const response = await fetch('/api/og-hunter/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fid }),
      });

      const data = await response.json();

      if (data.success) {
        setStatus(data.status);
        if (data.status?.isAwarded) {
          logAnalytics('og_hunter_claim_success', fid);
        } else {
          logAnalytics('og_hunter_claim_already_awarded', fid);
        }
      } else {
        setError(data.error || 'Failed to claim badge');
        logAnalytics('og_hunter_claim_ineligible', fid, { reason: data.error });
      }
    } catch (err) {
      console.error('[Splash] Error claiming badge:', err);
      setError('Failed to claim badge. Please try again.');
    } finally {
      setIsClaiming(false);
    }
  };


  return (
    <>
      <Head>
        <title>OG Hunter | Let's Have A Word</title>
        <meta
          name="description"
          content="Become an OG Hunter before launch and earn your exclusive badge + 500 XP"
        />
        {/* Open Graph meta tags for rich embeds */}
        <meta property="og:title" content="Let's Have A Word!" />
        <meta property="og:description" content="A global word hunt where everyone eliminates wrong answers until one player hits the ETH jackpot" />
        <meta property="og:image" content="https://letshaveaword.fun/LHAW-hero3.png" />
        <meta property="og:url" content="https://letshaveaword.fun" />
        <meta property="og:type" content="website" />
        {/* Farcaster Mini App embed for rich sharing */}
        <meta name="fc:miniapp" content={fcFrameEmbed} />
        {/* Backward compatibility for older Farcaster clients */}
        <meta name="fc:frame" content={fcFrameEmbed} />
      </Head>

      <main
        className="min-h-screen bg-gradient-to-b from-purple-50 to-white"
        style={{ fontFamily: FONT_FAMILY }}
      >
        {/* Hero Section */}
        <div className="px-4 pt-4 pb-8 text-center">
          {/* App Icon */}
          <img
            src="https://letshaveaword.fun/LHAW-icon.png"
            alt="Let's Have A Word"
            className="w-14 h-14 rounded-xl mx-auto mb-4"
          />

          <div className="inline-block mb-4 px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm font-medium">
            Prelaunch Campaign
          </div>

          <h1 className="text-3xl font-bold text-gray-900 mb-3">
            Become an OG Hunter
          </h1>

          <p className="text-gray-600 max-w-md mx-auto">
            Let's Have A Word! is a social word game where everyone guesses together. Join before launch to earn your exclusive badge and 500 XP.
          </p>
        </div>

        {/* OG Hunter Module */}
        <div className="max-w-md mx-auto px-4 pb-8">
          {isLoading ? (
            <LoadingState />
          ) : !fid ? (
            <NoFidState />
          ) : status?.isAwarded ? (
            <AwardedState status={status} />
          ) : (
            <ChecklistState
              status={status}
              error={error}
              isAddingApp={isAddingApp}
              hasAddedLocally={hasAddedLocally}
              isVerifying={isVerifying}
              isClaiming={isClaiming}
              onAddMiniApp={handleAddMiniApp}
              onCastIntent={handleCastIntent}
              onVerifyCast={handleVerifyCast}
              onClaimBadge={handleClaimBadge}
            />
          )}
        </div>

        {/* Footer Info */}
        <div className="px-4 pb-8 text-center">
          <p className="text-xs text-gray-400 max-w-sm mx-auto">
            The OG Hunter badge is permanent and will be displayed on your profile once the game launches.
          </p>
        </div>
      </main>
    </>
  );
}

// Loading state component
function LoadingState() {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 text-center">
      <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
      <p className="text-gray-500 text-sm">Loading...</p>
    </div>
  );
}

// No FID state (not in Farcaster context)
function NoFidState() {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 text-center">
      <div className="text-4xl mb-3">🦊</div>
      <h3 className="font-semibold text-gray-900 mb-2">Open in Warpcast</h3>
      <p className="text-gray-500 text-sm">
        To participate in the OG Hunter campaign, please open this app in Warpcast.
      </p>
    </div>
  );
}

// Awarded state (user already has badge)
function AwardedState({ status }: { status: OgHunterStatus }) {
  return (
    <div className="bg-gradient-to-b from-green-50 to-white rounded-2xl border border-green-200 shadow-sm p-6 text-center">
      <div className="text-5xl mb-4">🏆</div>
      <h3 className="text-xl font-bold text-green-700 mb-2">
        You're an OG Hunter!
      </h3>
      <p className="text-green-600 text-sm mb-4">
        Badge earned on {status.awardedAt ? new Date(status.awardedAt).toLocaleDateString() : 'recently'}
      </p>

      <div className="bg-white rounded-xl border border-green-100 p-4">
        <div className="flex items-center justify-center gap-3">
          <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
            <span className="text-xl">🕵️‍♂️</span>
          </div>
          <div className="text-left">
            <div className="font-semibold text-gray-900">OG Hunter badge</div>
            <div className="text-sm text-gray-500">+{status.xpAwardAmount} XP earned</div>
          </div>
        </div>
      </div>

      <p className="text-xs text-gray-400 mt-4">
        Your badge will be displayed once the game launches.
      </p>
    </div>
  );
}

// Checklist state (in progress)
function ChecklistState({
  status,
  error,
  isAddingApp,
  hasAddedLocally,
  isVerifying,
  isClaiming,
  onAddMiniApp,
  onCastIntent,
  onVerifyCast,
  onClaimBadge,
}: {
  status: OgHunterStatus | null;
  error: string | null;
  isAddingApp: boolean;
  hasAddedLocally: boolean;
  isVerifying: boolean;
  isClaiming: boolean;
  onAddMiniApp: () => void;
  onCastIntent: () => void;
  onVerifyCast: () => void;
  onClaimBadge: () => void;
}) {
  const addedMiniApp = status?.addedMiniAppVerified ?? false;
  const sharedCast = status?.sharedCastVerified ?? false;
  const isEligible = status?.isEligible ?? false;

  // Show completed state if webhook confirmed OR user just added locally
  const showAddedState = addedMiniApp || hasAddedLocally;

  return (
    <div className="space-y-4">
      {/* Progress Card */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Complete these steps</h3>
          <p className="text-sm text-gray-500 mt-1">
            Both steps required to earn your badge and help kick off the first round
          </p>
        </div>

        {/* Step 1: Add Mini App */}
        <div className={`p-4 border-b border-gray-100 ${showAddedState ? 'bg-green-50' : ''}`}>
          <div className="flex items-start gap-3">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
              showAddedState
                ? 'bg-green-500 text-white'
                : 'bg-gray-200 text-gray-500'
            }`}>
              {showAddedState ? '✓' : '1'}
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className={`font-medium ${showAddedState ? 'text-green-700' : 'text-gray-900'}`}>
                  Add the app
                </span>
                {addedMiniApp && (
                  <span className="text-xs text-green-600 font-medium">Verified</span>
                )}
                {hasAddedLocally && !addedMiniApp && (
                  <span className="text-xs text-amber-600 font-medium">Added!</span>
                )}
              </div>
              <p className="text-sm text-gray-500 mt-0.5">
                Add Let's Have A Word to your mini apps
              </p>

              {!showAddedState && (
                <button
                  onClick={onAddMiniApp}
                  disabled={isAddingApp}
                  className="mt-3 w-full px-4 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {isAddingApp ? 'Adding...' : 'Add app'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Step 2: Share via Cast */}
        <div className={`p-4 ${sharedCast ? 'bg-green-50' : ''}`}>
          <div className="flex items-start gap-3">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
              sharedCast
                ? 'bg-green-500 text-white'
                : 'bg-gray-200 text-gray-500'
            }`}>
              {sharedCast ? '✓' : '2'}
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className={`font-medium ${sharedCast ? 'text-green-700' : 'text-gray-900'}`}>
                  Share via cast
                </span>
                {sharedCast && (
                  <span className="text-xs text-green-600 font-medium">Verified</span>
                )}
              </div>
              <p className="text-sm text-gray-500 mt-0.5">
                Share the game so more players can join the first round and guess together
              </p>

              {!sharedCast && (
                <div className="mt-3 space-y-2">
                  <button
                    onClick={onCastIntent}
                    className="w-full px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    Cast this
                  </button>
                  <button
                    onClick={onVerifyCast}
                    disabled={isVerifying}
                    className="w-full px-4 py-2.5 bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 text-gray-700 disabled:text-gray-400 rounded-lg text-sm font-medium transition-colors"
                  >
                    {isVerifying ? 'Verifying...' : 'Verify my cast'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Claim Button */}
      {isEligible && (
        <button
          onClick={onClaimBadge}
          disabled={isClaiming}
          className="w-full px-4 py-4 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 disabled:from-purple-300 disabled:to-blue-300 text-white rounded-2xl text-lg font-semibold transition-all shadow-lg shadow-purple-200"
        >
          {isClaiming ? 'Claiming...' : `Claim OG Hunter badge + ${status?.xpAwardAmount || 500} XP`}
        </button>
      )}

      {/* Reward Preview */}
      <div className="bg-purple-50 rounded-2xl border border-purple-100 p-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
            <span className="text-2xl">🕵️‍♂️</span>
          </div>
          <div>
            <div className="font-semibold text-purple-900">OG Hunter badge</div>
            <div className="text-sm text-purple-600">+{status?.xpAwardAmount || 500} XP</div>
          </div>
        </div>
      </div>

      {/* Launch Info Callout */}
      <div className="bg-gray-50 rounded-2xl border border-gray-200 p-4 text-sm text-gray-600">
        <p>
          Let's Have A Word! is set to launch <strong>very soon</strong> with a Round #1 prize pool starting at 0.1 ETH.{' '}
          <a
            href="https://farcaster.xyz/starl3xx.eth/0x7cbca1fd"
            target="_blank"
            rel="noopener noreferrer"
            className="text-purple-600 hover:text-purple-700 underline"
          >
            Read more about the game
          </a>
          .
        </p>
      </div>
    </div>
  );
}

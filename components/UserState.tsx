import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import type { UserStateResponse } from '../pages/api/user-state';
import type { GuessSourceState } from '../src/types';
import GuessBar from './GuessBar';

interface UserStateProps {
  fid: number | null;
  onGetMore?: () => void;
  onClanktonHintTap?: () => void;
}

/**
 * Initial fallback state for GuessBar
 * Shown on first load before data arrives
 * Uses neutral/minimal values (0 guesses, all sources empty)
 */
const INITIAL_FALLBACK_SOURCE_STATE: GuessSourceState = {
  totalRemaining: 0,
  free: {
    total: 1,
    used: 1,
    remaining: 0,
  },
  clankton: {
    total: 0,
    used: 0,
    remaining: 0,
    isHolder: false,
  },
  share: {
    total: 0,
    used: 0,
    remaining: 0,
    hasSharedToday: false,
    canClaimBonus: true,
  },
  paid: {
    total: 0,
    used: 0,
    remaining: 0,
    packsPurchased: 0,
    maxPacksPerDay: 3,
    canBuyMore: true,
  },
};

/**
 * Module-level cache for stale-while-revalidate
 * Persists across component remounts (e.g., when key={userStateKey} changes)
 * This ensures the GuessBar never shrinks or flickers during refetches
 */
let cachedSourceState: GuessSourceState | null = null;

/**
 * UserState Component
 * Milestone 4.1: Displays user's daily guess allocations and CLANKTON bonus status
 * Milestone 6.5: Uses unified GuessBar component for source-level display
 * Milestone 6.8: Dev mode uses real Farcaster wallet and CLANKTON balance
 * Milestone 6.8: Stale-while-revalidate - never shows "Loading..." text
 *
 * Shows:
 * - Total guesses remaining (in pill)
 * - Source breakdown with depletion status
 *
 * Behavior:
 * - First load: shows fallback state until data arrives
 * - Refreshes: keeps showing last known state until new data ready
 * - Never collapses to "Loading..." text
 * - Uses module-level cache to persist state across remounts
 */
export default function UserState({ fid, onGetMore, onClanktonHintTap }: UserStateProps) {
  const [userState, setUserState] = useState<UserStateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Get connected wallet from Wagmi
  const { address: walletAddress } = useAccount();

  // Update module-level cache whenever we get new data
  useEffect(() => {
    if (userState?.sourceState) {
      cachedSourceState = userState.sourceState;
    }
  }, [userState]);

  /**
   * Fetch user state from API with retry logic
   */
  const fetchUserState = async (retryCount = 0) => {
    if (!fid) {
      console.log('[UserState] No FID available yet');
      return;
    }

    try {
      // Build query params
      const params = new URLSearchParams();
      params.append('devFid', fid.toString());

      // Include wallet address if connected
      if (walletAddress) {
        params.append('walletAddress', walletAddress);
        console.log('[UserState] Using connected wallet:', walletAddress);
      } else {
        console.log('[UserState] No wallet connected yet, using FID only');
      }

      const url = `/api/user-state?${params.toString()}`;
      console.log('[UserState] Fetching:', url);

      const response = await fetch(url, {
        // Add timeout for mobile networks
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      console.log('[UserState] Response status:', response.status);

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
          console.error('[UserState] API error response:', errorData);
        } catch (parseError) {
          console.error('[UserState] Failed to parse error response:', parseError);
          errorData = { error: 'Server error (invalid JSON response)' };
        }

        // Use detailed error message if available
        const errorMsg = errorData.details || errorData.error || `HTTP ${response.status}`;
        throw new Error(errorMsg);
      }

      const data: UserStateResponse = await response.json();
      console.log('[UserState] Success! User state:', data);
      setUserState(data);
      setError(null);
    } catch (err: unknown) {
      console.error('[UserState] Error fetching user state:', err);

      // Retry logic for network errors (max 2 retries)
      const isNetworkError = err instanceof TypeError || (err instanceof Error && err.name === 'AbortError');
      if (retryCount < 2 && isNetworkError) {
        console.log(`[UserState] Retrying... (attempt ${retryCount + 1}/2)`);
        setTimeout(() => fetchUserState(retryCount + 1), 1000 * (retryCount + 1));
        return;
      }

      const errorMessage = err instanceof Error ? err.message : 'Failed to load';
      setError(errorMessage);
    }
  };

  /**
   * Fetch on mount and when FID or wallet changes
   */
  useEffect(() => {
    fetchUserState();
  }, [fid, walletAddress]);

  /**
   * Determine which source state to display:
   * 1. Current data (if available)
   * 2. Cached state from previous fetch (stale-while-revalidate)
   * 3. Initial fallback (first load ever)
   */
  const displaySourceState =
    userState?.sourceState ??
    cachedSourceState ??
    INITIAL_FALLBACK_SOURCE_STATE;

  /**
   * Error state - show error but keep showing the bar
   * Only show error text if we have no data to display at all
   */
  if (error && !userState && !cachedSourceState) {
    return (
      <div className="text-center py-2" style={{ minHeight: '2.5rem' }}>
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  /**
   * Display user state - Milestone 6.5: Unified GuessBar component
   * Milestone 6.8: Always render GuessBar, never show "Loading..."
   * IMPORTANT: Use py-2 and min-height to prevent layout shifts when remounting (Milestone 4.14)
   */
  return (
    <GuessBar
      sourceState={displaySourceState}
      onGetMore={onGetMore}
      onClanktonHintTap={onClanktonHintTap}
    />
  );
}

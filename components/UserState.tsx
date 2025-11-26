import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import type { UserStateResponse } from '../pages/api/user-state';
import { useDevPersona } from '../src/contexts/DevPersonaContext';
import GuessBar from './GuessBar';

interface UserStateProps {
  fid: number | null;
}

/**
 * UserState Component
 * Milestone 4.1: Displays user's daily guess allocations and CLANKTON bonus status
 * Milestone 6.4.7: Supports dev persona overrides for QA testing
 * Milestone 6.5: Uses unified GuessBar component for source-level display
 *
 * Shows:
 * - Total guesses remaining
 * - Source breakdown with depletion status
 */
export default function UserState({ fid }: UserStateProps) {
  const [userState, setUserState] = useState<UserStateResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Get connected wallet from Wagmi
  const { address: walletAddress, isConnected } = useAccount();

  // Milestone 6.4.7: Get dev persona overrides
  const { applyOverrides, currentPersonaId, isDevMode } = useDevPersona();

  /**
   * Fetch user state from API with retry logic
   */
  const fetchUserState = async (retryCount = 0) => {
    if (!fid) {
      console.log('[UserState] No FID available yet');
      setIsLoading(false);
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
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Fetch on mount and when FID or wallet changes
   */
  useEffect(() => {
    fetchUserState();
  }, [fid, walletAddress]);

  /**
   * Loading state - minimal
   * IMPORTANT: Use py-2 and min-height to match actual state and prevent layout shifts (Milestone 4.14)
   */
  if (isLoading) {
    return (
      <div className="text-center py-2" style={{ minHeight: '2.5rem' }}>
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    );
  }

  /**
   * Error state - minimal, floating on top
   * IMPORTANT: Use py-2 and min-height to match actual state and prevent layout shifts (Milestone 4.14)
   */
  if (error) {
    return (
      <div className="text-center py-2" style={{ minHeight: '2.5rem' }}>
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  /**
   * Not authenticated - minimal
   * IMPORTANT: Use py-2 and min-height to match actual state and prevent layout shifts (Milestone 4.14)
   */
  if (!fid) {
    return (
      <div className="text-center py-2" style={{ minHeight: '2.5rem' }}>
        <p className="text-sm text-gray-500">Connecting...</p>
      </div>
    );
  }

  if (!userState) {
    return (
      <div className="text-center py-2" style={{ minHeight: '2.5rem' }}>
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    );
  }

  // Milestone 6.4.7: Apply dev persona overrides if active
  const displayState = applyOverrides(userState);

  /**
   * Display user state - Milestone 6.5: Unified GuessBar component
   * IMPORTANT: Use py-2 and min-height to prevent layout shifts when remounting (Milestone 4.14)
   */
  return (
    <GuessBar
      sourceState={displayState.sourceState}
      isDevMode={isDevMode}
      personaActive={currentPersonaId !== 'real'}
    />
  );
}

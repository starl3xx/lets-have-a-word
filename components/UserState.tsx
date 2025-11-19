import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import type { UserStateResponse } from '../pages/api/user-state';

interface UserStateProps {
  fid: number | null;
}

/**
 * UserState Component
 * Milestone 4.1: Displays user's daily guess allocations and CLANKTON bonus status
 *
 * Shows:
 * - Free guesses remaining (with breakdown: base + CLANKTON + share)
 * - Paid guesses remaining
 * - CLANKTON bonus status (active/inactive)
 * - Option to buy more guess packs
 */
export default function UserState({ fid }: UserStateProps) {
  const [userState, setUserState] = useState<UserStateResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Get connected wallet from Wagmi
  const { address: walletAddress, isConnected } = useAccount();

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
    } catch (err) {
      console.error('[UserState] Error fetching user state:', err);

      // Retry logic for network errors (max 2 retries)
      if (retryCount < 2 && (err instanceof TypeError || err.name === 'AbortError')) {
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
   */
  if (isLoading) {
    return (
      <div className="text-center py-1">
        <p className="text-xs text-gray-500">Loading...</p>
      </div>
    );
  }

  /**
   * Error state - minimal, floating on top
   */
  if (error) {
    return (
      <div className="text-center py-1">
        <p className="text-xs text-red-600">{error}</p>
      </div>
    );
  }

  /**
   * Not authenticated - minimal
   */
  if (!fid || !userState) {
    return (
      <div className="text-center py-1">
        <p className="text-xs text-gray-600">
          {!fid && 'Please connect your Farcaster account'}
          {fid && !isConnected && 'Connecting...'}
          {fid && isConnected && !userState && 'Loading...'}
        </p>
      </div>
    );
  }

  /**
   * Display user state - minimal plain text
   */
  return (
    <div className="text-center py-1">
      <p className="text-xs text-gray-700">
        <span className="font-semibold text-gray-900">{userState.totalGuessesRemaining}</span> {userState.totalGuessesRemaining === 1 ? 'guess' : 'guesses'} remaining
        {userState.freeAllocations.base > 0 && (
          <span className="text-gray-600"> ({userState.freeAllocations.base} free</span>
        )}
        {userState.freeAllocations.clankton > 0 && (
          <span className="text-purple-600 font-medium"> +{userState.freeAllocations.clankton} CLANKTON</span>
        )}
        {userState.freeAllocations.shareBonus > 0 && (
          <span className="text-blue-600"> +{userState.freeAllocations.shareBonus} share</span>
        )}
        {userState.freeGuessesRemaining > 0 && (
          <span className="text-gray-600">)</span>
        )}
        {userState.paidGuessesRemaining > 0 && (
          <span className="text-blue-600 font-medium"> +{userState.paidGuessesRemaining} paid</span>
        )}
      </p>
    </div>
  );
}

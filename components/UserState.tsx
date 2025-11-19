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
   * Fetch user state from API
   */
  const fetchUserState = async () => {
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

      const response = await fetch(url);

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
      const errorMessage = err instanceof Error ? err.message : 'Failed to load user status';

      // Don't show authentication errors as errors - they're expected during initial load
      if (errorMessage.includes('Authentication') || errorMessage.includes('401')) {
        console.log('[UserState] Authentication pending, will retry');
        setError(null);
      } else {
        setError(errorMessage);
      }
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
   * Loading state
   */
  if (isLoading) {
    return (
      <p className="text-xs text-gray-400 text-center">
        Loading...
      </p>
    );
  }

  /**
   * Error state
   */
  if (error) {
    return (
      <p className="text-xs text-red-500 text-center">{error}</p>
    );
  }

  /**
   * Not authenticated or wallet not connected
   */
  if (!fid || !userState) {
    return (
      <p className="text-xs text-gray-400 text-center">
        {!fid && 'Connecting...'}
        {fid && !isConnected && 'Connecting wallet...'}
        {fid && isConnected && !userState && 'Loading...'}
      </p>
    );
  }

  /**
   * Display user state - minimal plain text format
   */
  const parts = [];

  // Free guesses with breakdown
  if (userState.freeGuessesRemaining > 0) {
    const breakdown = [];
    if (userState.freeAllocations.base > 0) {
      breakdown.push(`${userState.freeAllocations.base} free`);
    }
    if (userState.freeAllocations.clankton > 0) {
      breakdown.push(`${userState.freeAllocations.clankton} CLANKTON`);
    }
    if (userState.freeAllocations.shareBonus > 0) {
      breakdown.push(`${userState.freeAllocations.shareBonus} share bonus`);
    }
    parts.push(breakdown.join(' + '));
  }

  // Paid guesses
  if (userState.paidGuessesRemaining > 0) {
    parts.push(`${userState.paidGuessesRemaining} paid`);
  }

  // No guesses left
  if (userState.totalGuessesRemaining === 0) {
    parts.push('No guesses left today');
  }

  return (
    <p className="text-xs text-gray-600 text-center">
      {parts.length > 0 ? parts.join(' • ') : 'No guesses remaining'}
    </p>
  );
}

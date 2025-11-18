import { useEffect, useState } from 'react';
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

  /**
   * Fetch user state from API
   */
  const fetchUserState = async () => {
    if (!fid) {
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch(`/api/user-state?devFid=${fid}`);

      if (!response.ok) {
        throw new Error('Failed to fetch user state');
      }

      const data: UserStateResponse = await response.json();
      setUserState(data);
      setError(null);
    } catch (err) {
      console.error('Error fetching user state:', err);
      setError('Failed to load user status');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Fetch on mount and when FID changes
   */
  useEffect(() => {
    fetchUserState();
  }, [fid]);

  /**
   * Loading state
   */
  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-4 border-2 border-gray-200">
        <p className="text-sm text-gray-500 text-center animate-pulse">
          Loading your status...
        </p>
      </div>
    );
  }

  /**
   * Error state
   */
  if (error) {
    return (
      <div className="bg-red-50 rounded-lg shadow-md p-4 border-2 border-red-200">
        <p className="text-sm text-red-600 text-center">{error}</p>
      </div>
    );
  }

  /**
   * Not authenticated
   */
  if (!fid || !userState) {
    return (
      <div className="bg-yellow-50 rounded-lg shadow-md p-4 border-2 border-yellow-200">
        <p className="text-sm text-yellow-800 text-center">
          Please connect your Farcaster account
        </p>
      </div>
    );
  }

  /**
   * Display user state
   */
  return (
    <div className="bg-white rounded-lg shadow-md p-4 border-2 border-gray-200 space-y-3">
      {/* Header */}
      <div className="text-center border-b pb-2">
        <p className="text-xs uppercase font-semibold text-gray-500 tracking-wide">
          Your Daily Status
        </p>
      </div>

      {/* Guess Counts */}
      <div className="space-y-2">
        {/* Total Guesses Remaining */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">
            Total Guesses
          </span>
          <span className="text-lg font-bold text-green-600">
            {userState.totalGuessesRemaining}
          </span>
        </div>

        {/* Free Guesses Breakdown */}
        {userState.freeGuessesRemaining > 0 && (
          <div className="pl-4 space-y-1 text-xs text-gray-600">
            <div className="flex justify-between">
              <span>Free (Base)</span>
              <span>{userState.freeAllocations.base}</span>
            </div>
            {userState.freeAllocations.clankton > 0 && (
              <div className="flex justify-between text-purple-600 font-semibold">
                <span>CLANKTON Bonus</span>
                <span>+{userState.freeAllocations.clankton}</span>
              </div>
            )}
            {userState.freeAllocations.shareBonus > 0 && (
              <div className="flex justify-between text-blue-600">
                <span>Share Bonus</span>
                <span>+{userState.freeAllocations.shareBonus}</span>
              </div>
            )}
          </div>
        )}

        {/* Paid Guesses */}
        {userState.paidGuessesRemaining > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-700">Paid Guesses</span>
            <span className="font-bold text-blue-600">
              {userState.paidGuessesRemaining}
            </span>
          </div>
        )}
      </div>

      {/* CLANKTON Bonus Status */}
      <div className="pt-2 border-t">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">
            CLANKTON Bonus
          </span>
          <div className="flex items-center gap-1">
            {userState.clanktonBonusActive ? (
              <>
                <span className="text-green-600 font-bold text-sm">Active</span>
                <span className="text-green-600">✓</span>
              </>
            ) : (
              <>
                <span className="text-gray-400 text-sm">Inactive</span>
                <span className="text-gray-400">✗</span>
              </>
            )}
          </div>
        </div>
        {!userState.clanktonBonusActive && (
          <p className="text-xs text-gray-500 mt-1">
            Hold ≥100M CLANKTON for +3 free guesses/day
          </p>
        )}
      </div>

      {/* Buy More Packs */}
      {userState.canBuyMorePacks && (
        <div className="pt-2 border-t">
          <button
            className="w-full bg-gradient-to-r from-blue-500 to-purple-500 text-white text-sm font-semibold py-2 px-4 rounded-lg hover:from-blue-600 hover:to-purple-600 transition-all"
            onClick={() => {
              // TODO: Implement buy pack flow in Milestone 5.2
              alert('Pack purchase coming in Milestone 5.2 (ETH payments)');
            }}
          >
            Buy More Guesses (0.0003 ETH)
          </button>
          <p className="text-xs text-gray-500 text-center mt-1">
            {userState.paidPacksPurchased} of {userState.maxPaidPacksPerDay} packs purchased today
          </p>
        </div>
      )}

      {/* Out of Guesses */}
      {userState.totalGuessesRemaining === 0 && !userState.canBuyMorePacks && (
        <div className="pt-2 border-t">
          <p className="text-sm text-center text-gray-600 font-medium">
            No guesses left today
          </p>
          <p className="text-xs text-center text-gray-500 mt-1">
            Come back tomorrow for more free guesses
          </p>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import type { RoundStatus } from '../src/lib/wheel';

/**
 * TopTicker Component
 * Milestone 2.3: Displays live round status at the top of the page
 *
 * Shows:
 * - Prize pool in ETH and USD
 * - Global guess count for the current round
 *
 * Polls /api/round-state every 5 seconds for live updates.
 */
export default function TopTicker() {
  const [status, setStatus] = useState<RoundStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Fetch round status from API
   */
  const fetchRoundStatus = async () => {
    try {
      const response = await fetch('/api/round-state');

      if (!response.ok) {
        throw new Error('Failed to fetch round status');
      }

      const data: RoundStatus | null = await response.json();
      setStatus(data);
      setError(null);
    } catch (err) {
      console.error('Error fetching round status:', err);
      setError('Failed to load round status');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Set up polling on mount
   */
  useEffect(() => {
    // Initial fetch
    fetchRoundStatus();

    // Poll every 5 seconds
    const interval = setInterval(fetchRoundStatus, 5000);

    // Cleanup on unmount
    return () => clearInterval(interval);
  }, []);

  /**
   * Loading state
   */
  if (isLoading) {
    return (
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white py-3 px-4 shadow-md">
        <div className="max-w-6xl mx-auto text-center">
          <p className="text-sm animate-pulse">Loading round status...</p>
        </div>
      </div>
    );
  }

  /**
   * Error state
   */
  if (error) {
    return (
      <div className="bg-red-600 text-white py-3 px-4 shadow-md">
        <div className="max-w-6xl mx-auto text-center">
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  /**
   * No active round
   */
  if (!status) {
    return (
      <div className="bg-gray-600 text-white py-3 px-4 shadow-md">
        <div className="max-w-6xl mx-auto text-center">
          <p className="text-sm">No active round</p>
        </div>
      </div>
    );
  }

  /**
   * Display round status
   */
  return (
    <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white py-3 px-4 shadow-md">
      <div className="max-w-6xl mx-auto flex items-center justify-between flex-wrap gap-4">
        {/* Prize Pool */}
        <div className="flex items-center gap-2">
          <span className="text-2xl">💰</span>
          <div>
            <p className="text-xs uppercase font-semibold tracking-wide opacity-90">
              Prize Pool
            </p>
            <p className="text-lg font-bold">
              {status.prizePoolEth} ETH
              {status.prizePoolUsd && (
                <span className="text-sm font-normal opacity-90 ml-2">
                  (≈${status.prizePoolUsd})
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Global Guess Count */}
        <div className="flex items-center gap-2">
          <span className="text-2xl">🎯</span>
          <div>
            <p className="text-xs uppercase font-semibold tracking-wide opacity-90">
              Global Guesses
            </p>
            <p className="text-lg font-bold">
              {status.globalGuessCount.toLocaleString()}
            </p>
          </div>
        </div>

        {/* Round Number */}
        <div className="flex items-center gap-2">
          <span className="text-2xl">🔢</span>
          <div>
            <p className="text-xs uppercase font-semibold tracking-wide opacity-90">
              Round
            </p>
            <p className="text-lg font-bold">#{status.roundId}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

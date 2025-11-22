import { useEffect, useState } from 'react';
import type { RoundStatus } from '../src/lib/wheel';

/**
 * Format ETH value for display
 * Milestone 3.2: Show 2-4 decimal places, trim trailing zeros
 *
 * @param value - ETH value as string or number
 * @returns Formatted ETH string (e.g. "0.42" or "1.2345")
 */
function formatEth(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;

  if (isNaN(num)) return '0';

  // Show up to 4 decimal places, but trim trailing zeros
  const formatted = num.toFixed(4);

  // Remove trailing zeros after decimal point
  return formatted.replace(/\.?0+$/, '');
}

/**
 * Format USD value for display
 * Milestone 3.2: Show with $ prefix and commas
 * Milestone 4.12: Always show 2 decimal places for cents
 *
 * @param value - USD value as string or number
 * @returns Formatted USD string (e.g. "$1,260.00" or "$1,260.50")
 */
function formatUsd(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;

  if (isNaN(num)) return '$0.00';

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

/**
 * TopTicker Component
 * Milestone 3.2: Displays live round status with polished formatting
 *
 * Shows:
 * - Prize pool in ETH and USD (formatted properly)
 * - Global guess count for the current round (with commas)
 *
 * Polls /api/round-state every 15 seconds for live updates.
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

      const data: RoundStatus = await response.json();
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
   * Milestone 3.2: Polls every 15 seconds for efficient updates
   */
  useEffect(() => {
    // Initial fetch
    fetchRoundStatus();

    // Poll every 15 seconds
    const interval = setInterval(fetchRoundStatus, 15000);

    // Cleanup on unmount
    return () => clearInterval(interval);
  }, []);

  /**
   * Loading state
   */
  if (isLoading) {
    return (
      <div className="text-white py-3 px-4 shadow-md" style={{ backgroundColor: '#2D68C7' }}>
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
    <div className="text-white py-3 px-4 shadow-md" style={{ backgroundColor: '#2D68C7' }}>
      <div className="max-w-6xl mx-auto flex items-center justify-between flex-wrap gap-4">
        {/* Prize Pool */}
        <div>
          <p className="text-xs uppercase font-light tracking-wide opacity-90">
            Prize Pool
          </p>
          <p className="text-lg font-bold">
            {formatEth(status.prizePoolEth)} ETH
            {status.prizePoolUsd && (
              <span className="text-sm font-normal opacity-90 ml-2">
                ({formatUsd(status.prizePoolUsd)})
              </span>
            )}
          </p>
        </div>

        {/* Global Guess Count */}
        <div>
          <p className="text-xs uppercase font-light tracking-wide opacity-90">
            Global Guesses
          </p>
          <p className="text-lg font-bold">
            {status.globalGuessCount.toLocaleString()}
          </p>
        </div>

        {/* Round Number */}
        <div>
          <p className="text-xs uppercase font-light tracking-wide opacity-90">
            Round
          </p>
          <p className="text-lg font-bold">#{status.roundId}</p>
        </div>
      </div>
    </div>
  );
}

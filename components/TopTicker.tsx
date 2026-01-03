import { useEffect, useState } from 'react';
import type { RoundStatus } from '../src/lib/wheel';

interface TopTickerProps {
  onRoundClick?: (roundId: number) => void;
  adminFid?: number; // Pass admin FID to enable start round button
}

/**
 * Format ETH value for display
 * Always show exactly 4 decimal places
 *
 * @param value - ETH value as string or number
 * @returns Formatted ETH string (e.g. "0.4219")
 */
function formatEth(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;

  if (isNaN(num)) return '0.0000';

  return num.toFixed(4);
}

/**
 * Format USD value for display
 * Round to nearest dollar (no cents)
 *
 * @param value - USD value as string or number
 * @returns Formatted USD string (e.g. "$1,260")
 */
function formatUsd(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;

  if (isNaN(num)) return '$0';

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(num));
}

/**
 * TopTicker Component
 * Milestone 3.2: Displays live round status with polished formatting
 * Milestone 5.4: Round number is clickable to open archive modal
 *
 * Shows:
 * - Prize pool in ETH and USD (formatted properly)
 * - Global guess count for the current round (with commas)
 *
 * Polls /api/round-state every 15 seconds for live updates.
 */
export default function TopTicker({ onRoundClick, adminFid }: TopTickerProps) {
  const [status, setStatus] = useState<RoundStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isStartingRound, setIsStartingRound] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  /**
   * Start a new round (admin only)
   */
  const handleStartRound = async () => {
    if (!adminFid) return;

    setIsStartingRound(true);
    setStartError(null);

    try {
      const res = await fetch(`/api/admin/operational/start-round?devFid=${adminFid}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      const text = await res.text();
      let data: any = {};
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error('Invalid response from server');
        }
      }

      if (!res.ok) {
        throw new Error(data.message || data.error || `Failed (${res.status})`);
      }

      // Success! Refresh the round status
      await fetchRoundStatus();
    } catch (err: any) {
      setStartError(err.message);
    } finally {
      setIsStartingRound(false);
    }
  };

  /**
   * Fetch round status from API
   */
  const fetchRoundStatus = async () => {
    try {
      const response = await fetch('/api/round-state');

      // 204 No Content means no active round
      if (response.status === 204) {
        setStatus(null);
        setError(null);
        return;
      }

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
      <div className="bg-brand text-white py-3 px-4 shadow-md">
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
   * No active round - show "Next round starting soon" splash
   * If adminFid is provided, show a Start Round button
   */
  if (!status) {
    return (
      <div className="bg-brand text-white py-4 px-4 shadow-md">
        <div className="max-w-6xl mx-auto text-center">
          <p className="text-2xl font-bold animate-pulse">
            Next round starting soon
          </p>
          <p className="text-sm opacity-80 mt-1">
            Get ready to guess the secret word!
          </p>
          {adminFid && (
            <div className="mt-3">
              <button
                onClick={handleStartRound}
                disabled={isStartingRound}
                className="px-6 py-2 bg-white text-brand font-bold rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isStartingRound ? 'Starting...' : 'Start Round'}
              </button>
              {startError && (
                <p className="text-red-200 text-xs mt-2">{startError}</p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  /**
   * Display round status
   */
  return (
    <div className="bg-brand text-white py-3 px-4 shadow-md">
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-4 whitespace-nowrap overflow-visible">
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

        {/* Round Number - Clickable to open archive */}
        <div
          onClick={() => onRoundClick?.(status.roundId)}
          className={`
            ${onRoundClick ? 'cursor-pointer hover:bg-white/10' : 'cursor-default'}
            pl-2.5 pr-2 pt-1.5 pb-1 -ml-2.5 -mr-2 -mt-1.5 -mb-1 rounded-lg transition-colors duration-200
          `}
          role={onRoundClick ? 'button' : undefined}
          tabIndex={onRoundClick ? 0 : undefined}
          onKeyDown={(e) => {
            if (onRoundClick && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              onRoundClick(status.roundId);
            }
          }}
        >
          <p className="text-xs uppercase font-light tracking-wide opacity-90">
            Round
          </p>
          <p className="text-lg font-bold">
            #{status.roundId}
            {onRoundClick && (
              <span className="text-xs font-normal opacity-70 ml-1">▼</span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

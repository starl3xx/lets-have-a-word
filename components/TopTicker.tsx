import { useEffect, useState } from 'react';
import type { RoundStatus } from '../src/lib/wheel';

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

interface TopTickerProps {
  onRoundClick?: (roundId: number) => void;
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
export default function TopTicker({ onRoundClick }: TopTickerProps) {
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
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-4 whitespace-nowrap overflow-hidden">
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
          style={{
            cursor: onRoundClick ? 'pointer' : 'default',
            padding: '4px 8px',
            margin: '-4px -8px',
            borderRadius: '8px',
            transition: 'background 0.2s',
          }}
          className={onRoundClick ? 'hover:bg-white/10' : ''}
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

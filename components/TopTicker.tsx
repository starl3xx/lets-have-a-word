import { useEffect, useState } from 'react';
import { formatPrizeCompact } from '../src/lib/prize-display';
import type { RoundStatus } from '../src/lib/wheel';

// Total words in the game dictionary (for percentage calculation)
const TOTAL_WORD_COUNT = 4437;

interface TopTickerProps {
  onRoundClick?: (roundId: number) => void;
  adminFid?: number; // Pass admin FID to enable start round button
  onRoundStatusChange?: (hasActiveRound: boolean) => void; // Notify parent when round status changes
  superguessLive?: boolean; // Milestone 15: Turns banner red during active Superguess
  onSuperguessStatusChange?: (active: boolean, eligible: boolean) => void; // Milestone 15
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
 * Format guess percentage for display
 * Shows whole number with ≈ prefix if not exact
 *
 * @param guessCount - Current number of guesses
 * @param totalWords - Total words in dictionary
 * @returns Formatted percentage string (e.g. "≈19%" or "25%")
 */
function formatGuessPercentage(guessCount: number, totalWords: number): string {
  const exactPercent = (guessCount / totalWords) * 100;
  const roundedPercent = Math.round(exactPercent);
  const isExact = exactPercent === roundedPercent;

  return isExact ? `${roundedPercent}%` : `≈${roundedPercent}%`;
}

/**
 * Get color for guess percentage based on thresholds
 * Subtle color progression as dictionary gets exhausted
 *
 * @param guessCount - Current number of guesses
 * @param totalWords - Total words in dictionary
 * @returns CSS color class or style
 */
function getPercentageColor(guessCount: number, totalWords: number): string {
  const percent = (guessCount / totalWords) * 100;

  if (percent >= 50) {
    return 'rgb(251, 146, 60)'; // orange-400 - warning
  } else if (percent >= 25) {
    return 'rgb(251, 191, 36)'; // amber-400 - caution
  }
  return 'rgba(255, 255, 255, 0.6)'; // gray/white - normal
}

/**
 * TopTicker Component
 * Milestone 3.2: Displays live round status with polished formatting
 * Milestone 5.4: Round number is clickable to open archive modal
 *
 * Shows:
 * - Prize pool in the round's currency (ETH or $WORD) with its USD value
 * - Global guess count for the current round (with commas)
 *
 * Polls /api/round-state every 15 seconds for live updates.
 */
export default function TopTicker({ onRoundClick, adminFid, onRoundStatusChange, superguessLive, onSuperguessStatusChange }: TopTickerProps) {
  const [status, setStatus] = useState<RoundStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Milliseconds until the next round is expected (cooldown window), or null
  // when no start is scheduled. Recomputed on every poll so the countdown
  // text stays fresh without its own timer.
  const [nextRoundPending, setNextRoundPending] = useState<boolean>(false);
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
        // During the cooldown window the bar says a round is coming — but
        // never WHEN. No countdown, deliberately: an exact start time lets
        // players squat the first second of a round to snipe the
        // Trailblazer Wordmark. The API withholds the timestamp too.
        try {
          const nextRes = await fetch('/api/next-round');
          const next = nextRes.ok ? await nextRes.json() : null;
          setNextRoundPending(Boolean(next?.nextRoundPending));
        } catch {
          setNextRoundPending(false);
        }
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to fetch round status');
      }

      const data: RoundStatus = await response.json();
      setStatus(data);
      setError(null);
      // Milestone 15: Notify parent of Superguess status from round-state poll
      if (onSuperguessStatusChange) {
        onSuperguessStatusChange(!!data.superguessActive, !!data.superguessEligible);
      }
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
   * Notify parent when round status changes
   */
  useEffect(() => {
    if (onRoundStatusChange) {
      onRoundStatusChange(status !== null);
    }
  }, [status, onRoundStatusChange]);

  /**
   * Loading state
   */
  if (isLoading) {
    return (
      <div className="bg-brand text-white py-3 px-4 shadow-md">
        {/* min-h matches the two-line columns of the round bar (text-xs label
            + text-lg value = 2.75rem) so the bar never changes height across
            loading / error / between-rounds / live states. */}
        <div className="max-w-6xl mx-auto flex items-center justify-center min-h-[2.75rem]">
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
        <div className="max-w-6xl mx-auto flex items-center justify-center min-h-[2.75rem]">
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  /**
   * No active round - show the "Update in progress" splash
   * If adminFid is provided, show a Start Round button
   *
   * Says "Update in progress" rather than "Next round starting soon" because
   * the latter promises something imminent, and the gap between rounds is
   * currently measured in weeks while the $WORD migration lands. Copy that
   * keeps predicting a round that does not arrive reads as a broken game
   * rather than a paused one.
   */
  if (!status) {
    return (
      <div className="bg-brand text-white py-3 px-4 shadow-md">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-3 whitespace-nowrap min-h-[2.75rem]">
          <div className="min-w-0">
            <p className="text-lg font-bold animate-pulse truncate">
              {nextRoundPending ? 'Next round starting soon…' : 'Update in progress…'}
            </p>
            {/* A start-round failure replaces the subtitle instead of adding
                a line — the bar's height never changes. */}
            <p className={`text-xs truncate ${startError ? 'text-red-200' : 'opacity-80'}`}>
              {startError ??
                (nextRoundPending
                  ? 'Could be any moment 👀'
                  : 'Get ready for something new!')}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Admin-only: inline so the bar keeps its height */}
            {adminFid && (
              <button
                onClick={handleStartRound}
                disabled={isStartingRound}
                className="px-3 py-1.5 bg-white text-brand text-sm font-bold rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isStartingRound ? 'Starting…' : 'Start Round'}
              </button>
            )}

            {/* Archive chip — sits where the Round #N ▼ chip lives during a
                round. Stacked and left-aligned like that chip's two-line
                anatomy, but both lines in the label weight. Goes straight to
                /archive: the round modal the chip normally opens needs a live
                round and errors on the 204 from /api/round-state. */}
            <a
              href="/archive"
              className="block text-left pl-2.5 pr-2 py-1.5 -mr-2 rounded-lg hover:bg-white/10 transition-colors duration-200"
            >
              <p className="text-xs uppercase font-light tracking-wide opacity-90">
                Round
              </p>
              <p className="text-xs uppercase font-light tracking-wide opacity-90">
                Archive
                <span className="ml-1 opacity-70">▼</span>
              </p>
            </a>
          </div>
        </div>
      </div>
    );
  }

  /**
   * Display round status
   */
  const bannerBg = superguessLive ? 'bg-red-700' : 'bg-brand';

  return (
    <div className={`${bannerBg} text-white py-3 px-4 shadow-md transition-colors duration-500`}>
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-4 whitespace-nowrap overflow-visible">
        {/* Prize Pool */}
        <div>
          <p className="text-xs uppercase font-light tracking-wide opacity-90">
            Prize Pool
          </p>
          <p className="text-lg font-bold">
            {formatPrizeCompact({
              currency: status.prizeCurrency ?? 'eth',
              eth: status.prizePoolEth,
              word: status.prizePoolWord,
            })}
            {status.prizePoolUsd && (
              <span className="text-sm font-normal ml-2" style={{ color: 'rgba(255, 255, 255, 0.6)' }}>
                (≈{formatUsd(status.prizePoolUsd)})
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
            <span
              className="text-sm font-normal ml-1.5"
              style={{ color: getPercentageColor(status.globalGuessCount, TOTAL_WORD_COUNT) }}
            >
              ({formatGuessPercentage(status.globalGuessCount, TOTAL_WORD_COUNT)})
            </span>
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

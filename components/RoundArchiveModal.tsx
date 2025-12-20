import { useState, useEffect } from 'react';
import Top10StatusChip from './Top10StatusChip';

interface TopGuesser {
  fid: number;
  username: string;
  guessCount: number;
  pfpUrl: string;
}

interface RoundState {
  roundId: number;
  prizePoolEth: string;
  prizePoolUsd: string;
  globalGuessCount: number;
  top10Locked: boolean;
  top10GuessesRemaining: number;
  top10LockAfterGuesses: number;
}

interface RoundArchiveModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Top 10 rank distribution percentages (of the Top 10 pool)
const TOP10_RANK_PERCENTAGES = [
  0.19, // Rank 1: 19%
  0.16, // Rank 2: 16%
  0.14, // Rank 3: 14%
  0.11, // Rank 4: 11%
  0.10, // Rank 5: 10%
  0.06, // Rank 6: 6%
  0.06, // Rank 7: 6%
  0.06, // Rank 8: 6%
  0.06, // Rank 9: 6%
  0.06, // Rank 10: 6%
];

/**
 * Calculate the ETH payout for a specific rank
 * @param rank - 1-indexed rank (1-10)
 * @param top10PoolEth - Total ETH in the Top 10 pool (10% of prize pool)
 */
function getRankPayout(rank: number, top10PoolEth: number): string {
  if (rank < 1 || rank > 10) return '0.0000';
  const percentage = TOP10_RANK_PERCENTAGES[rank - 1];
  return (top10PoolEth * percentage).toFixed(4);
}

/**
 * RoundArchiveModal Component
 * Shows current round stats with prize breakdown and top guessers
 */
export default function RoundArchiveModal({ isOpen, onClose }: RoundArchiveModalProps) {
  const [loading, setLoading] = useState(true);
  const [roundState, setRoundState] = useState<RoundState | null>(null);
  const [topGuessers, setTopGuessers] = useState<TopGuesser[]>([]);
  const [uniqueGuessers, setUniqueGuessers] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchData();
      // Poll for real-time updates every 5 seconds while modal is open
      const interval = setInterval(fetchData, 5000);
      return () => clearInterval(interval);
    }
  }, [isOpen]);

  const fetchData = async () => {
    // Only show loading spinner on initial load, not on polls
    if (!roundState) {
      setLoading(true);
    }
    setError(null);

    try {
      // Fetch round state and top guessers in parallel
      const [roundResponse, guessersResponse] = await Promise.all([
        fetch('/api/round-state'),
        fetch('/api/round/top-guessers'),
      ]);

      if (!roundResponse.ok) throw new Error('Failed to load round state');
      if (!guessersResponse.ok) throw new Error('Failed to load top guessers');

      const roundData = await roundResponse.json();
      const guessersData = await guessersResponse.json();

      setRoundState(roundData);
      setTopGuessers(guessersData.topGuessers || []);
      setUniqueGuessers(guessersData.uniqueGuessersCount || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  // Calculate prize breakdown (80% jackpot, 10% referrer, 10% top guessers)
  const calculateBreakdown = (totalEth: string, totalUsd: string) => {
    const ethNum = parseFloat(totalEth);
    const usdNum = parseFloat(totalUsd);

    return {
      jackpot: {
        eth: (ethNum * 0.8).toFixed(4),
        usd: (usdNum * 0.8).toFixed(0),
      },
      referrer: {
        eth: (ethNum * 0.1).toFixed(4),
        usd: (usdNum * 0.1).toFixed(0),
      },
      topGuessers: {
        eth: (ethNum * 0.1).toFixed(4),
        usd: (usdNum * 0.1).toFixed(0),
      },
    };
  };

  if (!isOpen) return null;

  const breakdown = roundState
    ? calculateBreakdown(roundState.prizePoolEth, roundState.prizePoolUsd)
    : null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-5 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900">
            Current round: #{roundState?.roundId || '—'}
          </h2>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm font-medium text-gray-500 border border-gray-300 rounded-full hover:bg-gray-50 transition-colors"
          >
            Close
          </button>
        </div>

        {/* Top-10 Status Chip (Milestone 7.x) */}
        {roundState && (
          <div className="flex justify-center -mt-2">
            <Top10StatusChip
              top10Locked={roundState.top10Locked}
              top10GuessesRemaining={roundState.top10GuessesRemaining}
            />
          </div>
        )}

        {loading ? (
          <div className="text-center text-gray-500 py-10">
            <div className="w-8 h-8 border-2 border-blue-100 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
            Loading...
          </div>
        ) : error ? (
          <div className="text-center text-red-600 py-10 bg-red-50 rounded-lg">
            {error}
          </div>
        ) : (
          <>
            {/* Prize Breakdown - 3 columns */}
            {breakdown && (
              <div className="grid grid-cols-3 gap-2">
                {/* Jackpot */}
                <div className="border-2 border-gray-200 rounded-xl p-3 text-center">
                  <div className="text-lg font-bold text-gray-900">.{breakdown.jackpot.eth.replace('0.', '')} ETH</div>
                  <div className="text-xs text-gray-400">(${breakdown.jackpot.usd} USD)</div>
                  <div className="text-xs text-gray-500 mt-2 uppercase font-semibold">Jackpot</div>
                  <div className="text-xs text-gray-400">(80% of prize pool)</div>
                </div>

                {/* Referrer */}
                <div className="border-2 border-gray-200 rounded-xl p-3 text-center">
                  <div className="text-lg font-bold text-gray-900">.{breakdown.referrer.eth.replace('0.', '')} ETH</div>
                  <div className="text-xs text-gray-400">(${breakdown.referrer.usd} USD)</div>
                  <div className="text-xs text-gray-500 mt-2 uppercase font-semibold">Referrer</div>
                  <div className="text-xs text-gray-400">(if applicable, 10% of prize pool)</div>
                </div>

                {/* Top Guessers */}
                <div className="border-2 border-gray-200 rounded-xl p-3 text-center">
                  <div className="text-lg font-bold text-gray-900">.{breakdown.topGuessers.eth.replace('0.', '')} ETH</div>
                  <div className="text-xs text-gray-400">(${breakdown.topGuessers.usd} USD)</div>
                  <div className="text-xs text-gray-500 mt-2 uppercase font-semibold">Top Guessers</div>
                  <div className="text-xs text-gray-400">(10% of prize pool)</div>
                </div>
              </div>
            )}

            {/* Stats - 2 columns */}
            <div className="grid grid-cols-2 gap-3">
              <div className="border-2 border-gray-200 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-gray-900">
                  {roundState?.globalGuessCount?.toLocaleString() || '0'}
                </div>
                <div className="text-xs text-gray-500 uppercase font-semibold mt-1">Total Guesses</div>
              </div>
              <div className="border-2 border-gray-200 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-gray-900">
                  {uniqueGuessers.toLocaleString()}
                </div>
                <div className="text-xs text-gray-500 uppercase font-semibold mt-1">Unique Guessers</div>
              </div>
            </div>

            {/* Top Guessers List */}
            <div>
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-3 text-center">
                Top Guessers <span className="font-normal opacity-70">(First 750 guesses)</span>
              </h3>

              {topGuessers.length === 0 ? (
                <div className="text-center text-gray-400 py-4">
                  No guesses yet this round
                </div>
              ) : (
                <div className="space-y-2">
                  {topGuessers.slice(0, 10).map((guesser, index) => {
                    const rank = index + 1;
                    const top10PoolEth = breakdown ? parseFloat(breakdown.topGuessers.eth) : 0;
                    const rankPayout = getRankPayout(rank, top10PoolEth);

                    return (
                      <div key={guesser.fid} className="flex items-center gap-3">
                        {/* Rank */}
                        <div className="text-gray-500 font-medium w-6 text-right">
                          {rank}.
                        </div>
                        {/* Avatar */}
                        <img
                          src={guesser.pfpUrl}
                          alt={guesser.username}
                          className="w-8 h-8 rounded-full object-cover border border-gray-200"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = `https://avatar.vercel.sh/${guesser.fid}`;
                          }}
                        />
                        {/* Username */}
                        <div className="flex-1 font-medium text-gray-900 truncate">
                          {guesser.username || `fid:${guesser.fid}`}
                        </div>
                        {/* ETH Payout */}
                        <div className="text-green-600 font-semibold text-sm tabular-nums">
                          .{rankPayout.replace('0.', '')}
                        </div>
                        {/* Guess Count */}
                        <div className="text-blue-600 font-bold w-10 text-right tabular-nums">
                          {guesser.guessCount}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {/* View Full Archive Button */}
        <a
          href="/archive"
          className="block w-full py-3 px-4 bg-blue-500 text-white font-semibold rounded-xl hover:bg-blue-600 transition-all text-center"
        >
          View full archive
        </a>
      </div>
    </div>
  );
}

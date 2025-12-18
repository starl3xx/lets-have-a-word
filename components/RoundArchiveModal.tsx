import { useState, useEffect } from 'react';

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
}

interface RoundArchiveModalProps {
  isOpen: boolean;
  onClose: () => void;
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
    }
  }, [isOpen]);

  const fetchData = async () => {
    setLoading(true);
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
                Top Guessers
              </h3>

              {topGuessers.length === 0 ? (
                <div className="text-center text-gray-400 py-4">
                  No guesses yet this round
                </div>
              ) : (
                <div className="space-y-2">
                  {topGuessers.slice(0, 10).map((guesser, index) => (
                    <div key={guesser.fid} className="flex items-center gap-3">
                      {/* Rank */}
                      <div className="text-gray-500 font-medium w-6 text-right">
                        {index + 1}.
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
                      {/* Guess Count */}
                      <div className="text-blue-600 font-bold">
                        {guesser.guessCount}
                      </div>
                    </div>
                  ))}
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

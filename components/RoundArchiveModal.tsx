import { useState, useEffect } from 'react';

interface ArchivedRound {
  id: number;
  roundNumber: number;
  targetWord: string;
  seedEth: string;
  finalJackpotEth: string;
  totalGuesses: number;
  uniquePlayers: number;
  winnerFid: number | null;
  winnerGuessNumber: number | null;
  startTime: string;
  endTime: string;
  payoutsJson: {
    winner?: { fid: number; amountEth: string };
    referrer?: { fid: number; amountEth: string };
    topGuessers: Array<{ fid: number; amountEth: string; rank: number }>;
  };
  salt: string;
}

interface ArchiveStats {
  totalRounds: number;
  totalGuessesAllTime: number;
  uniqueWinners: number;
  totalJackpotDistributed: string;
  avgGuessesPerRound: number;
  avgPlayersPerRound: number;
}

interface TopGuesser {
  fid: number;
  username: string;
  guessCount: number;
  pfpUrl: string;
}

interface RoundArchiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentRoundId?: number;
}

/**
 * RoundArchiveModal Component
 * Milestone 5.4, Updated Milestone 6.3
 *
 * Bottom sheet style matching StatsSheet
 */

export default function RoundArchiveModal({ isOpen, onClose, currentRoundId }: RoundArchiveModalProps) {
  const [loading, setLoading] = useState(true);
  const [rounds, setRounds] = useState<ArchivedRound[]>([]);
  const [stats, setStats] = useState<ArchiveStats | null>(null);
  const [topGuessers, setTopGuessers] = useState<TopGuesser[]>([]);
  const [selectedRound, setSelectedRound] = useState<ArchivedRound | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchArchiveData();
      fetchTopGuessers();
    }
  }, [isOpen]);

  const fetchArchiveData = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/archive/list?stats=true&limit=10');
      if (!response.ok) throw new Error('Failed to load archive');
      const data = await response.json();
      setRounds(data.rounds);
      setStats(data.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load archive');
    } finally {
      setLoading(false);
    }
  };

  const fetchTopGuessers = async () => {
    try {
      const response = await fetch('/api/round/top-guessers');
      if (!response.ok) throw new Error('Failed to load top guessers');
      const data = await response.json();
      setTopGuessers(data.topGuessers || []);
    } catch (err) {
      console.error('Failed to fetch top guessers:', err);
      // Don't set error state, just log - top guessers is non-critical
    }
  };

  const fetchRoundDetail = async (roundNumber: number) => {
    try {
      const response = await fetch(`/api/archive/${roundNumber}`);
      if (!response.ok) throw new Error('Round not found');
      const data = await response.json();
      setSelectedRound(data.round);
    } catch (err) {
      console.error('Failed to fetch round detail:', err);
    }
  };

  const formatEth = (eth: string) => parseFloat(eth).toFixed(4);

  const formatDuration = (startTime: string, endTime: string) => {
    const start = new Date(startTime);
    const end = new Date(endTime);
    const durationMs = end.getTime() - start.getTime();
    const hours = Math.floor(durationMs / (1000 * 60 * 60));
    const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-4 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b pb-3">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">
              {selectedRound ? `📜 Round #${selectedRound.roundNumber}` : '📜 LHAW Archive'}
            </h2>
            {currentRoundId && !selectedRound && (
              <p className="text-sm text-gray-500 mt-1">
                Current round: #{currentRoundId}
              </p>
            )}
          </div>
          <button
            onClick={selectedRound ? () => setSelectedRound(null) : onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            {selectedRound ? '←' : '×'}
          </button>
        </div>

        {/* Stats Zone */}
        {!loading && !error && stats && !selectedRound && (
          <div className="space-y-4">
            {/* Top 10 Guessers Section */}
            {topGuessers.length > 0 && (
              <div className="bg-blue-50 rounded-lg p-4">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                  Top 10 guessers this round
                </h3>
                <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm space-y-3">
                  {topGuessers.map((guesser, index) => (
                    <div key={guesser.fid} className="flex items-center gap-3">
                      {/* Rank */}
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                        index < 3 ? 'bg-blue-600 text-white' : 'bg-blue-100 text-gray-500'
                      }`}>
                        {index + 1}
                      </div>
                      {/* Avatar */}
                      <img
                        src={guesser.pfpUrl}
                        alt={guesser.username}
                        className="w-8 h-8 rounded-full object-cover border-2 border-gray-200 flex-shrink-0"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = `https://avatar.vercel.sh/${guesser.fid}`;
                        }}
                      />
                      {/* Username */}
                      <div className="flex-1 text-sm font-semibold text-gray-900 truncate">
                        {guesser.username}
                      </div>
                      {/* Guess Count */}
                      <div className="text-sm font-bold text-blue-600 flex-shrink-0">
                        {guesser.guessCount} {guesser.guessCount === 1 ? 'guess' : 'guesses'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Stats Cards */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <div className="text-xl font-bold text-gray-900">{stats.totalRounds.toLocaleString()}</div>
                <div className="text-xs text-gray-500">Total rounds</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <div className="text-xl font-bold text-gray-900">{stats.totalGuessesAllTime.toLocaleString()}</div>
                <div className="text-xs text-gray-500">Total guesses</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <div className="text-xl font-bold text-gray-900">{stats.uniqueWinners.toLocaleString()}</div>
                <div className="text-xs text-gray-500">Unique winners</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <div className="text-xl font-bold text-green-600">{formatEth(stats.totalJackpotDistributed)} ETH</div>
                <div className="text-xs text-gray-500">Jackpot distributed</div>
              </div>
            </div>
          </div>
        )}

        {/* Content Zone */}
        <div>
          {loading ? (
            <div className="text-center text-gray-500 py-10">
              <div className="w-8 h-8 border-3 border-blue-100 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
              Loading archive...
            </div>
          ) : error ? (
            <div className="text-center text-red-600 py-10 bg-red-50 rounded-lg">
              {error}
            </div>
          ) : selectedRound ? (
            // Round Detail View
            <div className="space-y-4">
              {/* Word display */}
              <div className="text-center mb-6">
                <div className="font-mono text-4xl font-extrabold tracking-widest text-blue-600 uppercase">
                  {selectedRound.targetWord}
                </div>
                <div className="text-xs text-gray-500 mt-2 uppercase tracking-wider font-medium">
                  The secret word
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-3 mb-5">
                <div className="bg-green-50 border border-green-100 rounded-lg p-4 text-center">
                  <div className="text-xl font-bold text-green-600">{formatEth(selectedRound.finalJackpotEth)} ETH</div>
                  <div className="text-xs text-gray-500 mt-1 uppercase tracking-wide font-medium">Jackpot</div>
                </div>
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-center">
                  <div className="text-xl font-bold text-blue-600">{selectedRound.totalGuesses.toLocaleString()}</div>
                  <div className="text-xs text-gray-500 mt-1 uppercase tracking-wide font-medium">Guesses</div>
                </div>
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-center">
                  <div className="text-xl font-bold text-blue-600">{selectedRound.uniquePlayers.toLocaleString()}</div>
                  <div className="text-xs text-gray-500 mt-1 uppercase tracking-wide font-medium">Players</div>
                </div>
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-center">
                  <div className="text-xl font-bold text-blue-600">{formatDuration(selectedRound.startTime, selectedRound.endTime)}</div>
                  <div className="text-xs text-gray-500 mt-1 uppercase tracking-wide font-medium">Duration</div>
                </div>
              </div>

              {/* Winner */}
              {selectedRound.winnerFid && (
                <div className="bg-green-50 border border-green-100 rounded-lg p-4">
                  <div className="text-xs text-green-600 mb-1 uppercase tracking-wider font-semibold">
                    🏆 Winner
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-900 font-semibold">
                      FID {selectedRound.winnerFid}
                      {selectedRound.winnerGuessNumber && (
                        <span className="font-normal text-gray-500">
                          {' '}(guess #{selectedRound.winnerGuessNumber})
                        </span>
                      )}
                    </span>
                    {selectedRound.payoutsJson.winner && (
                      <span className="text-green-600 font-bold text-lg">
                        {formatEth(selectedRound.payoutsJson.winner.amountEth)} ETH
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            // List View
            <div>
              {/* Section Label */}
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Recent completed rounds
              </h3>

              {rounds.length === 0 ? (
                // Empty state with dashed border
                <div className="text-center text-gray-500 py-8 border-2 border-dashed border-gray-300 rounded-lg">
                  <div className="text-2xl mb-2">📭</div>
                  No archived rounds yet
                </div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {rounds.map((round) => (
                    <button
                      key={round.roundNumber}
                      onClick={() => fetchRoundDetail(round.roundNumber)}
                      className="w-full py-4 text-left flex justify-between items-center hover:bg-gray-50 transition-colors"
                    >
                      <div>
                        <div className="text-gray-900 font-semibold text-sm flex items-center gap-2">
                          <span>Round #{round.roundNumber}</span>
                          <span className="font-mono text-blue-600 tracking-wide font-bold text-sm uppercase">
                            {round.targetWord}
                          </span>
                        </div>
                        <div className="text-gray-500 text-xs mt-1">
                          {round.totalGuesses} guesses · {round.uniquePlayers} players
                        </div>
                      </div>
                      <div className="text-green-600 font-bold text-sm flex items-center gap-1">
                        {formatEth(round.finalJackpotEth)} ETH
                        <span className="text-gray-400 text-lg">›</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Close Button */}
        <button
          onClick={onClose}
          className="w-full py-3 px-4 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 transition-all"
        >
          Close
        </button>
      </div>
    </div>
  );
}

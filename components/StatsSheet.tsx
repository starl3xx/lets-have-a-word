import { useState, useEffect } from 'react';
import type { UserStatsResponse } from '../pages/api/user/stats';

interface StatsSheetProps {
  fid: number | null;
  onClose: () => void;
}

/**
 * StatsSheet Component
 * Milestone 4.3
 *
 * Displays per-user gameplay statistics in a bottom sheet
 */
export default function StatsSheet({ fid, onClose }: StatsSheetProps) {
  const [stats, setStats] = useState<UserStatsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      if (!fid) {
        setIsLoading(false);
        setError('Not authenticated');
        return;
      }

      try {
        const response = await fetch(`/api/user/stats?devFid=${fid}`);

        if (!response.ok) {
          throw new Error('Failed to fetch stats');
        }

        const data = await response.json();
        setStats(data);
      } catch (err) {
        console.error('Error fetching stats:', err);
        setError('Failed to load stats');
      } finally {
        setIsLoading(false);
      }
    };

    fetchStats();
  }, [fid]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-t-2xl shadow-2xl max-w-lg w-full p-6 space-y-4 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b pb-3">
          <h2 className="text-2xl font-bold text-gray-900">📊 Your Stats</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="text-center py-8">
            <p className="text-gray-500 animate-pulse">Loading stats...</p>
          </div>
        )}

        {/* Error State */}
        {error && !isLoading && (
          <div className="bg-red-50 border border-red-200 rounded p-4">
            <p className="text-red-600 text-center">{error}</p>
          </div>
        )}

        {/* Stats Display */}
        {stats && !isLoading && (
          <div className="space-y-4">
            {/* This Round */}
            <div className="bg-blue-50 rounded-lg p-4 space-y-3">
              <h3 className="text-lg font-bold text-blue-900">This Round</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-sm text-blue-700">Total Guesses</p>
                  <p className="text-2xl font-bold text-blue-900">{stats.guessesThisRound}</p>
                </div>
                <div>
                  <p className="text-sm text-blue-700">Paid Guesses</p>
                  <p className="text-2xl font-bold text-blue-900">{stats.paidGuessesThisRound}</p>
                </div>
              </div>
            </div>

            {/* All Time */}
            <div className="bg-purple-50 rounded-lg p-4 space-y-3">
              <h3 className="text-lg font-bold text-purple-900">All Time</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-sm text-purple-700">Total Guesses</p>
                  <p className="text-2xl font-bold text-purple-900">{stats.guessesAllTime}</p>
                </div>
                <div>
                  <p className="text-sm text-purple-700">Paid Guesses</p>
                  <p className="text-2xl font-bold text-purple-900">{stats.paidGuessesAllTime}</p>
                </div>
              </div>
            </div>

            {/* Wins */}
            <div className="bg-green-50 rounded-lg p-4 space-y-3">
              <h3 className="text-lg font-bold text-green-900">Jackpots</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-sm text-green-700">Jackpots Won</p>
                  <p className="text-2xl font-bold text-green-900">{stats.jackpotsWon}</p>
                </div>
                <div>
                  <p className="text-sm text-green-700">Total ETH Won</p>
                  <p className="text-2xl font-bold text-green-900">
                    {parseFloat(stats.totalEthWon).toFixed(4)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

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

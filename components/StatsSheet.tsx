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
 * Displays per-user gameplay statistics and XP in a bottom sheet
 */
export default function StatsSheet({ fid, onClose }: StatsSheetProps) {
  const [stats, setStats] = useState<UserStatsResponse | null>(null);
  const [xp, setXp] = useState<number>(0);
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
        // Fetch both stats and XP in parallel
        const [statsResponse, xpResponse] = await Promise.all([
          fetch(`/api/user/stats?devFid=${fid}`),
          fetch(`/api/user/state?devFid=${fid}`)
        ]);

        if (!statsResponse.ok) {
          throw new Error('Failed to fetch stats');
        }

        const statsData = await statsResponse.json();
        setStats(statsData);

        // Get XP from user state
        if (xpResponse.ok) {
          const xpData = await xpResponse.json();
          setXp(xpData.xp || 0);
        }
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
          <h2 className="text-2xl font-bold text-gray-900">📊 Your stats</h2>
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
              <h3 className="text-lg font-bold text-blue-900">This round</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-sm text-blue-700">Total guesses</p>
                  <p className="text-2xl font-bold text-blue-900">{stats.guessesThisRound}</p>
                </div>
                <div>
                  <p className="text-sm text-blue-700">Paid guesses</p>
                  <p className="text-2xl font-bold text-blue-900">{stats.paidGuessesThisRound}</p>
                </div>
              </div>
            </div>

            {/* All Time */}
            <div className="bg-purple-50 rounded-lg p-4 space-y-3">
              <h3 className="text-lg font-bold text-purple-900">All time</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-sm text-purple-700">Total guesses</p>
                  <p className="text-2xl font-bold text-purple-900">{stats.guessesAllTime}</p>
                </div>
                <div>
                  <p className="text-sm text-purple-700">Paid guesses</p>
                  <p className="text-2xl font-bold text-purple-900">{stats.paidGuessesAllTime}</p>
                </div>
              </div>
            </div>

            {/* Wins */}
            <div className="bg-green-50 rounded-lg p-4 space-y-3">
              <h3 className="text-lg font-bold text-green-900">Jackpots</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-sm text-green-700">Jackpots won</p>
                  <p className="text-2xl font-bold text-green-900">{stats.jackpotsWon}</p>
                </div>
                <div>
                  <p className="text-sm text-green-700">Total ETH won</p>
                  <p className="text-2xl font-bold text-green-900">
                    {parseFloat(stats.totalEthWon).toFixed(4)}
                  </p>
                </div>
              </div>
            </div>

            {/* XP Section */}
            <div className="bg-gradient-to-br from-yellow-50 to-orange-50 rounded-lg p-6 text-center space-y-2">
              <p className="text-sm text-orange-700 font-semibold">Your XP</p>
              <p className="text-5xl font-bold text-orange-900">{xp.toLocaleString()}</p>
            </div>

            {/* Coming Soon Message */}
            <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4 space-y-3">
              <h3 className="text-lg font-bold text-blue-900 text-center">
                🚧 Coming Soon
              </h3>
              <div className="text-sm text-blue-700 space-y-2">
                <p>
                  XP is currently being tracked but doesn't unlock any features yet.
                </p>
                <p className="font-semibold">
                  Future updates will include:
                </p>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>XP-based progression system</li>
                  <li>Leaderboards and rankings</li>
                  <li>Unlockable rewards and bonuses</li>
                  <li>Achievement badges</li>
                  <li>Special perks for high-XP players</li>
                </ul>
              </div>
            </div>

            {/* How XP is Earned */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-2">
              <h3 className="text-sm font-bold text-gray-900">How to earn XP</h3>
              <ul className="text-xs text-gray-700 space-y-1">
                <li>• Making guesses (free or paid)</li>
                <li>• Winning jackpots</li>
                <li>• Referring new players</li>
                <li>• Daily participation</li>
              </ul>
              <p className="text-xs text-gray-500 italic pt-2">
                Keep playing to build up your XP before the progression system launches!
              </p>
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

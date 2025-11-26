import { useState, useEffect } from 'react';
import type { UserStatsResponse } from '../pages/api/user/stats';
import { triggerHaptic, haptics } from '../src/lib/haptics';
import sdk from '@farcaster/miniapp-sdk';
import { useTranslation } from '../src/hooks/useTranslation';

interface StatsSheetProps {
  fid: number | null;
  onClose: () => void;
}

/**
 * StatsSheet Component
 * Milestone 4.3, Updated Milestone 6.3, Updated Milestone 6.7
 *
 * Displays per-user gameplay statistics and XP in a bottom sheet
 *
 * Milestone 6.3 additions:
 * - Guesses per round histogram
 * - Median guesses to solve
 * - Free vs bonus vs paid guesses breakdown
 * - Referrals generated this round
 *
 * Milestone 6.7 additions:
 * - XP now fetched from /api/user/xp (event-sourced from xp_events table)
 * - Updated "How to earn XP" section with actual XP values
 */
export default function StatsSheet({ fid, onClose }: StatsSheetProps) {
  const { t } = useTranslation();
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
        // Fetch stats and XP in parallel
        // Milestone 6.7: XP now fetched from /api/user/xp (event-sourced)
        const [statsResponse, xpResponse] = await Promise.all([
          fetch(`/api/user/stats?devFid=${fid}`),
          fetch(`/api/user/xp?fid=${fid}`)
        ]);

        if (!statsResponse.ok) {
          throw new Error('Failed to fetch stats');
        }

        const statsData = await statsResponse.json();
        setStats(statsData);

        // Get XP from the new XP endpoint (Milestone 6.7)
        if (xpResponse.ok) {
          const xpData = await xpResponse.json();
          setXp(xpData.totalXp || 0);
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

  /**
   * Share stats on Farcaster
   */
  const handleShareStats = async () => {
    if (!stats) return;

    try {
      const castText = `My Let's Have A Word! stats:\n\n` +
        `🎯 ${stats.guessesAllTime} total guesses (${stats.paidGuessesAllTime} paid)\n` +
        `🏆 ${stats.jackpotsWon} jackpots won\n` +
        `🔝 ${stats.topGuesserPlacements} top 10 placements\n` +
        `🤝 ${stats.referralWins} referral wins\n` +
        `💰 ${parseFloat(stats.totalEthWon).toFixed(4)} ETH all-time\n` +
        `⚡ ${xp.toLocaleString()} XP\n\n` +
        `@letshaveaword`;

      await sdk.actions.composeCast({
        text: castText,
      });

      triggerHaptic('success');
    } catch (error) {
      console.error('[StatsSheet] Error sharing stats:', error);
      triggerHaptic('error');
    }
  };

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
              <h3 className="text-lg font-bold text-purple-900">{t('stats.allTime')}</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-sm text-purple-700">{t('stats.totalGuesses')}</p>
                  <p className="text-2xl font-bold text-purple-900">{stats.guessesAllTime}</p>
                </div>
                <div>
                  <p className="text-sm text-purple-700">{t('stats.paidGuesses')}</p>
                  <p className="text-2xl font-bold text-purple-900">{stats.paidGuessesAllTime}</p>
                </div>
              </div>
            </div>

            {/* Milestone 6.3: Guess Breakdown */}
            <div className="bg-indigo-50 rounded-lg p-4 space-y-3">
              <h3 className="text-lg font-bold text-indigo-900">{t('stats.guessBreakdown.title')}</h3>
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-white rounded-lg p-3 text-center">
                  <p className="text-xs text-indigo-600">{t('stats.guessBreakdown.free')}</p>
                  <p className="text-xl font-bold text-indigo-900">{stats.freeGuessesAllTime}</p>
                </div>
                <div className="bg-white rounded-lg p-3 text-center">
                  <p className="text-xs text-indigo-600">{t('stats.guessBreakdown.bonus')}</p>
                  <p className="text-xl font-bold text-indigo-900">{stats.bonusGuessesAllTime}</p>
                </div>
                <div className="bg-white rounded-lg p-3 text-center">
                  <p className="text-xs text-indigo-600">{t('stats.guessBreakdown.paid')}</p>
                  <p className="text-xl font-bold text-indigo-900">{stats.paidGuessesAllTime}</p>
                </div>
              </div>
              {stats.medianGuessesToSolve !== null && (
                <div className="bg-white rounded-lg p-3 text-center mt-2">
                  <p className="text-xs text-indigo-600">{t('stats.guessDistribution.median')}</p>
                  <p className="text-xl font-bold text-indigo-900">{stats.medianGuessesToSolve}</p>
                </div>
              )}
            </div>

            {/* Milestone 6.3: Guesses per Round Histogram */}
            {stats.guessesPerRoundHistogram.length > 0 && (
              <div className="bg-teal-50 rounded-lg p-4 space-y-3">
                <h3 className="text-lg font-bold text-teal-900">{t('stats.guessDistribution.title')}</h3>
                <div className="flex items-end gap-1 h-24">
                  {stats.guessesPerRoundHistogram.slice().reverse().map((item, idx) => {
                    const maxGuesses = Math.max(...stats.guessesPerRoundHistogram.map(h => h.guesses));
                    const height = maxGuesses > 0 ? (item.guesses / maxGuesses) * 100 : 0;
                    return (
                      <div
                        key={idx}
                        className="flex-1 bg-teal-400 rounded-t relative group cursor-pointer transition-colors hover:bg-teal-500"
                        style={{ height: `${Math.max(height, 5)}%` }}
                        title={`Round ${item.round}: ${item.guesses} guesses`}
                      >
                        <div className="absolute -top-5 left-1/2 transform -translate-x-1/2 text-xs text-teal-700 font-medium opacity-0 group-hover:opacity-100">
                          {item.guesses}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-teal-600 text-center">Last {stats.guessesPerRoundHistogram.length} rounds</p>
              </div>
            )}

            {/* Milestone 6.3: Referrals This Round */}
            {stats.referralsGeneratedThisRound > 0 && (
              <div className="bg-amber-50 rounded-lg p-4 flex items-center justify-between">
                <span className="text-sm font-medium text-amber-900">{t('stats.referralsThisRound')}</span>
                <span className="text-2xl font-bold text-amber-900">{stats.referralsGeneratedThisRound}</span>
              </div>
            )}

            {/* Wins */}
            <div className="bg-green-50 rounded-lg p-4 space-y-3">
              <h3 className="text-lg font-bold text-green-900">Jackpots</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-sm text-green-700">Jackpots won</p>
                  <p className="text-2xl font-bold text-green-900">{stats.jackpotsWon}</p>
                </div>
                <div>
                  <p className="text-sm text-green-700">Top 10 placements</p>
                  <p className="text-2xl font-bold text-green-900">{stats.topGuesserPlacements}</p>
                </div>
                <div>
                  <p className="text-sm text-green-700">ETH from top 10</p>
                  <p className="text-2xl font-bold text-green-900">
                    {parseFloat(stats.topGuesserEthWon).toFixed(4)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-green-700">Referral wins</p>
                  <p className="text-2xl font-bold text-green-900">{stats.referralWins}</p>
                </div>
                <div>
                  <p className="text-sm text-green-700">ETH from referrals</p>
                  <p className="text-2xl font-bold text-green-900">
                    {parseFloat(stats.referralEthWon).toFixed(4)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-green-700">All-time ETH won</p>
                  <p className="text-2xl font-bold text-green-900">
                    {parseFloat(stats.totalEthWon).toFixed(4)}
                  </p>
                </div>
              </div>
            </div>

            {/* Share Stats Button */}
            <button
              onClick={handleShareStats}
              className="w-full py-3 px-4 text-white font-bold rounded-lg active:scale-95 transition-all shadow-lg flex items-center justify-center gap-2"
              style={{ backgroundColor: '#6A3CFF' }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#5A2CEF'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#6A3CFF'}
            >
              <img src="/FC-arch-icon.png" alt="Farcaster" className="w-4 h-4" />
              {t('stats.shareButton')}
            </button>

            {/* XP Section */}
            <div className="bg-gradient-to-br from-yellow-50 to-orange-50 rounded-lg p-6 text-center space-y-2">
              <p className="text-sm text-orange-700 font-semibold">Your XP</p>
              <p className="text-5xl font-bold text-orange-900">{xp.toLocaleString()}</p>
            </div>

            {/* Coming Soon Message */}
            <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4 space-y-3">
              <h3 className="text-lg font-bold text-blue-900 text-center">
                🚧 Coming soon
              </h3>
              <div className="text-sm text-blue-700 space-y-2">
                <p>
                  XP is currently being tracked but doesn't unlock any features yet.
                </p>
                <p className="font-semibold">
                  Future updates may include:
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

            {/* How XP is Earned - Milestone 6.7 */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-2">
              <h3 className="text-sm font-bold text-gray-900">How to earn XP</h3>
              <ul className="text-sm text-gray-700 space-y-1">
                <li>• <strong>+10 XP</strong> — Daily participation (first guess)</li>
                <li>• <strong>+2 XP</strong> — Each valid guess</li>
                <li>• <strong>+2,500 XP</strong> — Winning the jackpot</li>
                <li>• <strong>+50 XP</strong> — Top 10 guesser placement</li>
                <li>• <strong>+20 XP</strong> — Referred user makes first guess</li>
                <li>• <strong>+15 XP</strong> — Consecutive day streak</li>
                <li>• <strong>+15 XP</strong> — Sharing to Farcaster</li>
                <li>• <strong>+20 XP</strong> — Buying a guess pack</li>
                <li>• <strong>+10 XP</strong> — CLANKTON holder daily bonus</li>
              </ul>
              <p className="text-sm text-gray-500 italic pt-2">
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

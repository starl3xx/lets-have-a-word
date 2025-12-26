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
 * Milestone 4.3, Updated Milestone 6.3, Updated Milestone 6.7, Updated Milestone 7.0
 *
 * Displays per-user gameplay statistics and XP in a bottom sheet
 *
 * Milestone 7.0: Visual polish
 * - Unified color palette (brand blue for stats, green for earnings, accent for XP)
 * - Consistent typography and spacing
 * - Uses new design token classes
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
        const [statsResponse, xpResponse] = await Promise.all([
          fetch(`/api/user/stats?devFid=${fid}`),
          fetch(`/api/user/xp?fid=${fid}`)
        ]);

        if (!statsResponse.ok) {
          throw new Error('Failed to fetch stats');
        }

        const statsData = await statsResponse.json();
        setStats(statsData);

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
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 pb-4 mb-4">
          <h2 className="text-2xl font-bold text-gray-900">Your Stats</h2>
          <button onClick={onClose} className="btn-close" aria-label="Close">
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
          <div className="bg-error-50 border border-error-200 rounded-btn p-4">
            <p className="text-error-700 text-center">{error}</p>
          </div>
        )}

        {/* Stats Display */}
        {stats && !isLoading && (
          <div className="space-y-4">
            {/* This Round */}
            <div className="section-card bg-brand-50">
              <h3 className="text-base font-semibold text-brand-900">This Round</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-sm text-brand-700">Total guesses</p>
                  <p className="text-2xl font-bold text-brand-900 tabular-nums">{stats.guessesThisRound}</p>
                </div>
                <div>
                  <p className="text-sm text-brand-700">Paid guesses</p>
                  <p className="text-2xl font-bold text-brand-900 tabular-nums">{stats.paidGuessesThisRound}</p>
                </div>
              </div>
            </div>

            {/* All Time */}
            <div className="section-card bg-brand-50">
              <h3 className="text-base font-semibold text-brand-900">{t('stats.allTime')}</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-sm text-brand-700">{t('stats.totalGuesses')}</p>
                  <p className="text-2xl font-bold text-brand-900 tabular-nums">{stats.guessesAllTime}</p>
                </div>
                <div>
                  <p className="text-sm text-brand-700">{t('stats.paidGuesses')}</p>
                  <p className="text-2xl font-bold text-brand-900 tabular-nums">{stats.paidGuessesAllTime}</p>
                </div>
              </div>
            </div>

            {/* Guess Breakdown */}
            <div className="section-card bg-gray-50">
              <h3 className="text-base font-semibold text-gray-900">{t('stats.guessBreakdown.title')}</h3>
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-white rounded-lg p-3 text-center border border-gray-100">
                  <p className="text-xs text-gray-600">{t('stats.guessBreakdown.free')}</p>
                  <p className="text-xl font-bold text-gray-900 tabular-nums">{stats.freeGuessesAllTime}</p>
                </div>
                <div className="bg-white rounded-lg p-3 text-center border border-gray-100">
                  <p className="text-xs text-gray-600">{t('stats.guessBreakdown.bonus')}</p>
                  <p className="text-xl font-bold text-gray-900 tabular-nums">{stats.bonusGuessesAllTime}</p>
                </div>
                <div className="bg-white rounded-lg p-3 text-center border border-gray-100">
                  <p className="text-xs text-gray-600">{t('stats.guessBreakdown.paid')}</p>
                  <p className="text-xl font-bold text-gray-900 tabular-nums">{stats.paidGuessesAllTime}</p>
                </div>
              </div>
              {stats.medianGuessesToSolve !== null && (
                <div className="bg-white rounded-lg p-3 text-center mt-2 border border-gray-100">
                  <p className="text-xs text-gray-600">{t('stats.guessDistribution.median')}</p>
                  <p className="text-xl font-bold text-gray-900 tabular-nums">{stats.medianGuessesToSolve}</p>
                </div>
              )}
            </div>

            {/* Guesses per Round Histogram */}
            {stats.guessesPerRoundHistogram.length > 0 && (
              <div className="section-card bg-gray-50">
                <h3 className="text-base font-semibold text-gray-900">{t('stats.guessDistribution.title')}</h3>
                <div className="flex items-end gap-1 h-20">
                  {stats.guessesPerRoundHistogram.slice().reverse().map((item, idx) => {
                    const maxGuesses = Math.max(...stats.guessesPerRoundHistogram.map(h => h.guesses));
                    const height = maxGuesses > 0 ? (item.guesses / maxGuesses) * 100 : 0;
                    return (
                      <div
                        key={idx}
                        className="flex-1 bg-brand-400 rounded-t relative group cursor-pointer transition-colors duration-fast hover:bg-brand-500"
                        style={{ height: `${Math.max(height, 5)}%` }}
                        title={`Round ${item.round}: ${item.guesses} guesses`}
                      >
                        <div className="absolute -top-5 left-1/2 transform -translate-x-1/2 text-xs text-brand-700 font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-fast">
                          {item.guesses}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-gray-500 text-center">Last {stats.guessesPerRoundHistogram.length} rounds</p>
              </div>
            )}

            {/* Referrals This Round */}
            {stats.referralsGeneratedThisRound > 0 && (
              <div className="section-card bg-accent-50 flex items-center justify-between">
                <span className="text-sm font-medium text-accent-900">{t('stats.referralsThisRound')}</span>
                <span className="text-2xl font-bold text-accent-900 tabular-nums">{stats.referralsGeneratedThisRound}</span>
              </div>
            )}

            {/* Earnings */}
            <div className="section-card bg-success-50">
              <h3 className="text-base font-semibold text-success-900">Earnings</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-sm text-success-700">Jackpots won</p>
                  <p className="text-2xl font-bold text-success-900 tabular-nums">{stats.jackpotsWon}</p>
                </div>
                <div>
                  <p className="text-sm text-success-700">Top 10 placements</p>
                  <p className="text-2xl font-bold text-success-900 tabular-nums">{stats.topGuesserPlacements}</p>
                </div>
                <div>
                  <p className="text-sm text-success-700">ETH from top 10</p>
                  <p className="text-2xl font-bold text-success-900 tabular-nums">
                    {parseFloat(stats.topGuesserEthWon).toFixed(4)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-success-700">Referral wins</p>
                  <p className="text-2xl font-bold text-success-900 tabular-nums">{stats.referralWins}</p>
                </div>
                <div>
                  <p className="text-sm text-success-700">ETH from referrals</p>
                  <p className="text-2xl font-bold text-success-900 tabular-nums">
                    {parseFloat(stats.referralEthWon).toFixed(4)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-success-700">All-time ETH won</p>
                  <p className="text-2xl font-bold text-success-900 tabular-nums">
                    {parseFloat(stats.totalEthWon).toFixed(4)}
                  </p>
                </div>
              </div>
            </div>

            {/* Share Stats Button */}
            <button onClick={handleShareStats} className="btn-accent w-full flex items-center justify-center gap-2">
              <img src="/FC-arch-icon.png" alt="Farcaster" className="w-4 h-4" />
              {t('stats.shareButton')}
            </button>

            {/* XP Section */}
            <div className="section-card bg-gradient-to-br from-accent-50 to-accent-100 text-center">
              <p className="text-sm text-accent-700 font-medium">Your XP</p>
              <p className="text-5xl font-extrabold text-accent-900 tabular-nums">{xp.toLocaleString()}</p>
            </div>

            {/* Coming Soon Message */}
            <div className="section-card bg-brand-50 border-2 border-brand-200">
              <h3 className="text-base font-semibold text-brand-900 text-center">
                Coming soon?
              </h3>
              <div className="text-sm text-brand-700 space-y-2">
                <p>
                  XP is currently being tracked but doesn't unlock any features yet.
                </p>
                <p className="font-medium">
                  Future updates may include:
                </p>
                <ul className="list-disc list-inside space-y-1 text-xs text-brand-600">
                  <li>XP-based progression system</li>
                  <li>Leaderboards and rankings</li>
                  <li>Unlockable rewards and bonuses</li>
                  <li>Achievement badges</li>
                  <li>Special perks for high-XP players</li>
                </ul>
              </div>
            </div>

            {/* How XP is Earned */}
            <div className="section-card bg-gray-50">
              <h3 className="text-sm font-semibold text-gray-900">How to earn XP</h3>
              <ul className="list-disc list-inside text-sm text-gray-700 space-y-1 mt-2">
                <li><strong>+2 XP</strong> — Each valid guess</li>
                <li><strong>+10 XP</strong> — Daily participation (first guess)</li>
                <li><strong>+10 XP</strong> — CLANKTON holder daily bonus</li>
                <li><strong>+15 XP</strong> — Consecutive day streak</li>
                <li><strong>+15 XP</strong> — Sharing to Farcaster/Base</li>
                <li><strong>+20 XP</strong> — Referred user makes first guess</li>
                <li><strong>+20 XP</strong> — Buying a guess pack</li>
                <li><strong>+50 XP</strong> — Top 10 guesser placement</li>
                <li><strong>+2,500 XP</strong> — Winning the jackpot</li>
              </ul>
            </div>
          </div>
        )}

        {/* Close Button */}
        <button onClick={onClose} className="btn-secondary w-full mt-4">
          Close
        </button>
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { formatWordAmount } from '../src/lib/word-amounts';
import type { UserStatsResponse } from '../pages/api/user/stats';
import type { UserProfileResponse } from '../pages/api/user/profile';
import type { UserWordmarksResponse } from '../pages/api/user/wordmarks';
import type { UserWordmark } from '../src/lib/wordmarks';
import { triggerHaptic, haptics } from '../src/lib/haptics';
import sdk from '@farcaster/miniapp-sdk';
import { withHostTimeout, openXComposer, HOST_COMPOSE_TIMEOUT_MS } from '../src/lib/hostActions';
import { useIsInMiniApp } from '../src/hooks/useIsInMiniApp';
import { X_HANDLE, FARCASTER_HANDLE } from '../config/economy';
import { X_BUTTON_CLASS } from '../src/lib/hostActions';
import { useTranslation } from '../src/hooks/useTranslation';
import OgHunterBadge from './OgHunterBadge';
import WordmarkDetailModal from './WordmarkDetailModal';
import { LinkCodeIssuer, LinkCodeRedeemer } from './AccountLinkCard';
import { WORDMARK_COLORS, WORDMARK_COLOR_FALLBACK } from './wordmark-display';

interface StatsSheetProps {
  fid: number | null;
  onClose: () => void;
  /** Quick Auth token, for issuing a Base app link code. Farcaster path only. */
  authToken?: string | null;
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
/**
 * One earnings figure, with its $WORD counterpart underneath when there is one.
 *
 * Rounds 1-33 paid ETH and 34+ pay $WORD, and the two cannot be summed into a
 * single number. Showing them stacked keeps both truthful; the $WORD line is
 * omitted entirely when zero, so a player whose history is all pre-34 sees
 * exactly what they saw before.
 */
function EarningsStat({
  label,
  eth,
  word,
}: {
  label: string;
  eth: string;
  word?: string;
}) {
  let wordWei = 0n;
  try {
    wordWei = BigInt(word ?? '0');
  } catch {
    wordWei = 0n;
  }

  const ethValue = parseFloat(eth || '0');
  const hasEth = ethValue > 0;
  const hasWord = wordWei > 0n;

  return (
    <div>
      <p className="text-sm text-success-700">{label}</p>

      {/*
        $WORD leads because it is the currency the game pays in now, and ETH
        appears only for the players who actually won some. Nearly everyone has
        zero pre-34 earnings, and showing them a permanent "0.0000 ETH" line
        would make the panel look like it was reporting a loss.
      */}
      {hasWord && (
        <p className="text-2xl font-bold text-success-900 tabular-nums">
          {formatWordAmount(wordWei)}{' '}
          <span className="text-base font-semibold">$WORD</span>
        </p>
      )}

      {hasEth && (
        <p
          className={
            hasWord
              ? 'text-sm font-semibold text-success-800 tabular-nums'
              : 'text-2xl font-bold text-success-900 tabular-nums'
          }
        >
          {ethValue.toFixed(4)}{' '}
          <span className={hasWord ? '' : 'text-base font-semibold'}>ETH</span>
        </p>
      )}

      {/*
        Neither is not the same as zero-of-one: with no earnings at all there is
        no currency to name, and picking one would imply the player had played
        in that era.
      */}
      {!hasEth && !hasWord && (
        <p className="text-2xl font-bold text-success-900 tabular-nums">0</p>
      )}
    </div>
  );
}

export default function StatsSheet({ fid, onClose, authToken }: StatsSheetProps) {
  const { t } = useTranslation();
  const { inMiniApp, resolved } = useIsInMiniApp();
  const [stats, setStats] = useState<UserStatsResponse | null>(null);
  const [profile, setProfile] = useState<UserProfileResponse | null>(null);
  const [xp, setXp] = useState<number>(0);
  const [hasOgHunterBadge, setHasOgHunterBadge] = useState(false);
  const [wordmarksData, setWordmarksData] = useState<UserWordmarksResponse | null>(null);
  const [selectedWordmark, setSelectedWordmark] = useState<UserWordmark | null>(null);
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
        // Fetch stats, XP, badge status, profile, and wordmarks in parallel
        const [statsResponse, xpResponse, badgeResponse, profileResponse, wordmarksResponse] = await Promise.all([
          fetch(`/api/user/stats?devFid=${fid}`),
          fetch(`/api/user/xp?fid=${fid}`),
          fetch(`/api/og-hunter/status?fid=${fid}`),
          fetch(`/api/user/profile?fid=${fid}`),
          fetch(`/api/user/wordmarks?fid=${fid}`)
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

        if (badgeResponse.ok) {
          const badgeData = await badgeResponse.json();
          setHasOgHunterBadge(badgeData.isAwarded || false);
        }

        if (profileResponse.ok) {
          const profileData = await profileResponse.json();
          setProfile(profileData);
        }

        if (wordmarksResponse.ok) {
          const wordmarksData = await wordmarksResponse.json();
          setWordmarksData(wordmarksData);
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
      // Two sources of $WORD, both "earned from playing" to a player: the
      // reward economy (bonus words, top 10, staking) counted in whole tokens,
      // and jackpot payouts counted in wei. Combined for the cast; kept apart
      // in the panel above, where the ETH/$WORD distinction is the point.
      let combinedWordWei = 0n;
      try {
        combinedWordWei =
          BigInt(Math.trunc(Number(stats.totalWordEarned || '0'))) * 10n ** 18n +
          BigInt(stats.totalWordWon || '0');
      } catch {
        combinedWordWei = 0n;
      }
      const totalWordEarned = formatWordAmount(combinedWordWei);
    const castText = `My Let's Have A Word! stats:\n\n` +
        `🎯 ${stats.guessesAllTime} total guesses (${stats.paidGuessesAllTime} paid)\n` +
        `🏆 ${stats.jackpotsWon} jackpots won\n` +
        `🎣 ${stats.bonusWordsFound || 0} Bonus words found\n` +
        `🔥 ${stats.burnWordsFound || 0} Burn words found\n` +
        `🔝 ${stats.topGuesserPlacements} Top 10 early guessers\n` +
        `🤝 ${stats.referralWins} referral wins\n` +
        // Only the lines a player actually has. This unconditionally cast
        // "0.0000 ETH earned" for anyone who never played a pre-34 round —
        // publicly announcing a zero for a currency the game no longer pays in.
        (parseFloat(stats.totalEthWon) > 0
          ? `💰 ${parseFloat(stats.totalEthWon).toFixed(4)} ETH earned\n`
          : '') +
        (totalWordEarned && totalWordEarned !== '0'
          ? `🪙 ${totalWordEarned} $WORD earned\n`
          : '') +
        `⚡ ${xp.toLocaleString()} XP\n\n`;

      // Share where the player actually is. `composeCast` needs a Farcaster
      // host, so off-host (Base App, plain web) it never settles and this
      // button was simply dead. The X web intent works everywhere. The handle
      // differs per network, so it is appended per branch rather than baked
      // into the text above — @letshaveaword is the Farcaster account.
      if (!inMiniApp && (resolved || !(await sdk.isInMiniApp()))) {
        openXComposer(`${castText}${X_HANDLE}`, 'https://letshaveaword.fun');
        triggerHaptic('success');
        return;
      }

      await withHostTimeout(
        sdk.actions.composeCast({
          text: `${castText}${FARCASTER_HANDLE}`,
          embeds: ['https://letshaveaword.fun'],
        }),
        'composeCast',
        HOST_COMPOSE_TIMEOUT_MS
      );

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
        <div className="flex items-center justify-between border-b border-gray-200 pb-4 mb-4 gap-2">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {/* Profile Picture */}
            <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-brand-200 flex-shrink-0">
              {profile?.pfpUrl ? (
                <img
                  src={profile.pfpUrl}
                  alt={profile.username || 'Profile'}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-brand-100 flex items-center justify-center">
                  <span className="text-brand-400 text-lg">?</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-xl font-bold text-gray-900 flex items-baseline min-w-0">
                <span className="truncate">{profile?.username || 'Player'}</span>
                <span className="flex-shrink-0">&nbsp;Has A Word!</span>
              </h2>
              {hasOgHunterBadge && (
                <OgHunterBadge size="md" showTooltip={true} />
              )}
            </div>
          </div>
          <button onClick={onClose} className="btn-close flex-shrink-0" aria-label="Close">
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
            {/* Lexicon - Your Wordmarks */}
            {wordmarksData && (
              <div className="section-card bg-gradient-to-br from-indigo-50 to-purple-50">
                <div className="mb-4">
                  <h3 className="text-lg font-bold text-indigo-900">Lexicon</h3>
                  <p className="text-sm text-indigo-600">
                    Your Wordmarks · {wordmarksData.earnedCount}/{wordmarksData.totalCount}
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  {wordmarksData.wordmarks.map((wordmark) => {
                    const colors = WORDMARK_COLORS[wordmark.color] || WORDMARK_COLOR_FALLBACK;

                    return (
                      <button
                        key={wordmark.id}
                        type="button"
                        onClick={() => {
                          triggerHaptic('light');
                          setSelectedWordmark(wordmark);
                        }}
                        className={`flex flex-col items-center gap-1.5 transition active:scale-95 ${
                          wordmark.earned ? '' : 'opacity-40'
                        }`}
                      >
                        <div
                          className={`w-10 h-10 rounded-full flex items-center justify-center text-xl ${
                            wordmark.earned ? colors.bg : 'bg-gray-200'
                          }`}
                          style={{
                            boxShadow: wordmark.earned
                              ? `0 0 0 2px ${colors.ring}`
                              : '0 0 0 1px #d1d5db'
                          }}
                        >
                          <span role="img" aria-label={wordmark.name}>
                            {wordmark.emoji}
                          </span>
                        </div>
                        <span className={`text-xs font-medium text-center leading-tight ${
                          wordmark.earned ? 'text-indigo-900' : 'text-gray-500'
                        }`}>
                          {wordmark.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* This round */}
            <div className="section-card bg-brand-50">
              <h3 className="text-base font-semibold text-brand-900">This round</h3>
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
                <div className="bg-white rounded-lg p-3 text-center border border-gray-100" title="$WORD holder bonus + share bonus">
                  <p className="text-xs text-gray-600">{t('stats.guessBreakdown.bonus')}</p>
                  <p className="text-xl font-bold text-gray-900 tabular-nums">{stats.bonusGuessesAllTime}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">$WORD + share</p>
                </div>
                <div className="bg-white rounded-lg p-3 text-center border border-gray-100">
                  <p className="text-xs text-gray-600">{t('stats.guessBreakdown.paid')}</p>
                  <p className="text-xl font-bold text-gray-900 tabular-nums">{stats.paidGuessesAllTime}</p>
                </div>
              </div>
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
                <EarningsStat
                  label="From top 10"
                  eth={stats.topGuesserEthWon}
                  word={stats.topGuesserWordWon}
                />
                <div>
                  <p className="text-sm text-success-700">Referral wins</p>
                  <p className="text-2xl font-bold text-success-900 tabular-nums">{stats.referralWins}</p>
                </div>
                <EarningsStat
                  label="From referrals"
                  eth={stats.referralEthWon}
                  word={stats.referralWordWon}
                />
                <EarningsStat
                  label="All-time won"
                  eth={stats.totalEthWon}
                  word={stats.totalWordWon}
                />
              </div>
            </div>

            {/* Share Stats Button */}
            {/* Linking the two doors. A returning Farcaster player who opens
                the game in Base App otherwise starts over — no grandfathering,
                no Early Adopter Wordmark, no XP — because their Base Account is
                a different wallet from the Neynar-verified one. Each side shows
                only its own half of the handshake. */}
            {inMiniApp ? (
              <LinkCodeIssuer authToken={authToken} />
            ) : profile?.origin === 'wallet' ? (
              <LinkCodeRedeemer
                onLinked={() => {
                  // The session now names the Farcaster account, so everything
                  // on screen is about the wrong player until it reloads.
                  window.location.reload();
                }}
              />
            ) : null}

            {/* The icon follows the destination: off-host this shares to X,
                and a Farcaster arch on a button that opens X would be a lie
                about where the post is going. */}
            {/* Black where it opens X, purple where it casts: the button's
                colour is part of telling the player where the post is going. */}
            <button
              onClick={handleShareStats}
              className={`w-full flex items-center justify-center gap-2 ${
                inMiniApp ? 'btn-accent' : 'py-4 px-6 ' + X_BUTTON_CLASS
              }`}
            >
              {inMiniApp ? (
                <img src="/FC-arch-icon.png" alt="Farcaster" className="w-3 h-3" />
              ) : (
                <span className="text-base leading-none">𝕏</span>
              )}
              {t('stats.shareButton')}
            </button>

            {/* XP Section */}
            <div className="section-card bg-gradient-to-br from-accent-50 to-accent-100 text-center">
              <p className="text-sm text-accent-700 font-medium">Your XP</p>
              <p className="text-5xl font-extrabold text-accent-900 tabular-nums">{xp.toLocaleString()}</p>
            </div>

            {/* XP Utility: Staking Boost */}
            <div className="section-card bg-brand-50 border-2 border-brand-200">
              <h3 className="text-base font-semibold text-brand-900 text-center">
                XP boosts staking rewards
              </h3>
              <div className="text-sm text-brand-700 space-y-2">
                <p>
                  XP determines your staking reward multiplier. Stake $WORD tokens to earn streaming rewards, and your XP tier boosts your yield:
                </p>
                <ul className="list-none space-y-1 text-xs text-brand-600">
                  <li><strong>Passive</strong> (0 XP) — 1.0x base rate</li>
                  <li><strong>Bronze</strong> (1,000 XP) — 1.15x rewards</li>
                  <li><strong>Silver</strong> (5,000 XP) — 1.35x rewards</li>
                  <li><strong>Gold</strong> (15,000 XP) — 1.6x rewards</li>
                </ul>
                <p className="text-xs text-brand-500 mt-1">
                  More XP utility may be added in future updates.
                </p>
              </div>
            </div>

            {/* How XP is Earned */}
            <div className="section-card bg-gray-50">
              <h3 className="text-sm font-semibold text-gray-900">How to earn XP</h3>
              <ul className="list-disc list-inside text-sm text-gray-700 space-y-1 mt-2">
                <li><strong>+2 XP</strong> — Each valid guess</li>
                <li><strong>+10 XP</strong> — Daily participation (first guess)</li>
                <li><strong>+10 XP</strong> — $WORD holder daily bonus</li>
                <li><strong>+15 XP</strong> — Consecutive day streak</li>
                <li><strong>+15 XP</strong> — Sharing guess to Farcaster/Base</li>
                <li><strong>+20 XP</strong> — Referred user makes first guess</li>
                <li><strong>+20 XP</strong> — Buying a guess pack</li>
                <li><strong>+50 XP</strong> — Finding a Bonus word</li>
                <li><strong>+50 XP</strong> — Top 10 guesser placement</li>
                <li><strong>+100 XP</strong> — Finding a Burn word</li>
                <li><strong>+2,500 XP</strong> — Winning the jackpot</li>
              </ul>
            </div>
          </div>
        )}

        {/* Close Button */}
        <button onClick={onClose} className="btn-secondary w-full mt-4">
          Close
        </button>

        {/* Wordmark detail — portals its DOM to document.body (a fixed
            overlay inside this overflow-y-auto sheet clips on mobile WebKit)
            while events still bubble through the React tree, so the sheet's
            stopPropagation keeps detail clicks from closing the sheet */}
        {selectedWordmark && (
          <WordmarkDetailModal
            wordmark={selectedWordmark}
            onClose={() => setSelectedWordmark(null)}
            fid={fid}
          />
        )}
      </div>
    </div>
  );
}

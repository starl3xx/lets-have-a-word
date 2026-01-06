// pages/archive/[roundNumber].tsx
// Milestone 5.4, Updated Milestone 6.3, Milestone 7.x: Public Round Detail Page
// Restyled to match RoundArchiveModal and archive list with Söhne font
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Head from 'next/head';
import sdk from '@farcaster/miniapp-sdk';
import BadgeStack from '../../components/BadgeStack';

// Bonus Words Feature: Hidden until NEXT_PUBLIC_BONUS_WORDS_UI_ENABLED=true
const BONUS_WORDS_UI_ENABLED = process.env.NEXT_PUBLIC_BONUS_WORDS_UI_ENABLED === 'true';

interface TopGuesserWithUsername {
  fid: number;
  username: string | null;
  pfpUrl: string | null;
  amountEth: string;
  guessCount: number;
  rank: number;
  hasClanktonBadge?: boolean;
  hasOgHunterBadge?: boolean;
}

// Bonus Words Feature: Winner display in archive
interface BonusWordWinner {
  fid: number;
  word: string;
  wordIndex: number;
  clanktonAmount: string;
  txHash?: string;
  username?: string;
  pfpUrl?: string;
}

interface ArchivedRound {
  id: number;
  roundNumber: number;
  targetWord: string;
  seedEth: string;
  finalJackpotEth: string;
  totalGuesses: number;
  uniquePlayers: number;
  winnerFid: number | null;
  winnerUsername: string | null;
  winnerPfpUrl: string | null;
  winnerCastHash: string | null;
  winnerGuessNumber: number | null;
  startTime: string;
  endTime: string;
  referrerFid: number | null;
  referrerUsername: string | null;
  referrerPfpUrl: string | null;
  topGuessersWithUsernames: TopGuesserWithUsername[];
  payoutsJson: {
    winner?: { fid: number; amountEth: string };
    referrer?: { fid: number; amountEth: string };
    topGuessers: Array<{ fid: number; amountEth: string; rank: number }>;
    seed?: { amountEth: string };
    creator?: { amountEth: string };
    bonusWordWinners?: BonusWordWinner[];
  };
  salt: string;
  clanktonBonusCount: number;
  referralBonusCount: number;
  commitHash?: string;
  hasOnChainCommitment?: boolean;
  onChainCommitHash?: string;
}

interface Distribution {
  distribution: Array<{ hour: number; count: number }>;
  byPlayer: Array<{ fid: number; count: number }>;
}

// Söhne font family (matching archive list and RoundArchiveModal)
const FONT_FAMILY = "'Söhne', 'SF Pro Display', system-ui, -apple-system, sans-serif";

export default function RoundDetailPage() {
  const router = useRouter();
  const { roundNumber } = router.query;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState<ArchivedRound | null>(null);
  const [distribution, setDistribution] = useState<Distribution | null>(null);

  useEffect(() => {
    if (!roundNumber) return;

    const fetchRound = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/archive/${roundNumber}?distribution=true`);
        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('Round not found in archive');
          }
          throw new Error('Failed to load round');
        }
        const data = await response.json();
        setRound(data.round);
        setDistribution(data.distribution || null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load round');
      } finally {
        setLoading(false);
      }
    };

    fetchRound();
  }, [roundNumber]);

  const formatEth = (eth: string) => parseFloat(eth).toFixed(4);

  // Open profile using Farcaster SDK (stays in-app)
  const openProfile = async (fid: number) => {
    try {
      await sdk.actions.viewProfile({ fid });
    } catch (error) {
      console.error('Error opening profile:', error);
    }
  };

  const formatDuration = (startTime: string, endTime: string) => {
    const start = new Date(startTime);
    const end = new Date(endTime);
    const durationMs = end.getTime() - start.getTime();
    const hours = Math.floor(durationMs / (1000 * 60 * 60));
    const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Calculate max for histogram
  const maxGuesses = distribution
    ? Math.max(...distribution.distribution.map(d => d.count), 1)
    : 1;

  // Calculate prize breakdown (matching RoundArchiveModal: 80% winner, 10% referrer, 10% top guessers)
  const calculateBreakdown = (totalEth: string) => {
    const ethNum = parseFloat(totalEth);
    return {
      jackpot: (ethNum * 0.8).toFixed(4),
      referrer: (ethNum * 0.1).toFixed(4),
      topGuessers: (ethNum * 0.1).toFixed(4),
    };
  };

  const breakdown = round ? calculateBreakdown(round.finalJackpotEth) : null;

  return (
    <>
      <Head>
        <title>
          {round ? `Round #${round.roundNumber} - ${round.targetWord}` : 'Round detail'} | Let's Have A Word
        </title>
        <meta
          name="description"
          content={round ? `Round #${round.roundNumber} archive - ${round.targetWord}` : 'Round archive detail'}
        />
      </Head>

      <main
        className="min-h-screen bg-gray-50"
        style={{ fontFamily: FONT_FAMILY }}
      >
        {/* Header */}
        <div className="bg-white border-b border-gray-200">
          <div className="max-w-2xl mx-auto px-4 py-6">
            <Link
              href="/archive"
              className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 transition-colors mb-4"
            >
              ← Back to archive
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">
              {loading ? 'Loading...' : round ? `Round #${round.roundNumber}` : 'Round not found'}
            </h1>
            {round && (
              <p className="text-sm text-gray-500 mt-1">
                Completed {formatDate(round.endTime)}
              </p>
            )}
          </div>
        </div>

        {/* Target Word Display - styled exactly like word wheel input boxes with "typed in" glow */}
        {!loading && round && (
          <div className="bg-white border-b border-gray-200">
            <div className="max-w-2xl mx-auto px-4 py-8 text-center">
              <div className="flex justify-center gap-2 mb-3">
                {round.targetWord.split('').map((letter, index) => (
                  <div
                    key={index}
                    className="w-14 h-14 sm:w-16 sm:h-16 border-4 border-blue-500 rounded-lg bg-white flex items-center justify-center shadow-md ring-2 ring-blue-300 ring-opacity-50"
                  >
                    <span className="text-2xl sm:text-3xl font-bold text-gray-900 uppercase">
                      {letter}
                    </span>
                  </div>
                ))}
              </div>
              <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
                The secret word
              </div>
            </div>
          </div>
        )}

        {/* Stats Chips */}
        {!loading && round && (
          <div className="bg-white border-b border-gray-200">
            <div className="max-w-2xl mx-auto px-4 py-4">
              <div className="flex flex-wrap gap-2">
                <StatChip label="ETH" value={formatEth(round.finalJackpotEth)} highlight />
                <StatChip label="guesses" value={round.totalGuesses.toLocaleString()} />
                <StatChip label="players" value={round.uniquePlayers.toLocaleString()} />
                <StatChip label="duration" value={formatDuration(round.startTime, round.endTime)} />
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-600 text-sm">
              {error}
              <Link
                href="/archive"
                className="block mt-3 text-blue-600 font-medium"
              >
                ← Browse all rounds
              </Link>
            </div>
          )}

          {loading ? (
            <div className="text-center text-gray-500 py-12">
              <div className="w-8 h-8 border-2 border-gray-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
              Loading round details...
            </div>
          ) : round && (
            <>
              {/* Winner Section */}
              <Section title="Winner">
                {round.winnerFid ? (
                  <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {/* Winner PFP */}
                        <img
                          src={round.winnerPfpUrl || `https://avatar.vercel.sh/${round.winnerFid}`}
                          alt={round.winnerUsername || 'Winner'}
                          className="w-12 h-12 rounded-full object-cover border-2 border-green-200"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = `https://avatar.vercel.sh/${round.winnerFid}`;
                          }}
                        />
                        <div>
                          {/* Clickable username */}
                          <button
                            onClick={() => openProfile(round.winnerFid!)}
                            className="font-semibold text-gray-900 text-lg hover:text-blue-600 transition-colors text-left"
                          >
                            {round.winnerUsername?.startsWith('fid:') ? round.winnerUsername : `@${round.winnerUsername || 'unknown'}`}
                          </button>
                          {round.winnerGuessNumber && (
                            <div className="text-sm text-gray-500 mt-0.5">
                              Won on guess #{round.winnerGuessNumber}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="text-4xl">
                        🏆
                      </div>
                    </div>
                    {round.referrerFid && (
                      <div className="mt-3 pt-3 border-t border-green-200 text-sm text-gray-600 flex items-center gap-2">
                        <span>Referred by</span>
                        <button
                          onClick={() => openProfile(round.referrerFid!)}
                          className="text-gray-900 font-medium hover:text-blue-600 transition-colors"
                        >
                          {round.referrerUsername?.startsWith('fid:') ? round.referrerUsername : `@${round.referrerUsername || 'unknown'}`}
                        </button>
                        {round.payoutsJson.referrer && (
                          <span className="text-green-600 font-medium">
                            (earned {formatEth(round.payoutsJson.referrer.amountEth)} ETH)
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-gray-100 border-2 border-dashed border-gray-300 rounded-xl p-6 text-center text-gray-400">
                    No winner recorded
                  </div>
                )}
              </Section>

              {/* Prize Breakdown - 3 columns matching RoundArchiveModal */}
              {breakdown && (
                <Section title="Prize pool breakdown">
                  <div className="grid grid-cols-3 gap-3">
                    {/* Jackpot */}
                    <div className="border-2 border-green-200 bg-green-50 rounded-xl p-3 text-center">
                      <div className="text-xs text-green-700 uppercase font-semibold">Jackpot</div>
                      <div className="text-xs text-green-600/70">(80%)</div>
                      <div className="mt-2 text-lg font-bold text-gray-900">
                        .{breakdown.jackpot.replace('0.', '')}
                        <span className="text-sm font-medium opacity-50"> ETH</span>
                      </div>
                    </div>
                    {/* Referrer */}
                    <div className="border-2 border-purple-200 bg-purple-50 rounded-xl p-3 text-center">
                      <div className="text-xs text-purple-700 uppercase font-semibold">Referrer</div>
                      <div className="text-xs text-purple-600/70">(10%)</div>
                      <div className="mt-2 text-lg font-bold text-gray-900">
                        .{breakdown.referrer.replace('0.', '')}
                        <span className="text-sm font-medium opacity-50"> ETH</span>
                      </div>
                    </div>
                    {/* Early Guessers */}
                    <div className="border-2 border-amber-200 bg-amber-50 rounded-xl p-3 text-center">
                      <div className="text-xs text-amber-700 uppercase font-semibold">Top 10</div>
                      <div className="text-xs text-amber-600/70">(10%)</div>
                      <div className="mt-2 text-lg font-bold text-gray-900">
                        .{breakdown.topGuessers.replace('0.', '')}
                        <span className="text-sm font-medium opacity-50"> ETH</span>
                      </div>
                    </div>
                  </div>
                </Section>
              )}

              {/* Top 10 Guessers */}
              {round.topGuessersWithUsernames && round.topGuessersWithUsernames.length > 0 && (
                <Section title="Top 10 early guessers">
                  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    {round.topGuessersWithUsernames.map((guesser, index) => (
                      <div
                        key={guesser.fid}
                        className={`px-3 py-2 flex items-center gap-2 ${
                          index < round.topGuessersWithUsernames.length - 1 ? 'border-b border-gray-100' : ''
                        }`}
                      >
                        {/* Rank */}
                        <div className="text-gray-400 text-sm font-medium w-5 text-right flex-shrink-0">
                          {guesser.rank}.
                        </div>
                        {/* PFP */}
                        <img
                          src={guesser.pfpUrl || `https://avatar.vercel.sh/${guesser.fid}`}
                          alt={guesser.username || 'User'}
                          className="w-7 h-7 rounded-full object-cover border border-gray-200 flex-shrink-0"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = `https://avatar.vercel.sh/${guesser.fid}`;
                          }}
                        />
                        {/* Username + Badges */}
                        <div className="flex-1 flex items-center gap-1 min-w-0">
                          <button
                            onClick={() => openProfile(guesser.fid)}
                            className="text-sm font-medium text-gray-900 truncate hover:text-blue-600 transition-colors"
                          >
                            {guesser.username?.startsWith('fid:') ? guesser.username : `@${guesser.username || 'unknown'}`}
                          </button>
                          <BadgeStack
                            hasOgHunterBadge={guesser.hasOgHunterBadge}
                            hasClanktonBadge={guesser.hasClanktonBadge}
                            size="sm"
                          />
                        </div>
                        {/* Guess Count */}
                        <div className="text-sm text-gray-900 font-bold tabular-nums flex-shrink-0">
                          {guesser.guessCount}
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Bonus Words Feature: Bonus Word Finders (only if UI enabled) */}
              {BONUS_WORDS_UI_ENABLED && round.payoutsJson.bonusWordWinners && round.payoutsJson.bonusWordWinners.length > 0 && (
                <Section title="🎣 Bonus word finders">
                  <p className="text-xs text-gray-500 mb-3">5M CLANKTON each</p>
                  <div className="bg-white rounded-xl border border-cyan-200 overflow-hidden">
                    {round.payoutsJson.bonusWordWinners.map((winner, index) => (
                      <div
                        key={`${winner.fid}-${winner.word}`}
                        className={`px-3 py-2 flex items-center gap-2 ${
                          index < round.payoutsJson.bonusWordWinners!.length - 1 ? 'border-b border-cyan-100' : ''
                        }`}
                      >
                        {/* PFP */}
                        <img
                          src={winner.pfpUrl || `https://avatar.vercel.sh/${winner.fid}`}
                          alt={winner.username || 'User'}
                          className="w-7 h-7 rounded-full object-cover border border-cyan-200 flex-shrink-0"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = `https://avatar.vercel.sh/${winner.fid}`;
                          }}
                        />
                        {/* Username */}
                        <div className="flex-1 flex items-center gap-2 min-w-0">
                          <button
                            onClick={() => openProfile(winner.fid)}
                            className="text-sm font-medium text-gray-900 truncate hover:text-blue-600 transition-colors"
                          >
                            {winner.username?.startsWith('fid:') ? winner.username : `@${winner.username || `fid:${winner.fid}`}`}
                          </button>
                          <span className="text-xs text-cyan-600 font-mono font-bold uppercase">
                            {winner.word}
                          </span>
                          <span className="text-base">🎣</span>
                        </div>
                        {/* Transaction Link */}
                        {winner.txHash && (
                          <button
                            onClick={() => sdk.actions.openUrl(`https://basescan.org/tx/${winner.txHash}`)}
                            className="text-xs text-cyan-600 hover:text-cyan-700"
                          >
                            tx ↗
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Guess Distribution Histogram */}
              {distribution && distribution.distribution.length > 0 && (
                <Section title="Guess distribution by hour">
                  <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-end gap-0.5 h-24">
                      {Array.from({ length: 24 }, (_, hour) => {
                        const data = distribution.distribution.find(d => d.hour === hour);
                        const count = data?.count || 0;
                        const height = maxGuesses > 0 ? (count / maxGuesses) * 100 : 0;
                        return (
                          <div
                            key={hour}
                            className={`flex-1 rounded-t transition-colors ${
                              count > 0 ? 'bg-blue-500' : 'bg-gray-100'
                            }`}
                            style={{ height: `${Math.max(height, 3)}%` }}
                            title={`${hour}:00 - ${count} guesses`}
                          />
                        );
                      })}
                    </div>
                    <div className="flex justify-between mt-2 text-xs text-gray-400">
                      <span>0:00</span>
                      <span>6:00</span>
                      <span>12:00</span>
                      <span>18:00</span>
                      <span>23:00</span>
                    </div>
                  </div>
                </Section>
              )}

              {/* Round Details */}
              <Section title="Round details">
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <InfoRow label="Started" value={formatDate(round.startTime)} />
                  <InfoRow label="Ended" value={formatDate(round.endTime)} />
                  <InfoRow label="Seed ETH" value={`${formatEth(round.seedEth)} ETH`} />
                  <InfoRow label="CLANKTON bonuses" value={round.clanktonBonusCount.toString()} />
                  <InfoRow label="Referral signups" value={round.referralBonusCount.toString()} />

                  {/* Onchain secret word commitment */}
                  <div className="px-4 py-3 flex justify-between items-center border-t border-gray-100">
                    <span className="text-gray-500 text-sm">Onchain commitment</span>
                    {round.hasOnChainCommitment ? (
                      <button
                        onClick={() => sdk.actions.openUrl(`https://basescan.org/address/0xfcb0D07a5BB5f004A1580D5Ae903E33c4A79EdB5`)}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded text-xs font-medium transition-colors"
                      >
                        <span>View on BaseScan</span>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </button>
                    ) : (
                      <span className="text-gray-400 text-xs">Database only</span>
                    )}
                  </div>

                  {/* Prize pool distribution tx */}
                  <div className="px-4 py-3 flex justify-between items-center border-t border-gray-100">
                    <span className="text-gray-500 text-sm">Distribution tx</span>
                    {round.roundNumber === 1 ? (
                      <button
                        onClick={() => sdk.actions.openUrl(`https://basescan.org/tx/0xb5dde8065b2ea6a7d2101f8cdb92849659c63a1d4b97b0fdbfb69acd1d4bdffb`)}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded text-xs font-medium transition-colors"
                      >
                        <span>View on BaseScan</span>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </button>
                    ) : (
                      <button
                        onClick={() => sdk.actions.openUrl(`https://basescan.org/address/0xfcb0D07a5BB5f004A1580D5Ae903E33c4A79EdB5`)}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded text-xs font-medium transition-colors"
                      >
                        <span>View on BaseScan</span>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </Section>

              {/* Verify Round Button */}
              <button
                onClick={() => sdk.actions.openUrl(`https://www.letshaveaword.fun/verify?round=${round.roundNumber}`)}
                className="w-full py-3 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl transition-colors text-center"
              >
                Verify round
              </button>
            </>
          )}
        </div>
      </main>
    </>
  );
}

/**
 * StatChip - Compact stat display matching archive list style
 */
function StatChip({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 ${
      highlight ? 'bg-green-50' : 'bg-gray-100'
    }`}>
      <span className={`font-bold tabular-nums ${
        highlight ? 'text-green-600' : 'text-gray-900'
      }`}>
        {value}
      </span>
      <span className={`text-xs ${
        highlight ? 'text-green-600/70' : 'text-gray-500'
      }`}>
        {label}
      </span>
    </div>
  );
}

/**
 * Section - Section wrapper with title
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-3">
        {title}
      </div>
      {children}
    </div>
  );
}

/**
 * InfoRow - Key-value row for details list
 */
function InfoRow({ label, value, isLast }: { label: string; value: string; isLast?: boolean }) {
  return (
    <div className={`px-4 py-3 flex justify-between ${
      isLast ? '' : 'border-b border-gray-100'
    }`}>
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 font-medium">{value}</span>
    </div>
  );
}

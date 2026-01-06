import { useState, useEffect, useRef, useCallback } from 'react';
import Top10StatusChip from './Top10StatusChip';
import BadgeStack from './BadgeStack';

// Bonus Words Feature: Hidden until NEXT_PUBLIC_BONUS_WORDS_UI_ENABLED=true
const BONUS_WORDS_UI_ENABLED = process.env.NEXT_PUBLIC_BONUS_WORDS_UI_ENABLED === 'true';

interface TopGuesser {
  fid: number;
  username: string;
  guessCount: number;
  pfpUrl: string;
  hasOgHunterBadge?: boolean;
  hasClanktonBadge?: boolean;
}

// Bonus Words Feature: Winner display type
interface BonusWordWinner {
  fid: number;
  username: string;
  pfpUrl: string;
  word: string;
  wordIndex: number;
  claimedAt: string;
  txHash: string | null;
  clanktonAmount: string;
  hasOgHunterBadge?: boolean;
  hasClanktonBadge?: boolean;
  hasBonusWordBadge?: boolean;
}

interface RoundState {
  roundId: number;
  prizePoolEth: string;
  prizePoolUsd: string;
  globalGuessCount: number;
  top10Locked: boolean;
  top10GuessesRemaining: number;
  top10LockAfterGuesses: number;
  roundStartedAt?: string;
}

/**
 * Format a timestamp as "started X ago"
 */
/**
 * Format ETH value for display (max 6 decimal places, trim trailing zeros)
 */
function formatEthDisplay(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0';
  // Format to 6 decimals, then trim trailing zeros
  return num.toFixed(6).replace(/\.?0+$/, '');
}

function formatTimeAgo(isoTimestamp: string): string {
  const startTime = new Date(isoTimestamp).getTime();
  const now = Date.now();
  const diffMs = now - startTime;

  const minutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (days > 0) {
    return `${days}d ${hours % 24}h ago`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m ago`;
  } else {
    return `${minutes}m ago`;
  }
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
  // Bonus Words Feature: Bonus word winners state
  const [bonusWordWinners, setBonusWordWinners] = useState<BonusWordWinner[]>([]);
  const [totalBonusWords, setTotalBonusWords] = useState<number>(10);

  // Track if initial load is complete to avoid flickering on polls
  const hasLoadedRef = useRef(false);
  const previousGuessersRef = useRef<string>('');

  const fetchData = useCallback(async () => {
    // Only show loading spinner on initial load
    const isInitialLoad = !hasLoadedRef.current;
    if (isInitialLoad) {
      setLoading(true);
    }

    try {
      // Fetch round state, top guessers, and bonus word winners in parallel
      // Only fetch bonus words if UI is enabled
      const fetchPromises: Promise<Response>[] = [
        fetch('/api/round-state'),
        fetch('/api/round/top-guessers'),
      ];
      if (BONUS_WORDS_UI_ENABLED) {
        fetchPromises.push(fetch('/api/round/bonus-word-winners'));
      }
      const responses = await Promise.all(fetchPromises);
      const [roundResponse, guessersResponse] = responses;
      const bonusWordsResponse = BONUS_WORDS_UI_ENABLED ? responses[2] : null;

      if (!roundResponse.ok) throw new Error('Failed to load round state');
      if (!guessersResponse.ok) throw new Error('Failed to load top guessers');
      // Bonus words API returns 204 if no bonus words (legacy round)

      const roundData = await roundResponse.json();
      const guessersData = await guessersResponse.json();

      // Bonus Words Feature: Parse bonus word winners if available and UI is enabled
      if (bonusWordsResponse) {
        if (bonusWordsResponse.ok) {
          const bonusData = await bonusWordsResponse.json();
          setBonusWordWinners(bonusData.winners || []);
        } else if (bonusWordsResponse.status === 204) {
          // No bonus words for this round (legacy)
          setBonusWordWinners([]);
        }
      }

      // Only update state if data has actually changed (prevents flickering)
      setRoundState((prev) => {
        if (!prev) return roundData;
        if (
          prev.roundId === roundData.roundId &&
          prev.prizePoolEth === roundData.prizePoolEth &&
          prev.globalGuessCount === roundData.globalGuessCount &&
          prev.top10Locked === roundData.top10Locked &&
          prev.top10GuessesRemaining === roundData.top10GuessesRemaining &&
          prev.roundStartedAt === roundData.roundStartedAt
        ) {
          return prev; // No change, keep previous reference
        }
        return roundData;
      });

      // Use ref to compare guessers to avoid JSON.stringify on every render
      const newGuessers = guessersData.topGuessers || [];
      const newGuessersJson = JSON.stringify(newGuessers);
      if (previousGuessersRef.current !== newGuessersJson) {
        previousGuessersRef.current = newGuessersJson;
        setTopGuessers(newGuessers);
      }

      const newUniqueCount = guessersData.uniqueGuessersCount || 0;
      setUniqueGuessers((prev) => (prev === newUniqueCount ? prev : newUniqueCount));

      // Only clear error if there was one
      setError((prev) => (prev !== null ? null : prev));

      // Mark as loaded after first successful fetch
      if (isInitialLoad) {
        hasLoadedRef.current = true;
        setLoading(false);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to load data';
      setError((prev) => (prev !== errorMsg ? errorMsg : prev));
      if (isInitialLoad) {
        hasLoadedRef.current = true;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      // Reset for fresh load when modal opens
      hasLoadedRef.current = false;
      previousGuessersRef.current = '';

      fetchData();
      // Poll for real-time updates every 5 seconds while modal is open
      const interval = setInterval(fetchData, 5000);
      return () => clearInterval(interval);
    }
  }, [isOpen, fetchData]);

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
        className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-4 space-y-3 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header + Prize Pool + Stats - Combined for compactness */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">
              Round #{roundState?.roundId || '—'}
            </h2>
            {roundState && (
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-sm font-semibold text-green-600">{formatEthDisplay(roundState.prizePoolEth)} ETH</span>
                <span className="text-xs text-gray-500">prize pool</span>
              </div>
            )}
          </div>
          <button onClick={onClose} className="btn-close" aria-label="Close">
            ×
          </button>
        </div>
        {/* Stats chips - full width row below header */}
        {roundState && (
          <div className="flex flex-wrap gap-2 text-xs -mt-1">
            <div className="inline-flex items-center gap-1 bg-gray-100 rounded-full px-2 py-0.5">
              <span className="font-bold text-gray-900 tabular-nums">
                {roundState.globalGuessCount?.toLocaleString() || '0'}
              </span>
              <span className="text-gray-500">guesses</span>
            </div>
            <div className="inline-flex items-center gap-1 bg-gray-100 rounded-full px-2 py-0.5">
              <span className="font-bold text-gray-900 tabular-nums">
                {uniqueGuessers.toLocaleString()}
              </span>
              <span className="text-gray-500">players</span>
            </div>
            {roundState.roundStartedAt && (
              <div className="inline-flex items-center gap-1 bg-gray-100 rounded-full px-2 py-0.5">
                <span className="text-gray-500">started</span>
                <span className="font-bold text-gray-900">
                  {formatTimeAgo(roundState.roundStartedAt).replace(' ago', '')}
                </span>
                <span className="text-gray-500">ago</span>
              </div>
            )}
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
                {/* Jackpot - highlighted as the main prize */}
                <div className="border-2 border-green-200 bg-green-50 rounded-xl p-3 text-center flex flex-col">
                  {/* Header region - flex-1 grows to fill space, pushing values to bottom */}
                  <div className="flex-1 flex flex-col justify-start">
                    <div className="text-xs text-green-700 uppercase font-semibold">Jackpot</div>
                    <div className="text-xs text-green-600/70">(80% of pool)</div>
                  </div>
                  {/* Values region - mt-auto ensures alignment across cards */}
                  <div className="mt-auto pt-2">
                    <div className="text-lg leading-tight text-gray-900">
                      <span className="font-bold">.{breakdown.jackpot.eth.replace('0.', '')}</span>
                      <span className="text-sm font-medium opacity-50"> ETH</span>
                    </div>
                    <div className="text-xs text-gray-400">(${breakdown.jackpot.usd} USD)</div>
                  </div>
                </div>

                {/* Referrer */}
                <div className="border-2 border-purple-200 bg-purple-50 rounded-xl p-3 text-center flex flex-col">
                  <div className="flex-1 flex flex-col justify-start">
                    <div className="text-xs text-purple-700 uppercase font-semibold">Referrer</div>
                    <div className="text-xs text-purple-600/70">(10% of pool)</div>
                  </div>
                  <div className="mt-auto pt-2">
                    <div className="text-lg leading-tight text-gray-900">
                      <span className="font-bold">.{breakdown.referrer.eth.replace('0.', '')}</span>
                      <span className="text-sm font-medium opacity-50"> ETH</span>
                    </div>
                    <div className="text-xs text-gray-400">(${breakdown.referrer.usd} USD)</div>
                  </div>
                </div>

                {/* Early Guessers */}
                <div className="border-2 border-amber-200 bg-amber-50 rounded-xl p-3 text-center flex flex-col">
                  <div className="flex-1 flex flex-col justify-start">
                    <div className="text-xs text-amber-700 uppercase font-semibold">Early Guessers</div>
                    <div className="text-xs text-amber-600/70">(10% of pool)</div>
                  </div>
                  <div className="mt-auto pt-2">
                    <div className="text-lg leading-tight text-gray-900">
                      <span className="font-bold">.{breakdown.topGuessers.eth.replace('0.', '')}</span>
                      <span className="text-sm font-medium opacity-50"> ETH</span>
                    </div>
                    <div className="text-xs text-gray-400">(${breakdown.topGuessers.usd} USD)</div>
                  </div>
                </div>
              </div>
            )}

            {/* Payout disclaimer */}
            <p className="text-xs text-gray-400 italic text-center -mt-1">
              All payouts resolve onchain when the secret word is found
            </p>

            {/* Early Guessers List */}
            <div>
              <div className="text-center mb-1.5">
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">
                  Top 10 Early Guessers
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">(ranked from the first 750 guesses)</p>
              </div>

              {/* Top-10 Status Chip (Milestone 7.x) */}
              {roundState && (
                <div className="flex flex-col items-center mb-2">
                  <Top10StatusChip
                    top10Locked={roundState.top10Locked}
                    top10GuessesRemaining={roundState.top10GuessesRemaining}
                  />
                  <p className="text-xs text-gray-400 italic mt-1.5">Est. payout if round ended now</p>
                </div>
              )}

              {topGuessers.length === 0 ? (
                <div className="text-center text-gray-400 py-4 text-sm">
                  No guesses yet this round
                </div>
              ) : (
                <div className="space-y-1.5">
                  {topGuessers.slice(0, 10).map((guesser, index) => {
                    const rank = index + 1;
                    const top10PoolEth = breakdown ? parseFloat(breakdown.topGuessers.eth) : 0;
                    const rankPayout = getRankPayout(rank, top10PoolEth);

                    return (
                      <div key={guesser.fid} className="flex items-center gap-2">
                        {/* Rank */}
                        <div className="text-gray-500 text-sm font-medium w-5 text-right">
                          {rank}.
                        </div>
                        {/* Avatar */}
                        <img
                          src={guesser.pfpUrl}
                          alt={guesser.username}
                          className="w-7 h-7 rounded-full object-cover border border-gray-200"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = `https://avatar.vercel.sh/${guesser.fid}`;
                          }}
                        />
                        {/* Username + Badges + ETH Payout */}
                        <div className="flex-1 flex items-center gap-1 min-w-0">
                          <span className="text-sm font-medium text-gray-900 truncate">
                            {guesser.username?.startsWith('fid:') ? guesser.username : `@${guesser.username || `fid:${guesser.fid}`}`}
                          </span>
                          <BadgeStack
                            hasOgHunterBadge={guesser.hasOgHunterBadge}
                            hasClanktonBadge={guesser.hasClanktonBadge}
                            size="sm"
                          />
                          <span className="text-gray-400 text-xs tabular-nums whitespace-nowrap">
                            (.{rankPayout.replace('0.', '')} ETH)
                          </span>
                        </div>
                        {/* Guess Count */}
                        <div className="text-sm text-gray-900 font-bold tabular-nums mr-1">
                          {guesser.guessCount}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Bonus Words Feature: Bonus Word Finders Section (only if UI enabled) */}
            {BONUS_WORDS_UI_ENABLED && bonusWordWinners.length > 0 && (
              <div className="mt-4">
                <div className="text-center mb-1.5">
                  <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">
                    🎣 Bonus Word Finders
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">5M CLANKTON each</p>
                </div>

                <div className="space-y-1.5">
                  {/* Sort by claimedAt to show in order found */}
                  {[...bonusWordWinners]
                    .sort((a, b) => new Date(a.claimedAt).getTime() - new Date(b.claimedAt).getTime())
                    .map((winner, index) => (
                    <div key={`${winner.fid}-${winner.word}`} className="flex items-center gap-2">
                      {/* Rank */}
                      <div className="text-gray-500 text-sm font-medium w-5 text-right">
                        {index + 1}.
                      </div>
                      {/* Avatar */}
                      <img
                        src={winner.pfpUrl}
                        alt={winner.username}
                        className="w-7 h-7 rounded-full object-cover border border-cyan-200"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = `https://avatar.vercel.sh/${winner.fid}`;
                        }}
                      />
                      {/* Username + Badges */}
                      <div className="flex-1 flex items-center gap-1 min-w-0">
                        <span className="text-sm font-medium text-gray-900 truncate">
                          {winner.username?.startsWith('fid:') ? winner.username : `@${winner.username || `fid:${winner.fid}`}`}
                        </span>
                        <BadgeStack
                          hasOgHunterBadge={winner.hasOgHunterBadge}
                          hasClanktonBadge={winner.hasClanktonBadge}
                          hasBonusWordBadge={winner.hasBonusWordBadge}
                          size="sm"
                        />
                      </div>
                      {/* Word - right aligned */}
                      <div className="text-sm text-cyan-600 font-mono font-bold uppercase mr-1">
                        {winner.word}
                      </div>
                    </div>
                  ))}
                </div>

                <p className="text-xs text-gray-400 italic text-center mt-2">
                  {totalBonusWords - bonusWordWinners.length} bonus words remaining
                </p>
              </div>
            )}
          </>
        )}

        {/* View Full Archive Button */}
        <a
          href="/archive"
          className="block w-full py-3 px-4 bg-blue-500 text-white font-semibold rounded-xl hover:bg-blue-600 transition-all text-center"
        >
          View full archive
        </a>

        {/* Close Button */}
        <button onClick={onClose} className="btn-secondary w-full">
          Close
        </button>
      </div>
    </div>
  );
}

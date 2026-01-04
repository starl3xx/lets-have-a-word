// pages/archive/index.tsx
// Milestone 5.4, Updated Milestone 6.3, Milestone 7.x: Public Round Archive Page
// Restyled to match RoundArchiveModal with Söhne font
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Head from 'next/head';

interface ArchivedRound {
  id: number;
  roundNumber: number;
  targetWord: string;
  finalJackpotEth: string;
  totalGuesses: number;
  uniquePlayers: number;
  winnerFid: number | null;
  winnerUsername: string | null;
  startTime: string;
  endTime: string;
}

interface ArchiveStats {
  totalRounds: number;
  totalGuessesAllTime: number;
  uniqueWinners: number;
  totalJackpotDistributed: string;
  avgGuessesPerRound: number;
  avgPlayersPerRound: number;
  avgRoundLengthMinutes: number;
}

// Söhne font family
const FONT_FAMILY = "'Söhne', 'SF Pro Display', system-ui, -apple-system, sans-serif";

export default function ArchiveListPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rounds, setRounds] = useState<ArchivedRound[]>([]);
  const [stats, setStats] = useState<ArchiveStats | null>(null);
  const [totalRounds, setTotalRounds] = useState(0);
  const [page, setPage] = useState(0);
  const pageSize = 20;

  const fetchRounds = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/archive/list?stats=true&limit=${pageSize}&offset=${page * pageSize}`
      );
      if (!response.ok) throw new Error('Failed to load archive');
      const data = await response.json();
      setRounds(data.rounds);
      setTotalRounds(data.total);
      if (data.stats) setStats(data.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load archive');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchRounds();
  }, [fetchRounds]);

  const formatEth = (eth: string) => parseFloat(eth).toFixed(4);

  const formatDuration = (startTime: string, endTime: string) => {
    const start = new Date(startTime);
    const end = new Date(endTime);
    const durationMs = end.getTime() - start.getTime();
    const hours = Math.floor(durationMs / (1000 * 60 * 60));
    const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  };

  const totalPages = Math.ceil(totalRounds / pageSize);
  const isFirstPage = page === 0;
  const isLastPage = (page + 1) * pageSize >= totalRounds;

  return (
    <>
      <Head>
        <title>Round archive | Let's Have A Word</title>
        <meta name="description" content="Browse historical rounds from Let's Have A Word" />
      </Head>

      <main
        className="min-h-screen bg-gray-50"
        style={{ fontFamily: FONT_FAMILY }}
      >
        {/* Header */}
        <div className="bg-white border-b border-gray-200">
          <div className="max-w-2xl mx-auto px-4 py-6">
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 transition-colors mb-4"
            >
              ← Back to game
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">
              Round archive
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Browse completed rounds and their statistics
            </p>
          </div>
        </div>

        {/* Stats */}
        {stats && (
          <div className="bg-white border-b border-gray-200">
            <div className="max-w-2xl mx-auto px-4 py-4">
              <div className="flex flex-wrap gap-2">
                <StatChip label="rounds" value={stats.totalRounds.toLocaleString()} />
                <StatChip label="guesses" value={stats.totalGuessesAllTime.toLocaleString()} />
                <StatChip label="winners" value={stats.uniqueWinners.toLocaleString()} />
                <StatChip
                  label="ETH distributed"
                  value={formatEth(stats.totalJackpotDistributed)}
                  highlight
                />
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="max-w-2xl mx-auto px-4 py-6">
          {/* Section Label */}
          <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-3">
            All completed rounds
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 text-red-600 text-sm">
              {error}
            </div>
          )}

          {/* Rounds List Card */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            {loading ? (
              <div className="text-center text-gray-500 py-12">
                <div className="w-8 h-8 border-2 border-gray-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
                Loading archive...
              </div>
            ) : rounds.length === 0 ? (
              <div className="text-center text-gray-400 py-12">
                <div className="text-2xl mb-2">📭</div>
                No archived rounds yet
              </div>
            ) : (
              <>
                {rounds.map((round, index) => (
                  <Link
                    key={round.roundNumber}
                    href={`/archive/${round.roundNumber}`}
                    className="block"
                  >
                    <div
                      className={`px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors cursor-pointer ${
                        index < rounds.length - 1 ? 'border-b border-gray-100' : ''
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-3">
                          <span className="font-semibold text-gray-900">
                            Round #{round.roundNumber}
                          </span>
                          <span className="font-mono text-sm text-blue-600 font-bold tracking-widest uppercase">
                            {round.targetWord}
                          </span>
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          {round.totalGuesses} guesses · {round.uniquePlayers} players · {formatDuration(round.startTime, round.endTime)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 pl-3">
                        <div className="text-right">
                          <div className="font-bold text-green-600 text-sm">
                            {formatEth(round.finalJackpotEth)} ETH
                          </div>
                          <div className="text-xs text-gray-400">
                            {round.winnerUsername ? `@${round.winnerUsername}` : 'No winner'}
                          </div>
                        </div>
                        <span className="text-gray-300 text-lg">›</span>
                      </div>
                    </div>
                  </Link>
                ))}

                {/* Pagination */}
                {totalRounds > pageSize && (
                  <div className="px-4 py-3 flex items-center justify-center gap-3 border-t border-gray-100 bg-gray-50">
                    <button
                      onClick={() => setPage(p => Math.max(0, p - 1))}
                      disabled={isFirstPage}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        isFirstPage
                          ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                          : 'bg-blue-500 text-white hover:bg-blue-600'
                      }`}
                    >
                      ← Previous
                    </button>
                    <span className="text-sm text-gray-500">
                      Page {page + 1} of {totalPages}
                    </span>
                    <button
                      onClick={() => setPage(p => p + 1)}
                      disabled={isLastPage}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        isLastPage
                          ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                          : 'bg-blue-500 text-white hover:bg-blue-600'
                      }`}
                    >
                      Next →
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </main>
    </>
  );
}

/**
 * StatChip - Compact stat display matching RoundArchiveModal style
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

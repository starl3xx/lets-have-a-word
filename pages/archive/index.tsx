// pages/archive/index.tsx
// Milestone 5.4: Public Round Archive Page
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

  return (
    <>
      <Head>
        <title>Round Archive | Let's Have A Word</title>
        <meta name="description" content="Browse historical rounds from Let's Have A Word" />
      </Head>

      <main style={{
        minHeight: '100vh',
        background: 'linear-gradient(180deg, #1a1a2e 0%, #16213e 100%)',
        color: 'white',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
      }}>
        {/* Header */}
        <header style={{
          padding: '24px',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
        }}>
          <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <Link
              href="/"
              style={{
                color: '#a78bfa',
                textDecoration: 'none',
                fontSize: '14px',
                display: 'inline-block',
                marginBottom: '8px',
              }}
            >
              Back to Game
            </Link>
            <h1 style={{
              margin: 0,
              fontSize: '28px',
              fontWeight: 700,
            }}>
              Round Archive
            </h1>
            <p style={{
              margin: '8px 0 0 0',
              fontSize: '14px',
              color: 'rgba(255,255,255,0.6)',
            }}>
              Browse completed rounds and their statistics
            </p>
          </div>
        </header>

        {/* Content */}
        <div style={{ maxWidth: '800px', margin: '0 auto', padding: '24px' }}>
          {/* Stats Summary */}
          {stats && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: '12px',
              marginBottom: '24px',
            }}>
              <StatCard label="Total Rounds" value={stats.totalRounds.toLocaleString()} />
              <StatCard label="Total Guesses" value={stats.totalGuessesAllTime.toLocaleString()} />
              <StatCard label="Unique Winners" value={stats.uniqueWinners.toLocaleString()} />
              <StatCard
                label="Total Jackpot"
                value={`${formatEth(stats.totalJackpotDistributed)} ETH`}
              />
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{
              background: 'rgba(239, 68, 68, 0.2)',
              border: '1px solid rgba(239, 68, 68, 0.5)',
              borderRadius: '8px',
              padding: '16px',
              marginBottom: '24px',
              color: '#fca5a5',
            }}>
              {error}
            </div>
          )}

          {/* Rounds List */}
          <div style={{
            background: 'rgba(255,255,255,0.05)',
            borderRadius: '12px',
            overflow: 'hidden',
          }}>
            {loading ? (
              <div style={{ padding: '48px', textAlign: 'center', color: 'rgba(255,255,255,0.5)' }}>
                Loading...
              </div>
            ) : rounds.length === 0 ? (
              <div style={{ padding: '48px', textAlign: 'center', color: 'rgba(255,255,255,0.5)' }}>
                No archived rounds yet
              </div>
            ) : (
              <>
                {rounds.map((round) => (
                  <Link
                    key={round.roundNumber}
                    href={`/archive/${round.roundNumber}`}
                    style={{ textDecoration: 'none', color: 'inherit' }}
                  >
                    <div style={{
                      padding: '16px 20px',
                      borderBottom: '1px solid rgba(255,255,255,0.1)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      cursor: 'pointer',
                      transition: 'background 0.2s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <span style={{
                            fontWeight: 600,
                            fontSize: '16px',
                          }}>
                            Round #{round.roundNumber}
                          </span>
                          <span style={{
                            fontFamily: 'monospace',
                            fontSize: '14px',
                            color: '#a78bfa',
                            letterSpacing: '2px',
                          }}>
                            {round.targetWord}
                          </span>
                        </div>
                        <div style={{
                          fontSize: '13px',
                          color: 'rgba(255,255,255,0.5)',
                          marginTop: '4px',
                        }}>
                          {round.totalGuesses} guesses, {round.uniquePlayers} players, {formatDuration(round.startTime, round.endTime)}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 600, color: '#34d399' }}>
                          {formatEth(round.finalJackpotEth)} ETH
                        </div>
                        <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
                          {round.winnerFid ? `Winner: FID ${round.winnerFid}` : 'No winner'}
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}

                {/* Pagination */}
                {totalRounds > pageSize && (
                  <div style={{
                    padding: '16px',
                    display: 'flex',
                    justifyContent: 'center',
                    gap: '8px',
                  }}>
                    <button
                      onClick={() => setPage(p => Math.max(0, p - 1))}
                      disabled={page === 0}
                      style={{
                        padding: '8px 16px',
                        background: page === 0 ? 'rgba(255,255,255,0.1)' : '#8b5cf6',
                        color: page === 0 ? 'rgba(255,255,255,0.3)' : 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: page === 0 ? 'not-allowed' : 'pointer',
                        fontSize: '14px',
                      }}
                    >
                      Previous
                    </button>
                    <span style={{
                      padding: '8px 16px',
                      color: 'rgba(255,255,255,0.6)',
                      fontSize: '14px',
                    }}>
                      Page {page + 1} of {Math.ceil(totalRounds / pageSize)}
                    </span>
                    <button
                      onClick={() => setPage(p => p + 1)}
                      disabled={(page + 1) * pageSize >= totalRounds}
                      style={{
                        padding: '8px 16px',
                        background: (page + 1) * pageSize >= totalRounds ? 'rgba(255,255,255,0.1)' : '#8b5cf6',
                        color: (page + 1) * pageSize >= totalRounds ? 'rgba(255,255,255,0.3)' : 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: (page + 1) * pageSize >= totalRounds ? 'not-allowed' : 'pointer',
                        fontSize: '14px',
                      }}
                    >
                      Next
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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.05)',
      borderRadius: '8px',
      padding: '16px',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: '20px', fontWeight: 600, color: '#a78bfa' }}>
        {value}
      </div>
      <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginTop: '4px' }}>
        {label}
      </div>
    </div>
  );
}

// pages/archive/index.tsx
// Milestone 5.4, Updated Milestone 6.3: Public Round Archive Page
// Restyled to match blue theme with three-zone structure
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

// Color palette - Blue theme (matching RoundArchiveModal)
const COLORS = {
  blueMain: '#2D68C7',
  blueDark: '#1F4DA0',
  blueLight: '#EEF3FF',
  purpleAccent: '#5C3ED6',
  textPrimary: '#0F172A',
  textMuted: '#6B7280',
  borderSoft: '#D2D7E5',
  success: '#16a34a',
  successBg: '#f0fdf4',
  white: '#FFFFFF',
};

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
        background: COLORS.blueLight,
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
      }}>
        {/* Header - Blue Gradient Band */}
        <header style={{
          background: `linear-gradient(135deg, ${COLORS.blueDark} 0%, ${COLORS.blueMain} 100%)`,
          padding: '24px',
        }}>
          <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <Link
              href="/"
              style={{
                color: 'rgba(255,255,255,0.7)',
                textDecoration: 'none',
                fontSize: '14px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                marginBottom: '12px',
                fontWeight: 500,
                transition: 'color 0.15s ease',
              }}
              onMouseEnter={(e) => e.currentTarget.style.color = COLORS.white}
              onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.7)'}
            >
              ← Back to game
            </Link>
            <h1 style={{
              margin: 0,
              fontSize: '28px',
              fontWeight: 700,
              color: COLORS.white,
              letterSpacing: '-0.02em',
            }}>
              LHAW Archive
            </h1>
            <p style={{
              margin: '8px 0 0 0',
              fontSize: '15px',
              color: 'rgba(255,255,255,0.7)',
              fontWeight: 500,
            }}>
              Browse completed rounds and their statistics
            </p>
          </div>
        </header>

        {/* Stats Zone - Light Blue Background with White Cards */}
        {stats && (
          <div style={{
            background: COLORS.blueLight,
            padding: '24px',
            borderBottom: `1px solid ${COLORS.borderSoft}`,
          }}>
            <div style={{
              maxWidth: '800px',
              margin: '0 auto',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: '12px',
            }}>
              <StatCard label="Total rounds" value={stats.totalRounds.toLocaleString()} />
              <StatCard label="Total guesses" value={stats.totalGuessesAllTime.toLocaleString()} />
              <StatCard label="Unique winners" value={stats.uniqueWinners.toLocaleString()} />
              <StatCard
                label="Jackpot distributed"
                value={`${formatEth(stats.totalJackpotDistributed)} ETH`}
                highlight
              />
            </div>
          </div>
        )}

        {/* Content Zone - White Background */}
        <div style={{
          background: COLORS.white,
          minHeight: 'calc(100vh - 300px)',
        }}>
          <div style={{ maxWidth: '800px', margin: '0 auto', padding: '24px' }}>
            {/* Section Label */}
            <div style={{
              fontSize: '11px',
              color: COLORS.textMuted,
              marginBottom: '16px',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              fontWeight: 600,
            }}>
              All completed rounds
            </div>

            {/* Error */}
            {error && (
              <div style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '12px',
                padding: '16px',
                marginBottom: '24px',
                color: '#dc2626',
                fontSize: '15px',
              }}>
                {error}
              </div>
            )}

            {/* Rounds list */}
            <div style={{
              background: COLORS.white,
              borderRadius: '12px',
              border: `1px solid ${COLORS.borderSoft}`,
              overflow: 'hidden',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
            }}>
              {loading ? (
                <div style={{
                  padding: '48px',
                  textAlign: 'center',
                  color: COLORS.textMuted,
                  fontSize: '15px',
                }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    border: `3px solid ${COLORS.blueLight}`,
                    borderTopColor: COLORS.blueMain,
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                    margin: '0 auto 12px',
                  }} />
                  Loading archive...
                  <style>{`
                    @keyframes spin {
                      to { transform: rotate(360deg); }
                    }
                  `}</style>
                </div>
              ) : rounds.length === 0 ? (
                <div style={{
                  padding: '48px',
                  textAlign: 'center',
                  color: COLORS.textMuted,
                }}>
                  <div style={{ fontSize: '24px', marginBottom: '8px' }}>📭</div>
                  No archived rounds yet
                </div>
              ) : (
                <>
                  {rounds.map((round, index) => (
                    <Link
                      key={round.roundNumber}
                      href={`/archive/${round.roundNumber}`}
                      style={{ textDecoration: 'none', color: 'inherit' }}
                    >
                      <div
                        style={{
                          padding: '16px 20px',
                          borderBottom: index < rounds.length - 1 ? `1px solid ${COLORS.borderSoft}` : 'none',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          cursor: 'pointer',
                          transition: 'background 0.15s ease',
                          background: COLORS.white,
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = COLORS.blueLight}
                        onMouseLeave={(e) => e.currentTarget.style.background = COLORS.white}
                      >
                        <div>
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                          }}>
                            <span style={{
                              fontWeight: 600,
                              fontSize: '15px',
                              color: COLORS.textPrimary,
                            }}>
                              Round #{round.roundNumber}
                            </span>
                            <span style={{
                              fontFamily: 'monospace',
                              fontSize: '14px',
                              color: COLORS.blueMain,
                              letterSpacing: '2px',
                              fontWeight: 700,
                              textTransform: 'uppercase',
                            }}>
                              {round.targetWord}
                            </span>
                          </div>
                          <div style={{
                            fontSize: '13px',
                            color: COLORS.textMuted,
                            marginTop: '4px',
                          }}>
                            {round.totalGuesses} guesses · {round.uniquePlayers} players · {formatDuration(round.startTime, round.endTime)}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div>
                            <div style={{ fontWeight: 700, color: COLORS.success, fontSize: '15px' }}>
                              {formatEth(round.finalJackpotEth)} ETH
                            </div>
                            <div style={{ fontSize: '12px', color: COLORS.textMuted }}>
                              {round.winnerFid ? `FID ${round.winnerFid}` : 'No winner'}
                            </div>
                          </div>
                          <span style={{ color: COLORS.textMuted, fontSize: '18px' }}>›</span>
                        </div>
                      </div>
                    </Link>
                  ))}

                  {/* Pagination */}
                  {totalRounds > pageSize && (
                    <div style={{
                      padding: '16px 20px',
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      gap: '12px',
                      borderTop: `1px solid ${COLORS.borderSoft}`,
                      background: COLORS.blueLight,
                    }}>
                      <button
                        onClick={() => setPage(p => Math.max(0, p - 1))}
                        disabled={page === 0}
                        style={{
                          padding: '10px 20px',
                          background: page === 0 ? COLORS.borderSoft : COLORS.blueMain,
                          color: page === 0 ? COLORS.textMuted : COLORS.white,
                          border: 'none',
                          borderRadius: '8px',
                          cursor: page === 0 ? 'not-allowed' : 'pointer',
                          fontSize: '14px',
                          fontWeight: 600,
                          transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={(e) => {
                          if (page !== 0) e.currentTarget.style.background = COLORS.blueDark;
                        }}
                        onMouseLeave={(e) => {
                          if (page !== 0) e.currentTarget.style.background = COLORS.blueMain;
                        }}
                      >
                        ← Previous
                      </button>
                      <span style={{
                        padding: '8px 16px',
                        color: COLORS.textMuted,
                        fontSize: '14px',
                        fontWeight: 500,
                      }}>
                        Page {page + 1} of {Math.ceil(totalRounds / pageSize)}
                      </span>
                      <button
                        onClick={() => setPage(p => p + 1)}
                        disabled={(page + 1) * pageSize >= totalRounds}
                        style={{
                          padding: '10px 20px',
                          background: (page + 1) * pageSize >= totalRounds ? COLORS.borderSoft : COLORS.blueMain,
                          color: (page + 1) * pageSize >= totalRounds ? COLORS.textMuted : COLORS.white,
                          border: 'none',
                          borderRadius: '8px',
                          cursor: (page + 1) * pageSize >= totalRounds ? 'not-allowed' : 'pointer',
                          fontSize: '14px',
                          fontWeight: 600,
                          transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={(e) => {
                          if (!((page + 1) * pageSize >= totalRounds)) e.currentTarget.style.background = COLORS.blueDark;
                        }}
                        onMouseLeave={(e) => {
                          if (!((page + 1) * pageSize >= totalRounds)) e.currentTarget.style.background = COLORS.blueMain;
                        }}
                      >
                        Next →
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </main>
    </>
  );
}

function StatCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{
      background: COLORS.white,
      borderRadius: '12px',
      padding: '16px',
      textAlign: 'center',
      border: `1px solid ${COLORS.borderSoft}`,
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
    }}>
      <div style={{
        fontSize: '20px',
        fontWeight: 700,
        color: highlight ? COLORS.success : COLORS.textPrimary,
        marginBottom: '4px',
      }}>
        {value}
      </div>
      <div style={{
        fontSize: '12px',
        color: COLORS.textMuted,
        fontWeight: 500,
      }}>
        {label}
      </div>
    </div>
  );
}

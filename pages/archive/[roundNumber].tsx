// pages/archive/[roundNumber].tsx
// Milestone 5.4, Updated Milestone 6.3: Public Round Detail Page
// Restyled to match blue theme with three-zone structure
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Head from 'next/head';

interface ArchivedRound {
  id: number;
  roundNumber: number;
  targetWord: string;
  seedEth: string;
  finalJackpotEth: string;
  totalGuesses: number;
  uniquePlayers: number;
  winnerFid: number | null;
  winnerCastHash: string | null;
  winnerGuessNumber: number | null;
  startTime: string;
  endTime: string;
  referrerFid: number | null;
  payoutsJson: {
    winner?: { fid: number; amountEth: string };
    referrer?: { fid: number; amountEth: string };
    topGuessers: Array<{ fid: number; amountEth: string; rank: number }>;
    seed?: { amountEth: string };
    creator?: { amountEth: string };
  };
  salt: string;
  clanktonBonusCount: number;
  referralBonusCount: number;
}

interface Distribution {
  distribution: Array<{ hour: number; count: number }>;
  byPlayer: Array<{ fid: number; count: number }>;
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
  warning: '#f59e0b',
  white: '#FFFFFF',
};

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

  return (
    <>
      <Head>
        <title>
          {round ? `Round #${round.roundNumber} - ${round.targetWord}` : 'Round Detail'} | Let's Have A Word
        </title>
        <meta
          name="description"
          content={round ? `Round #${round.roundNumber} archive - ${round.targetWord}` : 'Round archive detail'}
        />
      </Head>

      <main style={{
        minHeight: '100vh',
        background: COLORS.blueLight,
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
      }}>
        {/* Header - Solid Blue Band */}
        <header style={{
          background: COLORS.blueMain,
          padding: '24px',
        }}>
          <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <Link
              href="/archive"
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
              ← Back to archive
            </Link>
            <h1 style={{
              margin: 0,
              fontSize: '28px',
              fontWeight: 700,
              color: COLORS.white,
              letterSpacing: '-0.02em',
            }}>
              {loading ? 'Loading...' : round ? `Round #${round.roundNumber}` : 'Round not found'}
            </h1>
          </div>
        </header>

        {/* Word Display Zone - Light Blue Background */}
        {!loading && round && (
          <div style={{
            background: COLORS.blueLight,
            padding: '32px 24px',
            textAlign: 'center',
            borderBottom: `1px solid ${COLORS.borderSoft}`,
          }}>
            <div style={{
              fontFamily: 'monospace',
              fontSize: '48px',
              fontWeight: 800,
              letterSpacing: '10px',
              color: COLORS.blueMain,
              marginBottom: '8px',
              textTransform: 'uppercase',
            }}>
              {round.targetWord}
            </div>
            <div style={{
              color: COLORS.textMuted,
              fontSize: '13px',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              fontWeight: 500,
            }}>
              The secret word
            </div>
          </div>
        )}

        {/* Stats Zone */}
        {!loading && round && (
          <div style={{
            background: COLORS.blueLight,
            padding: '0 24px 24px',
          }}>
            <div style={{
              maxWidth: '800px',
              margin: '0 auto',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: '12px',
            }}>
              <StatCard label="Jackpot" value={`${formatEth(round.finalJackpotEth)} ETH`} highlight />
              <StatCard label="Total guesses" value={round.totalGuesses.toLocaleString()} />
              <StatCard label="Players" value={round.uniquePlayers.toLocaleString()} />
              <StatCard label="Duration" value={formatDuration(round.startTime, round.endTime)} />
            </div>
          </div>
        )}

        {/* Content Zone - White Background */}
        <div style={{
          background: COLORS.white,
          minHeight: 'calc(100vh - 400px)',
        }}>
          <div style={{ maxWidth: '800px', margin: '0 auto', padding: '24px' }}>
            {/* Error */}
            {error && (
              <div style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '12px',
                padding: '16px',
                marginBottom: '24px',
                color: '#dc2626',
                textAlign: 'center',
              }}>
                {error}
                <Link
                  href="/archive"
                  style={{
                    display: 'block',
                    marginTop: '12px',
                    color: COLORS.blueMain,
                    fontWeight: 500,
                  }}
                >
                  ← Browse all rounds
                </Link>
              </div>
            )}

            {loading ? (
              <div style={{
                textAlign: 'center',
                padding: '48px',
                color: COLORS.textMuted,
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
                Loading round details...
                <style>{`
                  @keyframes spin {
                    to { transform: rotate(360deg); }
                  }
                `}</style>
              </div>
            ) : round && (
              <>
                {/* Winner section */}
                <Section title="Winner">
                  {round.winnerFid ? (
                    <div style={{
                      background: COLORS.successBg,
                      border: `1px solid ${COLORS.success}20`,
                      borderRadius: '12px',
                      padding: '16px',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: '18px', fontWeight: 600, color: COLORS.textPrimary }}>
                            FID {round.winnerFid}
                          </div>
                          {round.winnerGuessNumber && (
                            <div style={{ fontSize: '13px', color: COLORS.textMuted, marginTop: '4px' }}>
                              Won on guess #{round.winnerGuessNumber}
                            </div>
                          )}
                        </div>
                        {round.payoutsJson.winner && (
                          <div style={{
                            fontSize: '20px',
                            fontWeight: 700,
                            color: COLORS.success,
                          }}>
                            {formatEth(round.payoutsJson.winner.amountEth)} ETH
                          </div>
                        )}
                      </div>
                      {round.referrerFid && (
                        <div style={{
                          marginTop: '12px',
                          paddingTop: '12px',
                          borderTop: `1px solid ${COLORS.success}20`,
                          fontSize: '13px',
                          color: COLORS.textMuted,
                        }}>
                          Referred by FID {round.referrerFid}
                          {round.payoutsJson.referrer && (
                            <span style={{ color: COLORS.success }}> (earned {formatEth(round.payoutsJson.referrer.amountEth)} ETH)</span>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{
                      background: COLORS.blueLight,
                      border: `2px dashed ${COLORS.borderSoft}`,
                      borderRadius: '12px',
                      padding: '24px',
                      textAlign: 'center',
                      color: COLORS.textMuted,
                    }}>
                      No winner recorded
                    </div>
                  )}
                </Section>

                {/* Top guessers */}
                {round.payoutsJson.topGuessers.length > 0 && (
                  <Section title="Top guessers">
                    <div style={{
                      background: COLORS.white,
                      border: `1px solid ${COLORS.borderSoft}`,
                      borderRadius: '12px',
                      overflow: 'hidden',
                      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
                    }}>
                      {round.payoutsJson.topGuessers.map((guesser, index) => (
                        <div
                          key={guesser.fid}
                          style={{
                            padding: '12px 16px',
                            borderBottom: index < round.payoutsJson.topGuessers.length - 1 ? `1px solid ${COLORS.borderSoft}` : 'none',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            background: COLORS.white,
                          }}
                        >
                          <div style={{ color: COLORS.textPrimary }}>
                            <span style={{ color: COLORS.textMuted, marginRight: '8px', fontWeight: 500 }}>
                              #{guesser.rank}
                            </span>
                            FID {guesser.fid}
                          </div>
                          <div style={{ color: COLORS.warning, fontWeight: 600 }}>
                            {formatEth(guesser.amountEth)} ETH
                          </div>
                        </div>
                      ))}
                    </div>
                  </Section>
                )}

                {/* Guess distribution histogram */}
                {distribution && distribution.distribution.length > 0 && (
                  <Section title="Guess distribution by hour">
                    <div style={{
                      background: COLORS.white,
                      border: `1px solid ${COLORS.borderSoft}`,
                      borderRadius: '12px',
                      padding: '20px',
                      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '120px' }}>
                        {Array.from({ length: 24 }, (_, hour) => {
                          const data = distribution.distribution.find(d => d.hour === hour);
                          const count = data?.count || 0;
                          const height = maxGuesses > 0 ? (count / maxGuesses) * 100 : 0;
                          return (
                            <div
                              key={hour}
                              style={{
                                flex: 1,
                                background: count > 0 ? COLORS.blueMain : COLORS.blueLight,
                                height: `${Math.max(height, 2)}%`,
                                borderRadius: '2px 2px 0 0',
                                position: 'relative',
                                transition: 'background 0.15s ease',
                              }}
                              title={`${hour}:00 - ${count} guesses`}
                            />
                          );
                        })}
                      </div>
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginTop: '8px',
                        fontSize: '11px',
                        color: COLORS.textMuted,
                      }}>
                        <span>0:00</span>
                        <span>6:00</span>
                        <span>12:00</span>
                        <span>18:00</span>
                        <span>23:00</span>
                      </div>
                    </div>
                  </Section>
                )}

                {/* Round info */}
                <Section title="Round details">
                  <div style={{
                    background: COLORS.white,
                    border: `1px solid ${COLORS.borderSoft}`,
                    borderRadius: '12px',
                    padding: '4px 16px',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
                  }}>
                    <InfoRow label="Started" value={formatDate(round.startTime)} />
                    <InfoRow label="Ended" value={formatDate(round.endTime)} />
                    <InfoRow label="Seed ETH" value={`${formatEth(round.seedEth)} ETH`} />
                    <InfoRow label="CLANKTON bonuses" value={round.clanktonBonusCount.toString()} />
                    <InfoRow label="Referral signups" value={round.referralBonusCount.toString()} isLast />
                  </div>
                </Section>

                {/* Commit-reveal verification */}
                <Section title="Verification (commit-reveal)">
                  <div style={{
                    background: COLORS.blueLight,
                    border: `1px solid ${COLORS.borderSoft}`,
                    borderRadius: '12px',
                    padding: '16px',
                    fontSize: '13px',
                  }}>
                    <div style={{ marginBottom: '12px' }}>
                      <div style={{ color: COLORS.textMuted, marginBottom: '6px', fontWeight: 500 }}>Salt</div>
                      <div style={{
                        fontFamily: 'monospace',
                        wordBreak: 'break-all',
                        background: COLORS.white,
                        border: `1px solid ${COLORS.borderSoft}`,
                        padding: '10px 12px',
                        borderRadius: '8px',
                        color: COLORS.textPrimary,
                        fontSize: '12px',
                      }}>
                        {round.salt}
                      </div>
                    </div>
                    <div style={{ color: COLORS.textMuted, fontSize: '12px' }}>
                      Verify: SHA256(salt + word) should match the commit hash published at round start
                    </div>
                  </div>
                </Section>
              </>
            )}
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '24px' }}>
      <h2 style={{
        fontSize: '11px',
        fontWeight: 600,
        marginBottom: '12px',
        color: COLORS.textMuted,
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
      }}>
        {title}
      </h2>
      {children}
    </div>
  );
}

function InfoRow({ label, value, isLast }: { label: string; value: string; isLast?: boolean }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      padding: '12px 0',
      borderBottom: isLast ? 'none' : `1px solid ${COLORS.borderSoft}`,
    }}>
      <span style={{ color: COLORS.textMuted }}>{label}</span>
      <span style={{ color: COLORS.textPrimary, fontWeight: 500 }}>{value}</span>
    </div>
  );
}

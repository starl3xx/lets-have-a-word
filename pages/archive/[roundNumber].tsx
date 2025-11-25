// pages/archive/[roundNumber].tsx
// Milestone 5.4: Public Round Detail Page
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
        background: '#2D68C7',
        color: 'white',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
      }}>
        {/* Header */}
        <header style={{
          padding: '24px',
          borderBottom: '1px solid rgba(255,255,255,0.2)',
        }}>
          <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <Link
              href="/archive"
              style={{
                color: '#3A2E8A',
                textDecoration: 'none',
                fontSize: '14px',
                display: 'inline-block',
                marginBottom: '8px',
              }}
            >
              ← Back to archive
            </Link>
            <h1 style={{
              margin: 0,
              fontSize: '28px',
              fontWeight: 700,
            }}>
              {loading ? 'Loading...' : round ? `Round #${round.roundNumber}` : 'Round not found'}
            </h1>
          </div>
        </header>

        {/* Content */}
        <div style={{ maxWidth: '800px', margin: '0 auto', padding: '24px' }}>
          {/* Error */}
          {error && (
            <div style={{
              background: 'rgba(239, 68, 68, 0.2)',
              border: '1px solid rgba(239, 68, 68, 0.5)',
              borderRadius: '8px',
              padding: '16px',
              marginBottom: '24px',
              color: '#fca5a5',
              textAlign: 'center',
            }}>
              {error}
              <Link
                href="/archive"
                style={{
                  display: 'block',
                  marginTop: '12px',
                  color: 'rgba(255,255,255,0.8)',
                }}
              >
                ← Browse all rounds
              </Link>
            </div>
          )}

          {loading ? (
            <div style={{ textAlign: 'center', padding: '48px', color: 'rgba(255,255,255,0.5)' }}>
              Loading...
            </div>
          ) : round && (
            <>
              {/* Word Display */}
              <div style={{
                textAlign: 'center',
                marginBottom: '32px',
              }}>
                <div style={{
                  fontFamily: 'monospace',
                  fontSize: '48px',
                  fontWeight: 700,
                  letterSpacing: '8px',
                  color: '#3A2E8A',
                  marginBottom: '8px',
                }}>
                  {round.targetWord}
                </div>
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '14px' }}>
                  The secret word
                </div>
              </div>

              {/* Stats Grid */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: '12px',
                marginBottom: '24px',
              }}>
                <StatCard label="Jackpot" value={`${formatEth(round.finalJackpotEth)} ETH`} highlight />
                <StatCard label="Total guesses" value={round.totalGuesses.toLocaleString()} />
                <StatCard label="Players" value={round.uniquePlayers.toLocaleString()} />
                <StatCard label="Duration" value={formatDuration(round.startTime, round.endTime)} />
              </div>

              {/* Winner section */}
              <Section title="Winner">
                {round.winnerFid ? (
                  <div style={{
                    background: 'rgba(52, 211, 153, 0.1)',
                    borderRadius: '8px',
                    padding: '16px',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '18px', fontWeight: 600 }}>
                          FID {round.winnerFid}
                        </div>
                        {round.winnerGuessNumber && (
                          <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)', marginTop: '4px' }}>
                            Won on guess #{round.winnerGuessNumber}
                          </div>
                        )}
                      </div>
                      {round.payoutsJson.winner && (
                        <div style={{
                          fontSize: '20px',
                          fontWeight: 700,
                          color: '#34d399',
                        }}>
                          {formatEth(round.payoutsJson.winner.amountEth)} ETH
                        </div>
                      )}
                    </div>
                    {round.referrerFid && (
                      <div style={{
                        marginTop: '12px',
                        paddingTop: '12px',
                        borderTop: '1px solid rgba(255,255,255,0.1)',
                        fontSize: '13px',
                        color: 'rgba(255,255,255,0.6)',
                      }}>
                        Referred by FID {round.referrerFid}
                        {round.payoutsJson.referrer && (
                          <span> (earned {formatEth(round.payoutsJson.referrer.amountEth)} ETH)</span>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{
                    background: 'rgba(255,255,255,0.1)',
                    borderRadius: '8px',
                    padding: '16px',
                    textAlign: 'center',
                    color: 'rgba(255,255,255,0.5)',
                  }}>
                    No winner recorded
                  </div>
                )}
              </Section>

              {/* Top guessers */}
              {round.payoutsJson.topGuessers.length > 0 && (
                <Section title="Top guessers">
                  <div style={{
                    background: 'rgba(255,255,255,0.1)',
                    borderRadius: '8px',
                    overflow: 'hidden',
                  }}>
                    {round.payoutsJson.topGuessers.map((guesser) => (
                      <div
                        key={guesser.fid}
                        style={{
                          padding: '12px 16px',
                          borderBottom: '1px solid rgba(255,255,255,0.05)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <div>
                          <span style={{ color: 'rgba(255,255,255,0.5)', marginRight: '8px' }}>
                            #{guesser.rank}
                          </span>
                          FID {guesser.fid}
                        </div>
                        <div style={{ color: '#f59e0b' }}>
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
                    background: 'rgba(255,255,255,0.1)',
                    borderRadius: '8px',
                    padding: '16px',
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
                              background: count > 0 ? '#8b5cf6' : 'rgba(255,255,255,0.1)',
                              height: `${Math.max(height, 2)}%`,
                              borderRadius: '2px 2px 0 0',
                              position: 'relative',
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
                      color: 'rgba(255,255,255,0.4)',
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
                  background: 'rgba(255,255,255,0.1)',
                  borderRadius: '8px',
                  padding: '16px',
                }}>
                  <InfoRow label="Started" value={formatDate(round.startTime)} />
                  <InfoRow label="Ended" value={formatDate(round.endTime)} />
                  <InfoRow label="Seed ETH" value={`${formatEth(round.seedEth)} ETH`} />
                  <InfoRow label="CLANKTON Bonuses" value={round.clanktonBonusCount.toString()} />
                  <InfoRow label="Referral Signups" value={round.referralBonusCount.toString()} />
                </div>
              </Section>

              {/* Commit-reveal verification */}
              <Section title="Verification (commit-reveal)">
                <div style={{
                  background: 'rgba(255,255,255,0.1)',
                  borderRadius: '8px',
                  padding: '16px',
                  fontSize: '13px',
                }}>
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>Salt</div>
                    <div style={{
                      fontFamily: 'monospace',
                      wordBreak: 'break-all',
                      background: 'rgba(0,0,0,0.3)',
                      padding: '8px',
                      borderRadius: '4px',
                    }}>
                      {round.salt}
                    </div>
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px' }}>
                    Verify: SHA256(salt + word) should match the commit hash published at round start
                  </div>
                </div>
              </Section>
            </>
          )}
        </div>
      </main>
    </>
  );
}

function StatCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{
      background: highlight ? 'rgba(52, 211, 153, 0.1)' : 'rgba(255,255,255,0.1)',
      borderRadius: '8px',
      padding: '16px',
      textAlign: 'center',
    }}>
      <div style={{
        fontSize: '20px',
        fontWeight: 600,
        color: highlight ? '#34d399' : '#3A2E8A',
      }}>
        {value}
      </div>
      <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginTop: '4px' }}>
        {label}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '24px' }}>
      <h2 style={{
        fontSize: '16px',
        fontWeight: 600,
        marginBottom: '12px',
        color: 'rgba(255,255,255,0.8)',
      }}>
        {title}
      </h2>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      padding: '8px 0',
      borderBottom: '1px solid rgba(255,255,255,0.05)',
    }}>
      <span style={{ color: 'rgba(255,255,255,0.5)' }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

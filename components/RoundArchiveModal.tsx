import { useState, useEffect } from 'react';

interface ArchivedRound {
  id: number;
  roundNumber: number;
  targetWord: string;
  seedEth: string;
  finalJackpotEth: string;
  totalGuesses: number;
  uniquePlayers: number;
  winnerFid: number | null;
  winnerGuessNumber: number | null;
  startTime: string;
  endTime: string;
  payoutsJson: {
    winner?: { fid: number; amountEth: string };
    referrer?: { fid: number; amountEth: string };
    topGuessers: Array<{ fid: number; amountEth: string; rank: number }>;
  };
  salt: string;
}

interface ArchiveStats {
  totalRounds: number;
  totalGuessesAllTime: number;
  uniqueWinners: number;
  totalJackpotDistributed: string;
  avgGuessesPerRound: number;
  avgPlayersPerRound: number;
}

interface RoundArchiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentRoundId?: number;
}

/**
 * RoundArchiveModal Component
 * Milestone 5.4, Updated Milestone 6.3
 *
 * Three-zone structure:
 * 1. Header - strong blue gradient band
 * 2. Stats zone - light-blue background with white cards
 * 3. Content zone - white table area + footer CTA
 */

// Color palette - Blue theme
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

export default function RoundArchiveModal({ isOpen, onClose, currentRoundId }: RoundArchiveModalProps) {
  const [loading, setLoading] = useState(true);
  const [rounds, setRounds] = useState<ArchivedRound[]>([]);
  const [stats, setStats] = useState<ArchiveStats | null>(null);
  const [selectedRound, setSelectedRound] = useState<ArchivedRound | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsAnimating(true);
      fetchArchiveData();
    } else {
      setIsAnimating(false);
    }
  }, [isOpen]);

  const fetchArchiveData = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/archive/list?stats=true&limit=10');
      if (!response.ok) throw new Error('Failed to load archive');
      const data = await response.json();
      setRounds(data.rounds);
      setStats(data.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load archive');
    } finally {
      setLoading(false);
    }
  };

  const fetchRoundDetail = async (roundNumber: number) => {
    try {
      const response = await fetch(`/api/archive/${roundNumber}`);
      if (!response.ok) throw new Error('Round not found');
      const data = await response.json();
      setSelectedRound(data.round);
    } catch (err) {
      console.error('Failed to fetch round detail:', err);
    }
  };

  const formatEth = (eth: string) => parseFloat(eth).toFixed(4);

  const formatDuration = (startTime: string, endTime: string) => {
    const start = new Date(startTime);
    const end = new Date(endTime);
    const durationMs = end.getTime() - start.getTime();
    const hours = Math.floor(durationMs / (1000 * 60 * 60));
    const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '16px',
        opacity: isAnimating ? 1 : 0,
        transition: 'opacity 0.2s ease-out',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: COLORS.white,
          borderRadius: '20px',
          maxWidth: '500px',
          width: '100%',
          maxHeight: '85vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          transform: isAnimating ? 'scale(1)' : 'scale(0.95)',
          opacity: isAnimating ? 1 : 0,
          transition: 'transform 0.2s ease-out, opacity 0.2s ease-out',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header - Solid Blue Band */}
        <div
          style={{
            background: COLORS.blueMain,
            padding: '20px 24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <h2 style={{
              margin: 0,
              fontSize: '22px',
              fontWeight: 700,
              color: COLORS.white,
              letterSpacing: '-0.02em',
            }}>
              {selectedRound ? `Round #${selectedRound.roundNumber}` : 'LHAW Archive'}
            </h2>
            {currentRoundId && !selectedRound && (
              <p style={{
                margin: '4px 0 0 0',
                fontSize: '14px',
                color: 'rgba(255,255,255,0.7)',
                fontWeight: 500,
              }}>
                Current: Round #{currentRoundId}
              </p>
            )}
          </div>
          <button
            onClick={selectedRound ? () => setSelectedRound(null) : onClose}
            style={{
              background: 'transparent',
              border: '2px solid rgba(255,255,255,0.5)',
              borderRadius: '20px',
              padding: '8px 16px',
              color: COLORS.white,
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 600,
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = COLORS.white;
              e.currentTarget.style.color = COLORS.blueMain;
              e.currentTarget.style.borderColor = COLORS.white;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = COLORS.white;
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.5)';
            }}
          >
            {selectedRound ? '← Back' : 'Close'}
          </button>
        </div>

        {/* Stats Zone - Light Blue Background */}
        {!loading && !error && stats && !selectedRound && (
          <div style={{
            background: COLORS.blueLight,
            padding: '20px 24px',
          }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '12px',
              }}
            >
              <StatsCard label="Total rounds" value={stats.totalRounds.toLocaleString()} />
              <StatsCard label="Total guesses" value={stats.totalGuessesAllTime.toLocaleString()} />
              <StatsCard label="Unique winners" value={stats.uniqueWinners.toLocaleString()} />
              <StatsCard
                label="Jackpot distributed"
                value={`${formatEth(stats.totalJackpotDistributed)} ETH`}
                highlight
              />
            </div>
          </div>
        )}

        {/* Content Zone - White Background */}
        <div style={{
          padding: '20px 24px',
          overflowY: 'auto',
          flex: 1,
          background: COLORS.white,
        }}>
          {loading ? (
            <div style={{
              textAlign: 'center',
              color: COLORS.textMuted,
              padding: '40px',
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
          ) : error ? (
            <div style={{
              textAlign: 'center',
              color: '#dc2626',
              padding: '40px',
              background: '#fef2f2',
              borderRadius: '12px',
              fontSize: '15px',
            }}>
              {error}
            </div>
          ) : selectedRound ? (
            // Round Detail View
            <div>
              {/* Word display */}
              <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                <div
                  style={{
                    fontFamily: 'monospace',
                    fontSize: '40px',
                    fontWeight: 800,
                    letterSpacing: '8px',
                    color: COLORS.blueMain,
                    textTransform: 'uppercase',
                  }}
                >
                  {selectedRound.targetWord}
                </div>
                <div style={{
                  color: COLORS.textMuted,
                  fontSize: '13px',
                  marginTop: '8px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  fontWeight: 500,
                }}>
                  The secret word
                </div>
              </div>

              {/* Stats Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: '12px',
                  marginBottom: '20px',
                }}
              >
                <DetailStatBox label="Jackpot" value={`${formatEth(selectedRound.finalJackpotEth)} ETH`} highlight />
                <DetailStatBox label="Guesses" value={selectedRound.totalGuesses.toLocaleString()} />
                <DetailStatBox label="Players" value={selectedRound.uniquePlayers.toLocaleString()} />
                <DetailStatBox label="Duration" value={formatDuration(selectedRound.startTime, selectedRound.endTime)} />
              </div>

              {/* Winner */}
              {selectedRound.winnerFid && (
                <div
                  style={{
                    background: COLORS.successBg,
                    border: `1px solid ${COLORS.success}20`,
                    borderRadius: '12px',
                    padding: '16px',
                    marginBottom: '16px',
                  }}
                >
                  <div style={{
                    fontSize: '11px',
                    color: COLORS.success,
                    marginBottom: '6px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    fontWeight: 600,
                  }}>
                    🏆 Winner
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: COLORS.textPrimary, fontWeight: 600 }}>
                      FID {selectedRound.winnerFid}
                      {selectedRound.winnerGuessNumber && (
                        <span style={{ fontWeight: 400, color: COLORS.textMuted }}>
                          {' '}(guess #{selectedRound.winnerGuessNumber})
                        </span>
                      )}
                    </span>
                    {selectedRound.payoutsJson.winner && (
                      <span style={{ color: COLORS.success, fontWeight: 700, fontSize: '16px' }}>
                        {formatEth(selectedRound.payoutsJson.winner.amountEth)} ETH
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            // List View
            <div>
              {/* Section Label */}
              <div style={{
                fontSize: '11px',
                color: COLORS.textMuted,
                marginBottom: '12px',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                fontWeight: 600,
              }}>
                Recent completed rounds
              </div>

              {rounds.length === 0 ? (
                // Empty state with dashed border
                <div style={{
                  textAlign: 'center',
                  color: COLORS.textMuted,
                  padding: '32px',
                  border: `2px dashed ${COLORS.borderSoft}`,
                  borderRadius: '12px',
                  background: COLORS.white,
                }}>
                  <div style={{ fontSize: '24px', marginBottom: '8px' }}>📭</div>
                  No archived rounds yet
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                  {rounds.map((round, index) => (
                    <button
                      key={round.roundNumber}
                      onClick={() => fetchRoundDetail(round.roundNumber)}
                      style={{
                        background: COLORS.white,
                        border: 'none',
                        borderBottom: index < rounds.length - 1 ? `1px solid ${COLORS.borderSoft}` : 'none',
                        padding: '16px 0',
                        cursor: 'pointer',
                        textAlign: 'left',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        transition: 'background 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = COLORS.blueLight;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = COLORS.white;
                      }}
                    >
                      <div>
                        <div style={{
                          color: COLORS.textPrimary,
                          fontWeight: 600,
                          fontSize: '15px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                        }}>
                          <span>Round #{round.roundNumber}</span>
                          <span
                            style={{
                              fontFamily: 'monospace',
                              color: COLORS.blueMain,
                              letterSpacing: '2px',
                              fontWeight: 700,
                              fontSize: '14px',
                              textTransform: 'uppercase',
                            }}
                          >
                            {round.targetWord}
                          </span>
                        </div>
                        <div style={{
                          color: COLORS.textMuted,
                          fontSize: '13px',
                          marginTop: '4px'
                        }}>
                          {round.totalGuesses} guesses · {round.uniquePlayers} players
                        </div>
                      </div>
                      <div style={{
                        color: COLORS.success,
                        fontWeight: 700,
                        fontSize: '15px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}>
                        {formatEth(round.finalJackpotEth)} ETH
                        <span style={{ color: COLORS.textMuted, fontSize: '18px' }}>›</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* CTA Footer - White bar with blue button */}
        <div style={{
          padding: '16px 24px 20px',
          background: COLORS.white,
          borderTop: `1px solid ${COLORS.borderSoft}`,
        }}>
          <a
            href={selectedRound ? `/archive/${selectedRound.roundNumber}` : '/archive'}
            style={{
              display: 'block',
              textAlign: 'center',
              padding: '14px 24px',
              background: COLORS.blueMain,
              color: COLORS.white,
              borderRadius: '12px',
              textDecoration: 'none',
              fontSize: '15px',
              fontWeight: 600,
              transition: 'all 0.15s ease',
              boxShadow: '0 4px 12px rgba(45, 104, 199, 0.3)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = COLORS.blueDark;
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 6px 16px rgba(45, 104, 199, 0.4)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = COLORS.blueMain;
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(45, 104, 199, 0.3)';
            }}
          >
            {selectedRound ? 'View full details' : 'View all rounds'}
          </a>
        </div>
      </div>
    </div>
  );
}

// Stats card for the light-blue stats zone
function StatsCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      style={{
        background: COLORS.white,
        borderRadius: '12px',
        padding: '16px',
        textAlign: 'center',
        border: `1px solid ${COLORS.borderSoft}`,
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
      }}
    >
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

// Detail stat box for round detail view
function DetailStatBox({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      style={{
        background: highlight ? COLORS.successBg : COLORS.blueLight,
        border: highlight ? `1px solid ${COLORS.success}20` : `1px solid ${COLORS.borderSoft}`,
        borderRadius: '12px',
        padding: '16px',
        textAlign: 'center',
      }}
    >
      <div style={{
        fontSize: '20px',
        fontWeight: 700,
        color: highlight ? COLORS.success : COLORS.blueMain,
      }}>
        {value}
      </div>
      <div style={{
        fontSize: '11px',
        color: COLORS.textMuted,
        marginTop: '4px',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        fontWeight: 500,
      }}>
        {label}
      </div>
    </div>
  );
}

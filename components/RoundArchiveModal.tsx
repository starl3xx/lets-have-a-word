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
 * Milestone 5.4: Shows round archive information when user taps round number
 *
 * Primary color: #2D68C7
 */

// Color palette based on #2D68C7
const COLORS = {
  primary: '#2D68C7',
  accent: '#7436c9', // Purple accent matching FAQ
  success: '#34d399',
  successBg: 'rgba(52, 211, 153, 0.1)',
};

export default function RoundArchiveModal({ isOpen, onClose, currentRoundId }: RoundArchiveModalProps) {
  const [loading, setLoading] = useState(true);
  const [rounds, setRounds] = useState<ArchivedRound[]>([]);
  const [stats, setStats] = useState<ArchiveStats | null>(null);
  const [selectedRound, setSelectedRound] = useState<ArchivedRound | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchArchiveData();
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
        background: 'rgba(0, 0, 0, 0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '16px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: COLORS.primary,
          borderRadius: '16px',
          maxWidth: '500px',
          width: '100%',
          maxHeight: '80vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px',
            borderBottom: '1px solid rgba(255,255,255,0.2)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: 'white' }}>
              {selectedRound ? `Round #${selectedRound.roundNumber}` : 'LHAW archive'}
            </h2>
            {currentRoundId && !selectedRound && (
              <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: 'rgba(255,255,255,0.6)' }}>
                Current: Round #{currentRoundId}
              </p>
            )}
          </div>
          <button
            onClick={selectedRound ? () => setSelectedRound(null) : onClose}
            style={{
              background: 'rgba(255,255,255,0.15)',
              border: 'none',
              borderRadius: '8px',
              padding: '8px 12px',
              color: 'white',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            {selectedRound ? 'Back' : 'Close'}
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.5)', padding: '40px' }}>
              Loading...
            </div>
          ) : error ? (
            <div style={{ textAlign: 'center', color: '#fca5a5', padding: '40px' }}>
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
                    fontSize: '36px',
                    fontWeight: 700,
                    letterSpacing: '6px',
                    color: COLORS.accent,
                  }}
                >
                  {selectedRound.targetWord}
                </div>
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '13px', marginTop: '4px' }}>
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
                <StatBox label="Jackpot" value={`${formatEth(selectedRound.finalJackpotEth)} ETH`} highlight />
                <StatBox label="Guesses" value={selectedRound.totalGuesses.toLocaleString()} />
                <StatBox label="Players" value={selectedRound.uniquePlayers.toLocaleString()} />
                <StatBox label="Duration" value={formatDuration(selectedRound.startTime, selectedRound.endTime)} />
              </div>

              {/* Winner */}
              {selectedRound.winnerFid && (
                <div
                  style={{
                    background: COLORS.successBg,
                    borderRadius: '8px',
                    padding: '12px',
                    marginBottom: '16px',
                  }}
                >
                  <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>
                    Winner
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'white', fontWeight: 600 }}>
                      FID {selectedRound.winnerFid}
                      {selectedRound.winnerGuessNumber && (
                        <span style={{ fontWeight: 400, opacity: 0.7 }}>
                          {' '}(guess #{selectedRound.winnerGuessNumber})
                        </span>
                      )}
                    </span>
                    {selectedRound.payoutsJson.winner && (
                      <span style={{ color: COLORS.success, fontWeight: 600 }}>
                        {formatEth(selectedRound.payoutsJson.winner.amountEth)} ETH
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* View full details link */}
              <a
                href={`/archive/${selectedRound.roundNumber}`}
                style={{
                  display: 'block',
                  textAlign: 'center',
                  padding: '12px',
                  background: 'rgba(255,255,255,0.15)',
                  color: 'white',
                  borderRadius: '8px',
                  textDecoration: 'none',
                  fontSize: '14px',
                  fontWeight: 500,
                }}
              >
                View full details
              </a>
            </div>
          ) : (
            // List View
            <div>
              {/* Stats Summary */}
              {stats && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: '8px',
                    marginBottom: '20px',
                  }}
                >
                  <MiniStat label="Total rounds" value={stats.totalRounds.toLocaleString()} />
                  <MiniStat label="Total guesses" value={stats.totalGuessesAllTime.toLocaleString()} />
                  <MiniStat label="Unique winners" value={stats.uniqueWinners.toLocaleString()} />
                  <MiniStat label="Total jackpot" value={`${formatEth(stats.totalJackpotDistributed)} ETH`} />
                </div>
              )}

              {/* Recent rounds */}
              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>
                Recent completed rounds
              </div>
              {rounds.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.5)', padding: '20px' }}>
                  No archived rounds yet
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {rounds.map((round) => (
                    <button
                      key={round.roundNumber}
                      onClick={() => fetchRoundDetail(round.roundNumber)}
                      style={{
                        background: 'rgba(255,255,255,0.1)',
                        border: 'none',
                        borderRadius: '8px',
                        padding: '12px',
                        cursor: 'pointer',
                        textAlign: 'left',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <div style={{ color: 'white', fontWeight: 600, fontSize: '14px' }}>
                          Round #{round.roundNumber}
                          <span
                            style={{
                              marginLeft: '8px',
                              fontFamily: 'monospace',
                              color: COLORS.accent,
                              letterSpacing: '1px',
                            }}
                          >
                            {round.targetWord}
                          </span>
                        </div>
                        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px', marginTop: '2px' }}>
                          {round.totalGuesses} guesses, {round.uniquePlayers} players
                        </div>
                      </div>
                      <div style={{ color: COLORS.success, fontWeight: 600, fontSize: '14px' }}>
                        {formatEth(round.finalJackpotEth)} ETH
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* View all link */}
              <a
                href="/archive"
                style={{
                  display: 'block',
                  textAlign: 'center',
                  padding: '12px',
                  marginTop: '16px',
                  background: 'rgba(255,255,255,0.15)',
                  color: 'white',
                  borderRadius: '8px',
                  textDecoration: 'none',
                  fontSize: '14px',
                }}
              >
                View all rounds
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatBox({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      style={{
        background: highlight ? COLORS.successBg : 'rgba(255,255,255,0.1)',
        borderRadius: '8px',
        padding: '12px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: '18px', fontWeight: 600, color: highlight ? COLORS.success : COLORS.accent }}>
        {value}
      </div>
      <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginTop: '2px' }}>
        {label}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.1)',
        borderRadius: '6px',
        padding: '8px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: '14px', fontWeight: 600, color: COLORS.accent }}>{value}</div>
      <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}>{label}</div>
    </div>
  );
}

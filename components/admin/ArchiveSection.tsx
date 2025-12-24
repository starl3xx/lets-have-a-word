/**
 * Archive Section Component
 * Round archive for unified admin dashboard
 */

import React, { useState, useEffect, useCallback } from "react"

// =============================================================================
// Types
// =============================================================================

interface ArchiveSectionProps {
  user?: {
    fid: number
    username: string
    display_name?: string
    pfp_url?: string
  }
}

interface ArchiveStats {
  totalRounds: number
  totalGuessesAllTime: number
  uniqueWinners: number
  totalJackpotDistributed: string
  avgGuessesPerRound: number
  avgPlayersPerRound: number
  avgRoundLengthMinutes: number
}

interface ArchivedRound {
  id: number
  roundNumber: number
  targetWord: string
  seedEth: string
  finalJackpotEth: string
  totalGuesses: number
  uniquePlayers: number
  winnerFid: number | null
  winnerCastHash: string | null
  winnerGuessNumber: number | null
  startTime: string
  endTime: string
  referrerFid: number | null
  payoutsJson: any
  salt: string
  clanktonBonusCount: number
  referralBonusCount: number
  createdAt: string
}

// =============================================================================
// Styling
// =============================================================================

const fontFamily = "'Söhne', 'SF Pro Display', system-ui, -apple-system, sans-serif"

const styles = {
  module: {
    background: "white",
    borderRadius: "12px",
    border: "1px solid #e5e7eb",
    padding: "20px",
    marginBottom: "20px",
  },
  moduleHeader: {
    fontSize: "15px",
    fontWeight: 600,
    color: "#111827",
    marginBottom: "16px",
    fontFamily,
  },
  grid: {
    display: "grid" as const,
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "12px",
  },
  statCard: {
    padding: "16px",
    background: "#f9fafb",
    borderRadius: "8px",
    border: "1px solid #f3f4f6",
  },
  statLabel: {
    fontSize: "12px",
    color: "#6b7280",
    fontWeight: 500,
    marginBottom: "4px",
    textTransform: "uppercase" as const,
    fontFamily,
  },
  statValue: {
    fontSize: "22px",
    fontWeight: 600,
    color: "#111827",
    fontFamily,
  },
  statSubtext: {
    fontSize: "12px",
    color: "#9ca3af",
    marginTop: "2px",
    fontFamily,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: "13px",
    fontFamily,
  },
  th: {
    textAlign: "left" as const,
    padding: "12px 8px",
    borderBottom: "2px solid #e5e7eb",
    color: "#6b7280",
    fontWeight: 600,
    fontSize: "11px",
    textTransform: "uppercase" as const,
  },
  td: {
    padding: "12px 8px",
    borderBottom: "1px solid #f3f4f6",
    color: "#111827",
  },
  btn: {
    padding: "8px 16px",
    background: "#6366f1",
    color: "white",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 500,
    fontFamily,
  },
  btnSecondary: {
    padding: "8px 16px",
    background: "#f3f4f6",
    color: "#374151",
    border: "1px solid #d1d5db",
    borderRadius: "6px",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 500,
    fontFamily,
  },
  loading: {
    textAlign: "center" as const,
    padding: "48px",
    color: "#6b7280",
    fontFamily,
  },
  error: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: "8px",
    padding: "16px",
    color: "#dc2626",
    marginBottom: "24px",
    fontFamily,
  },
  success: {
    background: "#f0fdf4",
    border: "1px solid #bbf7d0",
    borderRadius: "8px",
    padding: "16px",
    marginBottom: "24px",
    fontFamily,
  },
  pagination: {
    display: "flex" as const,
    justifyContent: "center" as const,
    gap: "8px",
    marginTop: "20px",
  },
  controls: {
    display: "flex" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
    marginBottom: "20px",
    flexWrap: "wrap" as const,
    gap: "12px",
  },
}

// =============================================================================
// Archive Section Component
// =============================================================================

export default function ArchiveSection({ user }: ArchiveSectionProps) {
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<ArchiveStats | null>(null)
  const [rounds, setRounds] = useState<ArchivedRound[]>([])
  const [totalRounds, setTotalRounds] = useState(0)
  const [page, setPage] = useState(0)
  const [syncResult, setSyncResult] = useState<any>(null)
  const [selectedRound, setSelectedRound] = useState<ArchivedRound | null>(null)
  const pageSize = 10

  const fetchArchiveData = useCallback(async () => {
    if (!user?.fid) return

    setLoading(true)
    setError(null)

    try {
      const response = await fetch(
        `/api/archive/list?devFid=${user.fid}&stats=true&limit=${pageSize}&offset=${page * pageSize}`
      )
      if (!response.ok) throw new Error('Failed to fetch archive list')
      const data = await response.json()
      setRounds(data.rounds)
      setTotalRounds(data.total)
      if (data.stats) setStats(data.stats)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load archive data')
    } finally {
      setLoading(false)
    }
  }, [user?.fid, page])

  const syncArchive = async () => {
    if (!user?.fid) return

    setSyncing(true)
    setSyncResult(null)

    try {
      const response = await fetch(`/api/admin/archive/sync?devFid=${user.fid}`, {
        method: 'POST',
      })
      if (!response.ok) throw new Error('Failed to sync archive')
      const result = await response.json()
      setSyncResult(result)
      await fetchArchiveData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  useEffect(() => {
    fetchArchiveData()
  }, [fetchArchiveData])

  const formatDuration = (startTime: string, endTime: string) => {
    const start = new Date(startTime)
    const end = new Date(endTime)
    const durationMs = end.getTime() - start.getTime()
    const hours = Math.floor(durationMs / (1000 * 60 * 60))
    const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60))
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
  }

  const formatEth = (eth: string) => {
    const num = parseFloat(eth)
    return num.toFixed(4)
  }

  const totalPages = Math.ceil(totalRounds / pageSize)

  if (loading && !stats) {
    return <div style={styles.loading}>Loading archive...</div>
  }

  return (
    <div>
      {/* Error */}
      {error && <div style={styles.error}>{error}</div>}

      {/* Sync Result */}
      {syncResult && (
        <div style={styles.success}>
          <strong>Sync Complete:</strong> {syncResult.synced || 0} rounds synced, {syncResult.failed || 0} failed
        </div>
      )}

      {/* Controls */}
      <div style={styles.controls}>
        <div style={{ fontSize: "14px", color: "#6b7280", fontFamily }}>
          {totalRounds} archived rounds
        </div>
        <button
          onClick={syncArchive}
          style={styles.btn}
          disabled={syncing}
        >
          {syncing ? 'Syncing...' : 'Sync Archive'}
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div style={styles.module}>
          <h3 style={styles.moduleHeader}>All-Time Statistics</h3>
          <div style={styles.grid}>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Rounds Played</div>
              <div style={styles.statValue}>{stats.totalRounds}</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Total Guesses</div>
              <div style={styles.statValue}>{stats.totalGuessesAllTime.toLocaleString()}</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Unique Winners</div>
              <div style={styles.statValue}>{stats.uniqueWinners}</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Total Jackpot Paid</div>
              <div style={styles.statValue}>{formatEth(stats.totalJackpotDistributed)} ETH</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Avg Guesses/Round</div>
              <div style={styles.statValue}>{stats.avgGuessesPerRound.toFixed(0)}</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Avg Round Length</div>
              <div style={styles.statValue}>{Math.floor(stats.avgRoundLengthMinutes / 60)}h {stats.avgRoundLengthMinutes % 60}m</div>
            </div>
          </div>
        </div>
      )}

      {/* Rounds Table */}
      <div style={styles.module}>
        <h3 style={styles.moduleHeader}>Archived Rounds</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Round</th>
                <th style={styles.th}>Word</th>
                <th style={styles.th}>Jackpot</th>
                <th style={styles.th}>Guesses</th>
                <th style={styles.th}>Players</th>
                <th style={styles.th}>Winner</th>
                <th style={styles.th}>Duration</th>
                <th style={styles.th}>Date</th>
              </tr>
            </thead>
            <tbody>
              {rounds.map(round => (
                <tr
                  key={round.id}
                  style={{ cursor: "pointer" }}
                  onClick={() => setSelectedRound(selectedRound?.id === round.id ? null : round)}
                >
                  <td style={styles.td}>
                    <span style={{ fontWeight: 600 }}>#{round.roundNumber}</span>
                  </td>
                  <td style={styles.td}>
                    <code style={{ background: "#f3f4f6", padding: "2px 6px", borderRadius: "4px" }}>
                      {round.targetWord}
                    </code>
                  </td>
                  <td style={styles.td}>
                    <span style={{ color: "#16a34a", fontWeight: 600 }}>
                      {formatEth(round.finalJackpotEth)} ETH
                    </span>
                  </td>
                  <td style={styles.td}>{round.totalGuesses.toLocaleString()}</td>
                  <td style={styles.td}>{round.uniquePlayers}</td>
                  <td style={styles.td}>
                    {round.winnerFid ? (
                      <span style={{ color: "#6366f1" }}>FID {round.winnerFid}</span>
                    ) : (
                      <span style={{ color: "#9ca3af" }}>-</span>
                    )}
                  </td>
                  <td style={styles.td}>{formatDuration(round.startTime, round.endTime)}</td>
                  <td style={styles.td}>
                    {new Date(round.endTime).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Selected Round Detail */}
        {selectedRound && (
          <div style={{
            marginTop: "16px",
            padding: "16px",
            background: "#f9fafb",
            borderRadius: "8px",
            border: "1px solid #e5e7eb",
          }}>
            <h4 style={{ margin: "0 0 12px 0", fontSize: "14px", fontWeight: 600, fontFamily }}>
              Round #{selectedRound.roundNumber} Details
            </h4>
            <div style={{ ...styles.grid, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
              <div>
                <div style={styles.statLabel}>Target Word</div>
                <code style={{ fontSize: "18px", fontWeight: 600 }}>{selectedRound.targetWord}</code>
              </div>
              <div>
                <div style={styles.statLabel}>Seed</div>
                <div>{formatEth(selectedRound.seedEth)} ETH</div>
              </div>
              <div>
                <div style={styles.statLabel}>Final Jackpot</div>
                <div style={{ color: "#16a34a", fontWeight: 600 }}>{formatEth(selectedRound.finalJackpotEth)} ETH</div>
              </div>
              <div>
                <div style={styles.statLabel}>Winner Guess #</div>
                <div>{selectedRound.winnerGuessNumber || '-'}</div>
              </div>
              <div>
                <div style={styles.statLabel}>CLANKTON Bonuses</div>
                <div>{selectedRound.clanktonBonusCount}</div>
              </div>
              <div>
                <div style={styles.statLabel}>Referral Bonuses</div>
                <div>{selectedRound.referralBonusCount}</div>
              </div>
            </div>
            {selectedRound.payoutsJson && (
              <div style={{ marginTop: "16px" }}>
                <div style={styles.statLabel}>Payouts</div>
                <pre style={{
                  background: "#1f2937",
                  color: "#e5e7eb",
                  padding: "12px",
                  borderRadius: "6px",
                  fontSize: "11px",
                  overflow: "auto",
                  maxHeight: "200px",
                }}>
                  {JSON.stringify(selectedRound.payoutsJson, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={styles.pagination}>
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              style={styles.btnSecondary}
              disabled={page === 0}
            >
              Previous
            </button>
            <span style={{ padding: "8px 16px", fontSize: "13px", color: "#6b7280", fontFamily }}>
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              style={styles.btnSecondary}
              disabled={page >= totalPages - 1}
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* Link to full archive */}
      <div style={{ textAlign: "center", padding: "24px" }}>
        <a
          href="/admin/archive"
          style={{
            color: "#6366f1",
            fontSize: "14px",
            fontFamily,
            textDecoration: "none",
          }}
        >
          View full round archive →
        </a>
      </div>
    </div>
  )
}

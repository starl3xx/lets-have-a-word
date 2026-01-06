/**
 * Archive Section Component
 * Comprehensive round archive for unified admin dashboard
 * Enhanced with distribution charts, error tracking, and detailed round views
 */

import React, { useState, useEffect, useCallback } from "react"
import { AnalyticsChart } from "./AnalyticsChart"

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

interface ArchiveError {
  id: number
  roundNumber: number
  errorType: string
  errorMessage: string
  errorData: any
  resolved: boolean
  resolvedAt: string | null
  resolvedBy: number | null
  createdAt: string
}

interface Distribution {
  distribution: Array<{ hour: number; count: number }>
  byPlayer: Array<{ fid: number; count: number }>
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
    letterSpacing: "0.03em",
    fontFamily,
  },
  statValue: {
    fontSize: "22px",
    fontWeight: 600,
    color: "#111827",
    letterSpacing: "-0.02em",
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
  btnSmall: {
    padding: "4px 12px",
    background: "#6366f1",
    color: "white",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "12px",
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
// Helper Components
// =============================================================================

function StatCard({ label, value, subtext, loading }: {
  label: string
  value: string | number
  subtext?: string
  loading?: boolean
}) {
  return (
    <div style={styles.statCard}>
      <div style={styles.statLabel}>{label}</div>
      <div style={styles.statValue}>{loading ? "..." : value}</div>
      {subtext && <div style={styles.statSubtext}>{subtext}</div>}
    </div>
  )
}

// =============================================================================
// Archive Section Component
// =============================================================================

export default function ArchiveSection({ user }: ArchiveSectionProps) {
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [forceSyncing, setForceSyncing] = useState(false)
  const [rearchiving, setRearchiving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<ArchiveStats | null>(null)
  const [rounds, setRounds] = useState<ArchivedRound[]>([])
  const [totalRounds, setTotalRounds] = useState(0)
  const [errors, setErrors] = useState<ArchiveError[]>([])
  const [page, setPage] = useState(0)
  const [syncResult, setSyncResult] = useState<any>(null)
  const [selectedRound, setSelectedRound] = useState<ArchivedRound | null>(null)
  const [distribution, setDistribution] = useState<Distribution | null>(null)
  const [usernames, setUsernames] = useState<Record<number, string>>({})
  const [resolvingErrorId, setResolvingErrorId] = useState<number | null>(null)
  const [loadingDetailFor, setLoadingDetailFor] = useState<number | null>(null)
  const pageSize = 15

  const fetchArchiveData = useCallback(async () => {
    if (!user?.fid) return

    setLoading(true)
    setError(null)

    try {
      const devFidParam = `?devFid=${user.fid}`

      // Fetch archive list with stats
      const response = await fetch(
        `/api/archive/list${devFidParam}&stats=true&limit=${pageSize}&offset=${page * pageSize}`
      )
      if (!response.ok) throw new Error('Failed to fetch archive list')
      const data = await response.json()
      setRounds(data.rounds)
      setTotalRounds(data.total)
      if (data.stats) setStats(data.stats)

      // Fetch errors
      const errorsResponse = await fetch(`/api/admin/archive/errors${devFidParam}`)
      if (errorsResponse.ok) {
        const errorsData = await errorsResponse.json()
        setErrors(errorsData.errors || [])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load archive data')
    } finally {
      setLoading(false)
    }
  }, [user?.fid, page])

  const syncArchive = async (force = false) => {
    if (!user?.fid) return

    if (force) {
      setForceSyncing(true)
    } else {
      setSyncing(true)
    }
    setSyncResult(null)

    try {
      const response = await fetch(`/api/admin/archive/sync?devFid=${user.fid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      })
      if (!response.ok) throw new Error('Failed to sync archive')
      const result = await response.json()
      setSyncResult(result)
      await fetchArchiveData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncing(false)
      setForceSyncing(false)
    }
  }

  const rearchiveRound = async (roundNumber: number) => {
    if (!user?.fid) return

    setRearchiving(true)
    setSyncResult(null)

    try {
      const response = await fetch(`/api/admin/archive/sync?devFid=${user.fid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roundId: roundNumber, force: true }),
      })
      if (!response.ok) throw new Error('Failed to re-archive round')
      const result = await response.json()
      setSyncResult(result)
      // Refresh the selected round details
      await fetchRoundDetail(roundNumber)
      await fetchArchiveData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Re-archive failed')
    } finally {
      setRearchiving(false)
    }
  }

  const fetchRoundDetail = async (roundNumber: number) => {
    if (!user?.fid) {
      setError('Not authenticated')
      return
    }

    setLoadingDetailFor(roundNumber)
    setError(null)

    try {
      const response = await fetch(
        `/api/archive/${roundNumber}?devFid=${user.fid}&distribution=true`
      )
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Failed to fetch round detail (${response.status})`)
      }
      const data = await response.json()

      if (!data.round) {
        throw new Error(`Round ${roundNumber} not found in archive`)
      }

      setSelectedRound(data.round)
      setDistribution(data.distribution)

      // Collect all FIDs that need usernames
      const fids: number[] = []
      if (data.round?.winnerFid) fids.push(data.round.winnerFid)
      if (data.round?.referrerFid) fids.push(data.round.referrerFid)
      if (data.round?.payoutsJson?.winner?.fid) fids.push(data.round.payoutsJson.winner.fid)
      if (data.round?.payoutsJson?.referrer?.fid) fids.push(data.round.payoutsJson.referrer.fid)
      if (data.round?.payoutsJson?.topGuessers) {
        data.round.payoutsJson.topGuessers.forEach((g: any) => {
          if (g.fid) fids.push(g.fid)
        })
      }
      if (data.distribution?.byPlayer) {
        data.distribution.byPlayer.slice(0, 10).forEach((p: any) => {
          if (p.fid) fids.push(p.fid)
        })
      }

      // Fetch usernames for all unique FIDs
      const uniqueFids = [...new Set(fids)]
      if (uniqueFids.length > 0) {
        try {
          const usernamesRes = await fetch(
            `/api/admin/usernames?devFid=${user.fid}&fids=${uniqueFids.join(',')}`
          )
          if (usernamesRes.ok) {
            const usernamesData = await usernamesRes.json()
            if (usernamesData.usernames) {
              setUsernames(usernamesData.usernames)
            }
          }
        } catch {
          // Usernames are optional - don't fail if we can't get them
        }
      }
    } catch (err) {
      console.error('Failed to fetch round detail:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch round detail')
    } finally {
      setLoadingDetailFor(null)
    }
  }

  // Helper to display FID with username
  const formatFid = (fid: number | null | undefined) => {
    if (!fid) return 'N/A'
    const username = usernames[fid]
    return username ? `@${username} (${fid})` : `FID ${fid}`
  }

  const resolveError = async (errorId: number) => {
    if (!user?.fid) return

    setResolvingErrorId(errorId)
    try {
      const response = await fetch(`/api/admin/archive/resolve-error?devFid=${user.fid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ errorId }),
      })
      if (!response.ok) throw new Error('Failed to resolve error')
      // Remove the resolved error from the list
      setErrors(prev => prev.filter(e => e.id !== errorId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve error')
    } finally {
      setResolvingErrorId(null)
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
        <div style={{
          background: syncResult.failed > 0 ? "#fef3c7" : "#d1fae5",
          border: `1px solid ${syncResult.failed > 0 ? "#fbbf24" : "#34d399"}`,
          borderRadius: "8px",
          padding: "16px",
          marginBottom: "20px",
          fontFamily,
        }}>
          <strong>Sync Complete:</strong> {syncResult.archived || syncResult.synced || 0} new, {syncResult.alreadyArchived || 0} existing, {syncResult.failed || 0} failed
          {syncResult.errors?.length > 0 && (
            <ul style={{ margin: "8px 0 0 0", paddingLeft: "20px" }}>
              {syncResult.errors.map((err: string, idx: number) => (
                <li key={idx}>{err}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Controls */}
      <div style={styles.controls}>
        <div style={{ fontSize: "14px", color: "#6b7280", fontFamily }}>
          {totalRounds} archived rounds
        </div>
        <div style={{ display: "flex", gap: "12px" }}>
          <button
            onClick={fetchArchiveData}
            style={styles.btnSecondary}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          <button
            onClick={() => syncArchive(false)}
            style={styles.btn}
            disabled={syncing || forceSyncing}
          >
            {syncing ? 'Syncing...' : 'Sync New'}
          </button>
          <button
            onClick={() => syncArchive(true)}
            style={{
              ...styles.btn,
              background: "#dc2626",
            }}
            disabled={syncing || forceSyncing}
            title="Delete and re-archive all rounds (fixes ranking issues)"
          >
            {forceSyncing ? 'Re-syncing...' : 'Force Re-sync All'}
          </button>
        </div>
      </div>

      {/* Stats Overview */}
      {stats && (
        <div style={styles.module}>
          <h3 style={styles.moduleHeader}>Archive Statistics</h3>
          <div style={{ ...styles.grid, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
            <StatCard
              label="Total Rounds"
              value={stats.totalRounds.toLocaleString()}
              subtext="Archived"
              loading={loading}
            />
            <StatCard
              label="Total Guesses"
              value={stats.totalGuessesAllTime.toLocaleString()}
              subtext="All time"
              loading={loading}
            />
            <StatCard
              label="Unique Winners"
              value={stats.uniqueWinners.toLocaleString()}
              subtext="Different players"
              loading={loading}
            />
            <StatCard
              label="Total Jackpot"
              value={`${formatEth(stats.totalJackpotDistributed)} ETH`}
              subtext="Distributed"
              loading={loading}
            />
            <StatCard
              label="Avg Guesses"
              value={stats.avgGuessesPerRound.toFixed(1)}
              subtext="Per round"
              loading={loading}
            />
            <StatCard
              label="Avg Players"
              value={stats.avgPlayersPerRound.toFixed(1)}
              subtext="Per round"
              loading={loading}
            />
            <StatCard
              label="Avg Duration"
              value={(() => {
                const totalMinutes = Math.round(stats.avgRoundLengthMinutes)
                const hours = Math.floor(totalMinutes / 60)
                const minutes = totalMinutes % 60
                return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
              })()}
              subtext="Start to end"
              loading={loading}
            />
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
                <th style={{ ...styles.th, textAlign: "right" }}>Jackpot</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Guesses</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Players</th>
                <th style={styles.th}>Winner</th>
                <th style={styles.th}>Duration</th>
                <th style={styles.th}>Date</th>
                <th style={{ ...styles.th, textAlign: "center" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rounds.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ ...styles.td, textAlign: "center", color: "#6b7280", padding: "24px" }}>
                    No archived rounds. Click "Sync All Rounds" to archive completed rounds.
                  </td>
                </tr>
              ) : (
                rounds.map(round => (
                  <tr
                    key={round.id}
                    style={{
                      background: selectedRound?.id === round.id ? "#eff6ff" : "transparent",
                    }}
                  >
                    <td style={styles.td}>
                      <span style={{ fontWeight: 600 }}>#{round.roundNumber}</span>
                    </td>
                    <td style={styles.td}>
                      <code style={{ background: "#f3f4f6", padding: "2px 6px", borderRadius: "4px" }}>
                        {round.targetWord}
                      </code>
                    </td>
                    <td style={{ ...styles.td, textAlign: "right" }}>
                      <span style={{ color: "#16a34a", fontWeight: 600 }}>
                        {formatEth(round.finalJackpotEth)} ETH
                      </span>
                    </td>
                    <td style={{ ...styles.td, textAlign: "right" }}>{round.totalGuesses.toLocaleString()}</td>
                    <td style={{ ...styles.td, textAlign: "right" }}>{round.uniquePlayers}</td>
                    <td style={styles.td}>
                      {round.winnerFid ? (
                        <span style={{ color: "#6366f1" }}>{formatFid(round.winnerFid)}</span>
                      ) : (
                        <span style={{ color: "#9ca3af" }}>-</span>
                      )}
                    </td>
                    <td style={styles.td}>{formatDuration(round.startTime, round.endTime)}</td>
                    <td style={styles.td}>
                      {new Date(round.endTime).toLocaleDateString()}
                    </td>
                    <td style={{ ...styles.td, textAlign: "center" }}>
                      <button
                        onClick={() => fetchRoundDetail(round.roundNumber)}
                        style={{
                          ...styles.btnSmall,
                          opacity: loadingDetailFor !== null ? 0.6 : 1,
                          cursor: loadingDetailFor !== null ? "not-allowed" : "pointer",
                        }}
                        disabled={loadingDetailFor !== null}
                      >
                        {loadingDetailFor === round.roundNumber ? 'Loading...' : 'Details'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={styles.pagination}>
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              style={{
                ...styles.btnSecondary,
                opacity: page === 0 ? 0.5 : 1,
                cursor: page === 0 ? "not-allowed" : "pointer",
              }}
              disabled={page === 0}
            >
              Previous
            </button>
            <span style={{ padding: "8px 16px", fontSize: "13px", color: "#6b7280", fontFamily }}>
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              style={{
                ...styles.btnSecondary,
                opacity: page >= totalPages - 1 ? 0.5 : 1,
                cursor: page >= totalPages - 1 ? "not-allowed" : "pointer",
              }}
              disabled={page >= totalPages - 1}
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* Archive Errors */}
      {errors.length > 0 && (
        <div style={{
          ...styles.module,
          background: "#fef2f2",
          border: "1px solid #fecaca",
        }}>
          <h3 style={{ ...styles.moduleHeader, color: "#dc2626" }}>
            ⚠️ Archive Errors ({errors.length} unresolved)
          </h3>
          <p style={{ fontSize: "13px", color: "#7f1d1d", marginBottom: "16px", fontFamily }}>
            The following rounds failed to archive automatically. Use the diagnose and fix tools to resolve these issues.
          </p>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Round</th>
                <th style={styles.th}>Error Type</th>
                <th style={styles.th}>Message</th>
                <th style={styles.th}>Time</th>
                <th style={{ ...styles.th, textAlign: "center" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {errors.map(err => (
                <tr key={err.id}>
                  <td style={styles.td}>
                    <span style={{ fontWeight: 600 }}>#{err.roundNumber}</span>
                  </td>
                  <td style={styles.td}>
                    <code style={{ background: "#fee2e2", padding: "2px 6px", borderRadius: "4px", fontSize: "11px" }}>
                      {err.errorType}
                    </code>
                  </td>
                  <td style={{ ...styles.td, maxWidth: "300px", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {err.errorMessage}
                  </td>
                  <td style={styles.td}>
                    {new Date(err.createdAt).toLocaleString()}
                  </td>
                  <td style={{ ...styles.td, textAlign: "center" }}>
                    <div style={{ display: "flex", gap: "6px", justifyContent: "center", flexWrap: "wrap" }}>
                      <a
                        href={`/api/admin/diagnose-round?roundId=${err.roundNumber}&devFid=${user?.fid}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          ...styles.btnSmall,
                          background: "#f59e0b",
                          textDecoration: "none",
                        }}
                      >
                        Diagnose
                      </a>
                      <a
                        href={`/api/admin/generate-archive-sql?roundId=${err.roundNumber}&devFid=${user?.fid}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          ...styles.btnSmall,
                          background: "#8b5cf6",
                          textDecoration: "none",
                        }}
                      >
                        Gen SQL
                      </a>
                      <button
                        onClick={() => resolveError(err.id)}
                        disabled={resolvingErrorId === err.id}
                        style={{
                          ...styles.btnSmall,
                          background: "#16a34a",
                          opacity: resolvingErrorId === err.id ? 0.6 : 1,
                          cursor: resolvingErrorId === err.id ? "not-allowed" : "pointer",
                        }}
                      >
                        {resolvingErrorId === err.id ? '...' : '✓ Resolved'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Selected Round Detail */}
      {selectedRound && (
        <div style={styles.module}>
          <h3 style={styles.moduleHeader}>Round #{selectedRound.roundNumber} Details</h3>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
            {/* Left Column - Basic Info */}
            <div>
              <div style={{ fontSize: "14px", fontWeight: 600, marginBottom: "12px", fontFamily }}>Round Information</div>
              <div style={{ background: "#f9fafb", borderRadius: "8px", padding: "16px" }}>
                <table style={{ width: "100%", fontSize: "13px" }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: "6px 0", color: "#6b7280" }}>Target Word:</td>
                      <td style={{ padding: "6px 0", fontFamily: "monospace", fontWeight: 600 }}>{selectedRound.targetWord}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "6px 0", color: "#6b7280" }}>Start Time:</td>
                      <td style={{ padding: "6px 0" }}>{new Date(selectedRound.startTime).toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "6px 0", color: "#6b7280" }}>End Time:</td>
                      <td style={{ padding: "6px 0" }}>{new Date(selectedRound.endTime).toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "6px 0", color: "#6b7280" }}>Duration:</td>
                      <td style={{ padding: "6px 0" }}>{formatDuration(selectedRound.startTime, selectedRound.endTime)}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "6px 0", color: "#6b7280" }}>Seed ETH:</td>
                      <td style={{ padding: "6px 0" }}>{formatEth(selectedRound.seedEth)} ETH</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "6px 0", color: "#6b7280" }}>Final Jackpot:</td>
                      <td style={{ padding: "6px 0", fontWeight: 600 }}>{formatEth(selectedRound.finalJackpotEth)} ETH</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "6px 0", color: "#6b7280" }}>Salt:</td>
                      <td style={{ padding: "6px 0", fontFamily: "monospace", fontSize: "11px", wordBreak: "break-all" }}>{selectedRound.salt}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div style={{ fontSize: "14px", fontWeight: 600, margin: "20px 0 12px 0", fontFamily }}>Winner Details</div>
              <div style={{ background: "#f9fafb", borderRadius: "8px", padding: "16px" }}>
                <table style={{ width: "100%", fontSize: "13px" }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: "6px 0", color: "#6b7280" }}>Winner:</td>
                      <td style={{ padding: "6px 0" }}>{formatFid(selectedRound.winnerFid)}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "6px 0", color: "#6b7280" }}>Winning Guess #:</td>
                      <td style={{ padding: "6px 0" }}>{selectedRound.winnerGuessNumber || 'N/A'}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "6px 0", color: "#6b7280" }}>Referrer:</td>
                      <td style={{ padding: "6px 0" }}>{selectedRound.referrerFid ? formatFid(selectedRound.referrerFid) : 'None'}</td>
                    </tr>
                    {selectedRound.winnerCastHash && (
                      <tr>
                        <td style={{ padding: "6px 0", color: "#6b7280" }}>Cast Hash:</td>
                        <td style={{ padding: "6px 0", fontFamily: "monospace", fontSize: "11px" }}>{selectedRound.winnerCastHash}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Right Column - Payouts & Stats */}
            <div>
              <div style={{ fontSize: "14px", fontWeight: 600, marginBottom: "12px", fontFamily }}>Payouts</div>
              {selectedRound.payoutsJson && (
                <div style={{ background: "#f9fafb", borderRadius: "8px", padding: "16px", fontSize: "13px" }}>
                  {selectedRound.payoutsJson.winner && (
                    <div style={{ marginBottom: "8px" }}>
                      <strong>Winner ({formatFid(selectedRound.payoutsJson.winner.fid)}):</strong>{' '}
                      {formatEth(selectedRound.payoutsJson.winner.amountEth)} ETH
                    </div>
                  )}
                  {selectedRound.payoutsJson.referrer && (
                    <div style={{ marginBottom: "8px" }}>
                      <strong>Referrer ({formatFid(selectedRound.payoutsJson.referrer.fid)}):</strong>{' '}
                      {formatEth(selectedRound.payoutsJson.referrer.amountEth)} ETH
                    </div>
                  )}
                  {selectedRound.payoutsJson.topGuessers?.length > 0 && (
                    <div style={{ marginBottom: "8px" }}>
                      <strong>Top Guessers ({selectedRound.payoutsJson.topGuessers.length}):</strong>
                      <ul style={{ margin: "4px 0 0 20px", padding: 0 }}>
                        {selectedRound.payoutsJson.topGuessers.map((g: any, idx: number) => (
                          <li key={idx}>#{g.rank} {formatFid(g.fid)}: {formatEth(g.amountEth)} ETH</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {selectedRound.payoutsJson.seed && (
                    <div style={{ marginBottom: "8px" }}>
                      <strong>Seed:</strong> {formatEth(selectedRound.payoutsJson.seed.amountEth)} ETH
                    </div>
                  )}
                  {selectedRound.payoutsJson.creator && (
                    <div>
                      <strong>Creator:</strong> {formatEth(selectedRound.payoutsJson.creator.amountEth)} ETH
                    </div>
                  )}
                </div>
              )}

              <div style={{ fontSize: "14px", fontWeight: 600, margin: "20px 0 12px 0", fontFamily }}>Round Stats</div>
              <div style={{ ...styles.grid, gridTemplateColumns: "1fr 1fr" }}>
                <StatCard label="Total Guesses" value={selectedRound.totalGuesses.toLocaleString()} />
                <StatCard label="Unique Players" value={selectedRound.uniquePlayers} />
                <StatCard label="CLANKTON Bonuses" value={selectedRound.clanktonBonusCount} />
                <StatCard label="Referral Signups" value={selectedRound.referralBonusCount} />
              </div>
            </div>
          </div>

          {/* Guess Distribution Histogram */}
          {distribution && distribution.distribution.length > 0 && (
            <div style={{ marginTop: "24px" }}>
              <AnalyticsChart
                data={distribution.distribution.map((d) => ({
                  hour: `${d.hour}:00`,
                  "Guesses": d.count
                }))}
                type="bar"
                dataKey="Guesses"
                xAxisKey="hour"
                title="Guess Distribution by Hour"
                colors={["#8b5cf6"]}
                height={200}
              />
            </div>
          )}

          {/* Top Guessers */}
          {distribution && distribution.byPlayer.length > 0 && (
            <div style={{ marginTop: "24px" }}>
              <div style={{ fontSize: "14px", fontWeight: 600, marginBottom: "12px", fontFamily }}>Top Guessers This Round</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                    <th style={{ padding: "8px", textAlign: "left", fontWeight: 600 }}>#</th>
                    <th style={{ padding: "8px", textAlign: "left", fontWeight: 600 }}>Player</th>
                    <th style={{ padding: "8px", textAlign: "right", fontWeight: 600 }}>Guesses</th>
                  </tr>
                </thead>
                <tbody>
                  {distribution.byPlayer.slice(0, 10).map((p, idx) => (
                    <tr key={idx} style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <td style={{ padding: "8px" }}>{idx + 1}</td>
                      <td style={{ padding: "8px" }}>{formatFid(p.fid)}</td>
                      <td style={{ padding: "8px", textAlign: "right" }}>{p.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: "flex", gap: "12px", marginTop: "24px" }}>
            <button
              onClick={() => rearchiveRound(selectedRound.roundNumber)}
              disabled={rearchiving}
              style={{
                padding: "8px 16px",
                background: "#dc2626",
                color: "white",
                border: "none",
                borderRadius: "6px",
                cursor: rearchiving ? "not-allowed" : "pointer",
                fontSize: "13px",
                fontFamily,
                opacity: rearchiving ? 0.6 : 1,
              }}
              title="Delete and re-archive this round (fixes ranking issues)"
            >
              {rearchiving ? 'Re-archiving...' : 'Re-archive This Round'}
            </button>
            <button
              onClick={() => { setSelectedRound(null); setDistribution(null); setUsernames({}); }}
              style={{
                padding: "8px 16px",
                background: "#6b7280",
                color: "white",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "13px",
                fontFamily,
              }}
            >
              Close Details
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

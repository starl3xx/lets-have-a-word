// pages/admin/archive.tsx
// Milestone 5.4: Round Archive Admin Dashboard
import React, { useState, useEffect, useCallback } from "react"
import dynamic from "next/dynamic"
import { AdminStatsCard } from "../../components/admin/AdminStatsCard"
import { AdminSection } from "../../components/admin/AdminSection"
import { AnalyticsChart } from "../../components/admin/AnalyticsChart"

// Dynamically import the auth wrapper (client-only)
const AdminAuthWrapper = dynamic(
  () => import("../../components/admin/AdminAuthWrapper").then(m => m.AdminAuthWrapper),
  { ssr: false, loading: () => <div style={{ padding: 24 }}>Loading...</div> }
)

interface ArchiveDashboardProps {
  user?: {
    fid: number
    username: string
    display_name?: string
    pfp_url?: string
  }
  onSignOut?: () => void
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

function ArchiveDashboard({ user, onSignOut }: ArchiveDashboardProps) {
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<ArchiveStats | null>(null)
  const [rounds, setRounds] = useState<ArchivedRound[]>([])
  const [totalRounds, setTotalRounds] = useState(0)
  const [errors, setErrors] = useState<ArchiveError[]>([])
  const [selectedRound, setSelectedRound] = useState<ArchivedRound | null>(null)
  const [distribution, setDistribution] = useState<any>(null)
  const [page, setPage] = useState(0)
  const [syncResult, setSyncResult] = useState<any>(null)
  const pageSize = 20

  const fetchArchiveData = useCallback(async () => {
    if (!user) return

    setLoading(true)
    setError(null)

    try {
      const devFidParam = `?devFid=${user.fid}`

      // Fetch archive list with stats
      const listResponse = await fetch(
        `/api/archive/list${devFidParam}&stats=true&limit=${pageSize}&offset=${page * pageSize}`
      )
      if (!listResponse.ok) throw new Error('Failed to fetch archive list')
      const listData = await listResponse.json()
      setRounds(listData.rounds)
      setTotalRounds(listData.total)
      if (listData.stats) setStats(listData.stats)

      // Fetch errors
      const errorsResponse = await fetch(`/api/admin/archive/errors${devFidParam}`)
      if (errorsResponse.ok) {
        const errorsData = await errorsResponse.json()
        setErrors(errorsData.errors)
      }
    } catch (err) {
      console.error('Error fetching archive data:', err)
      setError(err instanceof Error ? err.message : 'Failed to load archive data')
    } finally {
      setLoading(false)
    }
  }, [user, page])

  const syncArchive = async () => {
    if (!user) return

    setSyncing(true)
    setSyncResult(null)

    try {
      const response = await fetch(`/api/admin/archive/sync?devFid=${user.fid}`, {
        method: 'POST',
      })
      if (!response.ok) throw new Error('Failed to sync archive')
      const result = await response.json()
      setSyncResult(result)
      // Refresh data after sync
      await fetchArchiveData()
    } catch (err) {
      console.error('Sync failed:', err)
      setError(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  const fetchRoundDetail = async (roundNumber: number) => {
    if (!user) return

    try {
      const response = await fetch(
        `/api/archive/${roundNumber}?devFid=${user.fid}&distribution=true`
      )
      if (!response.ok) throw new Error('Failed to fetch round detail')
      const data = await response.json()
      setSelectedRound(data.round)
      setDistribution(data.distribution)
    } catch (err) {
      console.error('Failed to fetch round detail:', err)
    }
  }

  useEffect(() => {
    if (user) {
      fetchArchiveData()
    }
  }, [user, fetchArchiveData])

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

  return (
    <main style={{
      minHeight: "100vh",
      background: "#f3f4f6",
      fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    }}>
      {/* Header */}
      <header style={{
        background: "white",
        borderBottom: "1px solid #e5e7eb",
        padding: "24px",
      }}>
        <div style={{ maxWidth: "1280px", margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h1 style={{
                margin: 0,
                fontSize: "28px",
                fontWeight: 700,
                color: "#111827",
              }}>
                Round Archive — Admin Dashboard
              </h1>
              <p style={{
                margin: "8px 0 0 0",
                fontSize: "14px",
                color: "#6b7280",
              }}>
                Milestone 5.4: View and manage historical round data
              </p>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <a
                href="/admin/analytics"
                style={{
                  padding: "8px 16px",
                  background: "#6b7280",
                  color: "white",
                  borderRadius: "6px",
                  textDecoration: "none",
                  fontSize: "14px",
                }}
              >
                Analytics
              </a>
              {user && (
                <>
                  {user.pfp_url && (
                    <img
                      src={user.pfp_url}
                      alt={user.username || `FID ${user.fid}`}
                      style={{
                        width: "40px",
                        height: "40px",
                        borderRadius: "50%",
                        objectFit: "cover",
                      }}
                    />
                  )}
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: "#111827" }}>
                      {user.username ? `@${user.username}` : user.display_name || 'Admin User'}
                    </div>
                    <div style={{ fontSize: "12px", color: "#6b7280" }}>
                      FID: {user.fid}
                    </div>
                  </div>
                  {onSignOut && (
                    <button
                      onClick={onSignOut}
                      style={{
                        padding: "6px 12px",
                        background: "#6b7280",
                        color: "white",
                        border: "none",
                        borderRadius: "6px",
                        cursor: "pointer",
                        fontSize: "12px",
                      }}
                    >
                      Sign Out
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "32px 24px" }}>
        {/* Error Message */}
        {error && (
          <div style={{
            background: "#fee2e2",
            border: "1px solid #fecaca",
            borderRadius: "8px",
            padding: "16px",
            marginBottom: "24px",
            color: "#991b1b",
          }}>
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Sync Result */}
        {syncResult && (
          <div style={{
            background: syncResult.failed > 0 ? "#fef3c7" : "#d1fae5",
            border: `1px solid ${syncResult.failed > 0 ? "#fbbf24" : "#34d399"}`,
            borderRadius: "8px",
            padding: "16px",
            marginBottom: "24px",
          }}>
            <strong>Sync Complete:</strong> {syncResult.archived} new, {syncResult.alreadyArchived} existing, {syncResult.failed} failed
            {syncResult.errors.length > 0 && (
              <ul style={{ margin: "8px 0 0 0", paddingLeft: "20px" }}>
                {syncResult.errors.map((err: string, idx: number) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Sync Controls */}
        <div style={{ marginBottom: "24px", display: "flex", gap: "12px" }}>
          <button
            onClick={syncArchive}
            disabled={syncing}
            style={{
              padding: "12px 24px",
              background: syncing ? "#d1d5db" : "#3b82f6",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: syncing ? "not-allowed" : "pointer",
              fontSize: "14px",
              fontWeight: 500,
            }}
          >
            {syncing ? 'Syncing...' : 'Sync All Rounds'}
          </button>
          <button
            onClick={fetchArchiveData}
            disabled={loading}
            style={{
              padding: "12px 24px",
              background: "#6b7280",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: loading ? "not-allowed" : "pointer",
              fontSize: "14px",
            }}
          >
            Refresh
          </button>
        </div>

        {/* Stats Overview */}
        <AdminSection title="Archive Statistics">
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: "16px",
          }}>
            <AdminStatsCard
              title="Total Rounds"
              value={loading ? "..." : stats?.totalRounds.toLocaleString() || "0"}
              subtitle="Archived"
              loading={loading}
            />
            <AdminStatsCard
              title="Total Guesses"
              value={loading ? "..." : stats?.totalGuessesAllTime.toLocaleString() || "0"}
              subtitle="All time"
              loading={loading}
            />
            <AdminStatsCard
              title="Unique Winners"
              value={loading ? "..." : stats?.uniqueWinners.toLocaleString() || "0"}
              subtitle="Different players"
              loading={loading}
            />
            <AdminStatsCard
              title="Total Jackpot"
              value={loading ? "..." : `${formatEth(stats?.totalJackpotDistributed || "0")} ETH`}
              subtitle="Distributed"
              loading={loading}
            />
            <AdminStatsCard
              title="Avg Guesses/Round"
              value={loading ? "..." : stats?.avgGuessesPerRound.toFixed(1) || "0"}
              subtitle="Per round"
              loading={loading}
            />
            <AdminStatsCard
              title="Avg Players/Round"
              value={loading ? "..." : stats?.avgPlayersPerRound.toFixed(1) || "0"}
              subtitle="Per round"
              loading={loading}
            />
            <AdminStatsCard
              title="Avg Round Length"
              value={loading ? "..." : `${Math.round(stats?.avgRoundLengthMinutes || 0)} min`}
              subtitle="Start to end"
              loading={loading}
            />
          </div>
        </AdminSection>

        {/* Archive Errors */}
        {errors.length > 0 && (
          <AdminSection title={`Archive Errors (${errors.length})`}>
            <div style={{
              background: "#fef3c7",
              border: "1px solid #fbbf24",
              borderRadius: "8px",
              padding: "16px",
            }}>
              {errors.slice(0, 5).map((err, idx) => (
                <div key={idx} style={{
                  padding: "8px",
                  background: "#fffbeb",
                  borderRadius: "4px",
                  marginBottom: "8px",
                  fontSize: "13px",
                }}>
                  <strong>Round {err.roundNumber}:</strong> {err.errorType} - {err.errorMessage}
                </div>
              ))}
            </div>
          </AdminSection>
        )}

        {/* Rounds Table */}
        <AdminSection title={`Archived Rounds (${totalRounds})`}>
          <div style={{
            background: "white",
            border: "1px solid #e5e7eb",
            borderRadius: "8px",
            overflow: "hidden",
          }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
              <thead>
                <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                  <th style={{ padding: "12px", textAlign: "left" }}>Round #</th>
                  <th style={{ padding: "12px", textAlign: "left" }}>Word</th>
                  <th style={{ padding: "12px", textAlign: "right" }}>Jackpot</th>
                  <th style={{ padding: "12px", textAlign: "right" }}>Winner FID</th>
                  <th style={{ padding: "12px", textAlign: "right" }}>Guesses</th>
                  <th style={{ padding: "12px", textAlign: "right" }}>Players</th>
                  <th style={{ padding: "12px", textAlign: "right" }}>Duration</th>
                  <th style={{ padding: "12px", textAlign: "center" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} style={{ padding: "24px", textAlign: "center" }}>Loading...</td>
                  </tr>
                ) : rounds.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: "24px", textAlign: "center", color: "#6b7280" }}>
                      No archived rounds. Click "Sync All Rounds" to archive completed rounds.
                    </td>
                  </tr>
                ) : (
                  rounds.map((round) => (
                    <tr
                      key={round.roundNumber}
                      style={{
                        borderBottom: "1px solid #f3f4f6",
                        background: selectedRound?.roundNumber === round.roundNumber ? "#eff6ff" : "transparent",
                      }}
                    >
                      <td style={{ padding: "12px", fontWeight: 500 }}>#{round.roundNumber}</td>
                      <td style={{ padding: "12px", fontFamily: "monospace" }}>{round.targetWord}</td>
                      <td style={{ padding: "12px", textAlign: "right" }}>{formatEth(round.finalJackpotEth)} ETH</td>
                      <td style={{ padding: "12px", textAlign: "right" }}>{round.winnerFid || '-'}</td>
                      <td style={{ padding: "12px", textAlign: "right" }}>{round.totalGuesses.toLocaleString()}</td>
                      <td style={{ padding: "12px", textAlign: "right" }}>{round.uniquePlayers}</td>
                      <td style={{ padding: "12px", textAlign: "right" }}>{formatDuration(round.startTime, round.endTime)}</td>
                      <td style={{ padding: "12px", textAlign: "center" }}>
                        <button
                          onClick={() => fetchRoundDetail(round.roundNumber)}
                          style={{
                            padding: "4px 12px",
                            background: "#3b82f6",
                            color: "white",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontSize: "12px",
                          }}
                        >
                          Details
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {/* Pagination */}
            {totalRounds > pageSize && (
              <div style={{
                padding: "12px",
                display: "flex",
                justifyContent: "center",
                gap: "8px",
                borderTop: "1px solid #e5e7eb",
              }}>
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  style={{
                    padding: "8px 16px",
                    background: page === 0 ? "#e5e7eb" : "#3b82f6",
                    color: page === 0 ? "#9ca3af" : "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: page === 0 ? "not-allowed" : "pointer",
                  }}
                >
                  Previous
                </button>
                <span style={{ padding: "8px 16px", color: "#6b7280" }}>
                  Page {page + 1} of {Math.ceil(totalRounds / pageSize)}
                </span>
                <button
                  onClick={() => setPage(p => p + 1)}
                  disabled={(page + 1) * pageSize >= totalRounds}
                  style={{
                    padding: "8px 16px",
                    background: (page + 1) * pageSize >= totalRounds ? "#e5e7eb" : "#3b82f6",
                    color: (page + 1) * pageSize >= totalRounds ? "#9ca3af" : "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: (page + 1) * pageSize >= totalRounds ? "not-allowed" : "pointer",
                  }}
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </AdminSection>

        {/* Selected Round Detail */}
        {selectedRound && (
          <AdminSection title={`Round #${selectedRound.roundNumber} Details`}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
              {/* Left Column - Basic Info */}
              <div>
                <h4 style={{ margin: "0 0 16px 0" }}>Round Information</h4>
                <table style={{ width: "100%", fontSize: "14px" }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: "8px 0", color: "#6b7280" }}>Target Word:</td>
                      <td style={{ padding: "8px 0", fontFamily: "monospace", fontWeight: 600 }}>{selectedRound.targetWord}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "8px 0", color: "#6b7280" }}>Start Time:</td>
                      <td style={{ padding: "8px 0" }}>{new Date(selectedRound.startTime).toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "8px 0", color: "#6b7280" }}>End Time:</td>
                      <td style={{ padding: "8px 0" }}>{new Date(selectedRound.endTime).toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "8px 0", color: "#6b7280" }}>Duration:</td>
                      <td style={{ padding: "8px 0" }}>{formatDuration(selectedRound.startTime, selectedRound.endTime)}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "8px 0", color: "#6b7280" }}>Seed ETH:</td>
                      <td style={{ padding: "8px 0" }}>{formatEth(selectedRound.seedEth)} ETH</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "8px 0", color: "#6b7280" }}>Final Jackpot:</td>
                      <td style={{ padding: "8px 0", fontWeight: 600 }}>{formatEth(selectedRound.finalJackpotEth)} ETH</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "8px 0", color: "#6b7280" }}>Salt:</td>
                      <td style={{ padding: "8px 0", fontFamily: "monospace", fontSize: "12px", wordBreak: "break-all" }}>{selectedRound.salt}</td>
                    </tr>
                  </tbody>
                </table>

                <h4 style={{ margin: "24px 0 16px 0" }}>Winner Details</h4>
                <table style={{ width: "100%", fontSize: "14px" }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: "8px 0", color: "#6b7280" }}>Winner FID:</td>
                      <td style={{ padding: "8px 0" }}>{selectedRound.winnerFid || 'N/A'}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "8px 0", color: "#6b7280" }}>Winning Guess #:</td>
                      <td style={{ padding: "8px 0" }}>{selectedRound.winnerGuessNumber || 'N/A'}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "8px 0", color: "#6b7280" }}>Referrer FID:</td>
                      <td style={{ padding: "8px 0" }}>{selectedRound.referrerFid || 'None'}</td>
                    </tr>
                    {selectedRound.winnerCastHash && (
                      <tr>
                        <td style={{ padding: "8px 0", color: "#6b7280" }}>Cast Hash:</td>
                        <td style={{ padding: "8px 0", fontFamily: "monospace", fontSize: "12px" }}>{selectedRound.winnerCastHash}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Right Column - Payouts & Stats */}
              <div>
                <h4 style={{ margin: "0 0 16px 0" }}>Payouts</h4>
                {selectedRound.payoutsJson && (
                  <div style={{ background: "#f9fafb", borderRadius: "8px", padding: "16px" }}>
                    {selectedRound.payoutsJson.winner && (
                      <div style={{ marginBottom: "8px" }}>
                        <strong>Winner (FID {selectedRound.payoutsJson.winner.fid}):</strong>{' '}
                        {formatEth(selectedRound.payoutsJson.winner.amountEth)} ETH
                      </div>
                    )}
                    {selectedRound.payoutsJson.referrer && (
                      <div style={{ marginBottom: "8px" }}>
                        <strong>Referrer (FID {selectedRound.payoutsJson.referrer.fid}):</strong>{' '}
                        {formatEth(selectedRound.payoutsJson.referrer.amountEth)} ETH
                      </div>
                    )}
                    {selectedRound.payoutsJson.topGuessers?.length > 0 && (
                      <div style={{ marginBottom: "8px" }}>
                        <strong>Top Guessers ({selectedRound.payoutsJson.topGuessers.length}):</strong>
                        <ul style={{ margin: "4px 0 0 20px", padding: 0 }}>
                          {selectedRound.payoutsJson.topGuessers.map((g: any, idx: number) => (
                            <li key={idx}>#{g.rank} FID {g.fid}: {formatEth(g.amountEth)} ETH</li>
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

                <h4 style={{ margin: "24px 0 16px 0" }}>Round Stats</h4>
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "12px",
                }}>
                  <div style={{ background: "#f9fafb", borderRadius: "8px", padding: "12px", textAlign: "center" }}>
                    <div style={{ fontSize: "24px", fontWeight: 600 }}>{selectedRound.totalGuesses.toLocaleString()}</div>
                    <div style={{ fontSize: "12px", color: "#6b7280" }}>Total Guesses</div>
                  </div>
                  <div style={{ background: "#f9fafb", borderRadius: "8px", padding: "12px", textAlign: "center" }}>
                    <div style={{ fontSize: "24px", fontWeight: 600 }}>{selectedRound.uniquePlayers}</div>
                    <div style={{ fontSize: "12px", color: "#6b7280" }}>Unique Players</div>
                  </div>
                  <div style={{ background: "#f9fafb", borderRadius: "8px", padding: "12px", textAlign: "center" }}>
                    <div style={{ fontSize: "24px", fontWeight: 600 }}>{selectedRound.clanktonBonusCount}</div>
                    <div style={{ fontSize: "12px", color: "#6b7280" }}>CLANKTON Bonuses</div>
                  </div>
                  <div style={{ background: "#f9fafb", borderRadius: "8px", padding: "12px", textAlign: "center" }}>
                    <div style={{ fontSize: "24px", fontWeight: 600 }}>{selectedRound.referralBonusCount}</div>
                    <div style={{ fontSize: "12px", color: "#6b7280" }}>Referral Signups</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Guess Distribution Histogram */}
            {distribution && distribution.distribution.length > 0 && (
              <div style={{ marginTop: "24px" }}>
                <AnalyticsChart
                  data={distribution.distribution.map((d: any) => ({
                    hour: `${d.hour}:00`,
                    "Guesses": d.count
                  }))}
                  type="bar"
                  dataKey="Guesses"
                  xAxisKey="hour"
                  title="Guess Distribution by Hour"
                  colors={["#8b5cf6"]}
                />
              </div>
            )}

            {/* Top Guessers */}
            {distribution && distribution.byPlayer.length > 0 && (
              <div style={{ marginTop: "24px" }}>
                <h4 style={{ margin: "0 0 16px 0" }}>Top Guessers This Round</h4>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                      <th style={{ padding: "8px", textAlign: "left" }}>#</th>
                      <th style={{ padding: "8px", textAlign: "left" }}>FID</th>
                      <th style={{ padding: "8px", textAlign: "right" }}>Guesses</th>
                    </tr>
                  </thead>
                  <tbody>
                    {distribution.byPlayer.slice(0, 10).map((p: any, idx: number) => (
                      <tr key={idx} style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <td style={{ padding: "8px" }}>{idx + 1}</td>
                        <td style={{ padding: "8px" }}>{p.fid}</td>
                        <td style={{ padding: "8px", textAlign: "right" }}>{p.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <button
              onClick={() => { setSelectedRound(null); setDistribution(null); }}
              style={{
                marginTop: "24px",
                padding: "8px 16px",
                background: "#6b7280",
                color: "white",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
              }}
            >
              Close Details
            </button>
          </AdminSection>
        )}
      </div>
    </main>
  )
}

export default function ArchivePage() {
  return (
    <AdminAuthWrapper>
      <ArchiveDashboard />
    </AdminAuthWrapper>
  )
}

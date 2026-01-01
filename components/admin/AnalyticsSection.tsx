/**
 * Analytics Section Component
 * Full analytics dashboard for unified admin page
 */

import React, { useState, useEffect, useCallback, useRef } from "react"
import { AnalyticsChart } from "./AnalyticsChart"
import { AnalyticsControls, TimeRange } from "./AnalyticsControls"

// =============================================================================
// Types
// =============================================================================

interface AnalyticsSectionProps {
  user?: {
    fid: number
    username: string
    display_name?: string
    pfp_url?: string
  }
}

interface DashboardSummary {
  today: { dau: number; packPurchases: number; paidGuesses: number; revenueEth: number }
  avg7d: { dau: number; packPurchases: number; paidGuesses: number; revenueEth: number }
  currentRound: {
    roundId: number | null
    prizePoolEth: string
    totalGuesses: number
    pricingPhase: string
    pricingPhaseLabel: string
    packPriceEth: string
    top10Locked: boolean
    guessesToLock: number
    eligibleGuesses: number
    ineligibleGuesses: number
    startedAt: string | null
  }
}

interface PackPricingAnalytics {
  currentPhase: string
  currentPhaseLabel: string
  currentPackPriceEth: string
  totalGuessesInRound: number
  last24h: {
    base: { count: number; revenueEth: number; buyers: number }
    late1: { count: number; revenueEth: number; buyers: number }
    late2: { count: number; revenueEth: number; buyers: number }
    total: { count: number; revenueEth: number; buyers: number }
  }
  last7d: {
    base: { count: number; revenueEth: number; buyers: number }
    late1: { count: number; revenueEth: number; buyers: number }
    late2: { count: number; revenueEth: number; buyers: number }
    total: { count: number; revenueEth: number; buyers: number }
  }
  phaseDistribution24h: { base: number; late1: number; late2: number }
  phaseDistribution7d: { base: number; late1: number; late2: number }
  earlyRoundReinforcementCount: number
  avgPacksPerEarlyBuyer: number
}

interface DAUData {
  day: string
  active_users: number
}

interface GuessData {
  day: string
  free_guesses: number
  paid_guesses: number
}

// =============================================================================
// Styling
// =============================================================================

const fontFamily = "'Söhne', 'SF Pro Display', system-ui, -apple-system, sans-serif"

const styles = {
  grid: {
    display: "grid" as const,
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "16px",
    marginBottom: "24px",
  },
  statCard: {
    background: "white",
    borderRadius: "12px",
    border: "1px solid #e5e7eb",
    padding: "20px",
  },
  statLabel: {
    fontSize: "12px",
    color: "#6b7280",
    marginBottom: "4px",
    fontFamily,
  },
  statValue: {
    fontSize: "28px",
    fontWeight: 700,
    color: "#111827",
    fontFamily,
  },
  statSubtext: {
    fontSize: "12px",
    color: "#9ca3af",
    marginTop: "4px",
    fontFamily,
  },
  section: {
    background: "white",
    borderRadius: "12px",
    border: "1px solid #e5e7eb",
    padding: "24px",
    marginBottom: "24px",
  },
  sectionTitle: {
    fontSize: "16px",
    fontWeight: 600,
    color: "#111827",
    margin: "0 0 16px 0",
    fontFamily,
  },
  chartContainer: {
    height: "300px",
    marginTop: "16px",
  },
  controlsRow: {
    display: "flex" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
    marginBottom: "24px",
    flexWrap: "wrap" as const,
    gap: "12px",
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
  phaseGrid: {
    display: "grid" as const,
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "12px",
    marginTop: "12px",
  },
  phaseCard: (isActive: boolean) => ({
    padding: "16px",
    borderRadius: "8px",
    background: isActive ? "#f0fdf4" : "#f9fafb",
    border: `1px solid ${isActive ? "#86efac" : "#e5e7eb"}`,
  }),
}

// =============================================================================
// Analytics Section Component
// =============================================================================

export default function AnalyticsSection({ user }: AnalyticsSectionProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>("7d")
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [packPricing, setPackPricing] = useState<PackPricingAnalytics | null>(null)
  const [dauData, setDauData] = useState<DAUData[]>([])
  const [guessData, setGuessData] = useState<GuessData[]>([])

  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const fetchAnalytics = useCallback(async () => {
    if (!user?.fid) return

    try {
      setLoading(true)
      setError(null)

      const [summaryRes, packPricingRes, dauRes, guessRes] = await Promise.all([
        fetch(`/api/admin/analytics/dashboard-summary?devFid=${user.fid}`),
        fetch(`/api/admin/analytics/pack-pricing?devFid=${user.fid}`),
        fetch(`/api/admin/analytics/dau?devFid=${user.fid}&range=${timeRange}`),
        fetch(`/api/admin/analytics/free-paid?devFid=${user.fid}&range=${timeRange}`),
      ])

      if (!summaryRes.ok) throw new Error("Failed to fetch summary")
      if (!packPricingRes.ok) throw new Error("Failed to fetch pack pricing")

      const summaryData = await summaryRes.json()
      const packPricingData = await packPricingRes.json()
      const dauDataResult = dauRes.ok ? await dauRes.json() : []
      const guessDataResult = guessRes.ok ? await guessRes.json() : []

      setSummary(summaryData)
      setPackPricing(packPricingData)
      setDauData(dauDataResult.data || [])
      setGuessData(guessDataResult.data || [])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [user?.fid, timeRange])

  useEffect(() => {
    fetchAnalytics()
  }, [fetchAnalytics])

  useEffect(() => {
    if (autoRefresh) {
      refreshIntervalRef.current = setInterval(fetchAnalytics, 30000)
    } else if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current)
      refreshIntervalRef.current = null
    }
    return () => {
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current)
    }
  }, [autoRefresh, fetchAnalytics])

  const dauChartData = [...dauData].reverse().map(d => ({
    day: new Date(d.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    "Active Users": d.active_users
  }))

  const guessChartData = [...guessData].reverse().map(d => ({
    day: new Date(d.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    "Free": d.free_guesses,
    "Paid": d.paid_guesses
  }))

  if (loading && !summary) {
    return <div style={styles.loading}>Loading analytics...</div>
  }

  if (error) {
    return <div style={styles.error}>{error}</div>
  }

  return (
    <div>
      {/* Controls */}
      <div style={styles.controlsRow}>
        <AnalyticsControls
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
          autoRefresh={autoRefresh}
          onAutoRefreshChange={setAutoRefresh}
          onRefresh={fetchAnalytics}
          loading={loading}
        />
      </div>

      {/* Top Summary Row */}
      {summary && (
        <div style={styles.grid}>
          <div style={styles.statCard}>
            <div style={styles.statLabel}>DAU Today</div>
            <div style={styles.statValue}>{summary.today.dau.toLocaleString()}</div>
            <div style={styles.statSubtext}>7d avg: {summary.avg7d.dau.toFixed(0)}</div>
          </div>
          <div style={styles.statCard}>
            <div style={styles.statLabel}>Pack Purchases Today</div>
            <div style={styles.statValue}>{summary.today.packPurchases.toLocaleString()}</div>
            <div style={styles.statSubtext}>7d avg: {summary.avg7d.packPurchases.toFixed(1)}</div>
          </div>
          <div style={styles.statCard}>
            <div style={styles.statLabel}>Paid Guesses Today</div>
            <div style={styles.statValue}>{summary.today.paidGuesses.toLocaleString()}</div>
            <div style={styles.statSubtext}>7d avg: {summary.avg7d.paidGuesses.toFixed(1)}</div>
          </div>
          <div style={styles.statCard}>
            <div style={styles.statLabel}>Revenue Today</div>
            <div style={styles.statValue}>{summary.today.revenueEth.toFixed(4)} ETH</div>
            <div style={styles.statSubtext}>7d avg: {summary.avg7d.revenueEth.toFixed(4)} ETH</div>
          </div>
        </div>
      )}

      {/* Current Round Status */}
      {summary?.currentRound && summary.currentRound.roundId && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Current Round #{summary.currentRound.roundId}</h3>
          <div style={styles.grid}>
            <div>
              <div style={styles.statLabel}>Prize Pool</div>
              <div style={{ fontSize: "24px", fontWeight: 700, color: "#16a34a" }}>
                {parseFloat(summary.currentRound.prizePoolEth).toFixed(4)} ETH
              </div>
            </div>
            <div>
              <div style={styles.statLabel}>Total Guesses</div>
              <div style={{ fontSize: "24px", fontWeight: 700, color: "#111827" }}>
                {summary.currentRound.totalGuesses.toLocaleString()}
              </div>
            </div>
            <div>
              <div style={styles.statLabel}>Pricing Phase</div>
              <div style={{ fontSize: "18px", fontWeight: 600, color: "#6366f1" }}>
                {summary.currentRound.pricingPhaseLabel}
              </div>
              <div style={{ fontSize: "13px", color: "#6b7280" }}>
                {summary.currentRound.packPriceEth} ETH/pack
              </div>
            </div>
            <div>
              <div style={styles.statLabel}>Top 10 Status</div>
              <div style={{ fontSize: "18px", fontWeight: 600, color: summary.currentRound.top10Locked ? "#16a34a" : "#d97706" }}>
                {summary.currentRound.top10Locked ? "Locked" : `${summary.currentRound.guessesToLock} to lock`}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pack Pricing Analytics */}
      {packPricing && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Pack Purchases by Phase (Last 24h)</h3>
          <div style={styles.phaseGrid}>
            <div style={styles.phaseCard(packPricing.currentPhase === 'base')}>
              <div style={{ fontSize: "13px", color: "#6b7280" }}>Base Price</div>
              <div style={{ fontSize: "24px", fontWeight: 700, color: "#111827" }}>
                {packPricing.last24h.base.count}
              </div>
              <div style={{ fontSize: "12px", color: "#16a34a" }}>
                {packPricing.last24h.base.revenueEth.toFixed(4)} ETH
              </div>
            </div>
            <div style={styles.phaseCard(packPricing.currentPhase === 'late1')}>
              <div style={{ fontSize: "13px", color: "#6b7280" }}>Late Stage 1</div>
              <div style={{ fontSize: "24px", fontWeight: 700, color: "#111827" }}>
                {packPricing.last24h.late1.count}
              </div>
              <div style={{ fontSize: "12px", color: "#16a34a" }}>
                {packPricing.last24h.late1.revenueEth.toFixed(4)} ETH
              </div>
            </div>
            <div style={styles.phaseCard(packPricing.currentPhase === 'late2')}>
              <div style={{ fontSize: "13px", color: "#6b7280" }}>Late Stage 2</div>
              <div style={{ fontSize: "24px", fontWeight: 700, color: "#111827" }}>
                {packPricing.last24h.late2.count}
              </div>
              <div style={{ fontSize: "12px", color: "#16a34a" }}>
                {packPricing.last24h.late2.revenueEth.toFixed(4)} ETH
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DAU Chart */}
      {dauChartData.length > 0 && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Daily Active Users</h3>
          <div style={styles.chartContainer}>
            <AnalyticsChart
              data={dauChartData}
              type="line"
              xKey="day"
              yKeys={["Active Users"]}
              colors={["#6366f1"]}
            />
          </div>
        </div>
      )}

      {/* Guesses Chart */}
      {guessChartData.length > 0 && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Free vs Paid Guesses</h3>
          <div style={styles.chartContainer}>
            <AnalyticsChart
              data={guessChartData}
              type="bar"
              xKey="day"
              yKeys={["Free", "Paid"]}
              colors={["#94a3b8", "#6366f1"]}
              stacked
            />
          </div>
        </div>
      )}

    </div>
  )
}

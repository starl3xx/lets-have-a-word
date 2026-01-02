/**
 * Analytics Section Component
 * Comprehensive analytics dashboard for unified admin page
 * Includes all modules from /admin/analytics plus Status Cast Generator
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

interface TopGuesser {
  fid: number
  username: string | null
  guessCount: number
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

interface OnboardingAnalytics {
  howItWorksViewed: number
  howItWorksCompleted: number
  addAppViewed: number
  addAppAccepted: number
  addAppSkipped: number
  flowCompleted: number
  tutorialCompletionRate: number
  addAppAcceptRate: number
  addAppSkipRate: number
  overallCompletionRate: number
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

interface EconomyAnalytics {
  packAttachRate: number
  packPurchaseCount: number
  arpdau: number
  arppu: number
  avgJackpot7Day: number
  prizePoolSustainabilityScore: number
  jackpotTrend: Array<{ day: string; avg_jackpot: number; winners: number }>
  packSalesTrend: Array<{ day: string; packs_sold: number; revenue_eth: number }>
}

interface GameplayInsights {
  solveRate: number
  medianGuessesToSolve: number
  hardestWords: Array<{ word: string; solveRate: number }>
  guessDistribution: Array<{ guessCount: number; rounds: number }>
}

interface SimulationResult {
  simulationId: string
  type: string
  status: 'success' | 'warning' | 'critical' | 'error'
  summary: string
  executionTimeMs?: number
  result?: { status: string; summary: string }
}

// =============================================================================
// Styling
// =============================================================================

const fontFamily = "'Söhne', 'SF Pro Display', system-ui, -apple-system, sans-serif"

const styles = {
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
  section: {
    background: "white",
    borderRadius: "12px",
    border: "1px solid #e5e7eb",
    padding: "24px",
    marginBottom: "24px",
  },
  sectionTitle: {
    fontSize: "15px",
    fontWeight: 600,
    color: "#111827",
    margin: "0 0 16px 0",
    letterSpacing: "-0.01em",
    fontFamily,
  },
  chartContainer: {
    height: "250px",
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
  badge: {
    display: "inline-block",
    padding: "4px 10px",
    borderRadius: "6px",
    fontSize: "12px",
    fontWeight: 600,
  },
  badgeGreen: {
    background: "#dcfce7",
    color: "#166534",
  },
  badgeYellow: {
    background: "#fef3c7",
    color: "#92400e",
  },
  badgeRed: {
    background: "#fee2e2",
    color: "#991b1b",
  },
  badgeBlue: {
    background: "#dbeafe",
    color: "#1e40af",
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

function Module({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={styles.section}>
      <h3 style={styles.sectionTitle}>{title}</h3>
      {children}
    </div>
  )
}

function formatEth(value: number | string, decimals = 4): string {
  const num = typeof value === 'string' ? parseFloat(value) : value
  if (isNaN(num)) return '0'
  return num.toFixed(decimals)
}

function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`
}

function formatNumber(value: number): string {
  return value.toLocaleString()
}

// =============================================================================
// Analytics Section Component
// =============================================================================

export default function AnalyticsSection({ user }: AnalyticsSectionProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>("7d")
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Data
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [packPricing, setPackPricing] = useState<PackPricingAnalytics | null>(null)
  const [onboarding, setOnboarding] = useState<OnboardingAnalytics | null>(null)
  const [dauData, setDauData] = useState<DAUData[]>([])
  const [guessData, setGuessData] = useState<GuessData[]>([])
  const [economyAnalytics, setEconomyAnalytics] = useState<EconomyAnalytics | null>(null)
  const [gameplayInsights, setGameplayInsights] = useState<GameplayInsights | null>(null)
  const [simulationResults, setSimulationResults] = useState<SimulationResult[]>([])
  const [runningSimulation, setRunningSimulation] = useState<string | null>(null)

  // Status cast generator state
  const [statusCastText, setStatusCastText] = useState<string>("")
  const [statusCastLoading, setStatusCastLoading] = useState(false)
  const [statusCastCopied, setStatusCastCopied] = useState(false)

  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const filterByTimeRange = (data: any[], range: TimeRange) => {
    if (range === "all") return data
    const daysBack = range === "7d" ? 7 : 30
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - daysBack)
    return data.filter(item => {
      const itemDate = new Date(item.day || item.week_start)
      return itemDate >= cutoffDate
    })
  }

  const fetchAnalytics = useCallback(async () => {
    if (!user?.fid) return

    try {
      setLoading(true)
      setError(null)

      const devFidParam = `?devFid=${user.fid}`
      const rangeParam = `&range=${timeRange}`

      const [
        summaryRes,
        packPricingRes,
        onboardingRes,
        dauRes,
        guessRes,
        economyRes,
        gameplayRes,
      ] = await Promise.all([
        fetch(`/api/admin/analytics/dashboard-summary${devFidParam}`),
        fetch(`/api/admin/analytics/pack-pricing${devFidParam}`),
        fetch(`/api/admin/analytics/onboarding${devFidParam}${rangeParam}`),
        fetch(`/api/admin/analytics/dau${devFidParam}`),
        fetch(`/api/admin/analytics/free-paid${devFidParam}`),
        fetch(`/api/admin/analytics/economy${devFidParam}${rangeParam}`),
        fetch(`/api/admin/analytics/gameplay${devFidParam}${rangeParam}`),
      ])

      if (summaryRes.ok) setSummary(await summaryRes.json())
      if (packPricingRes.ok) setPackPricing(await packPricingRes.json())
      if (onboardingRes.ok) setOnboarding(await onboardingRes.json())
      if (dauRes.ok) {
        const dau = await dauRes.json()
        setDauData(filterByTimeRange(dau.data || dau, timeRange))
      }
      if (guessRes.ok) {
        const guesses = await guessRes.json()
        setGuessData(filterByTimeRange(guesses.data || guesses, timeRange))
      }
      if (economyRes.ok) setEconomyAnalytics(await economyRes.json())
      if (gameplayRes.ok) setGameplayInsights(await gameplayRes.json())

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

  // Run simulation function
  const runSimulation = async (type: string) => {
    if (!user?.fid) return
    setRunningSimulation(type)

    try {
      const response = await fetch(`/api/admin/analytics/simulations?devFid=${user.fid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      })

      if (response.ok) {
        const result = await response.json()
        setSimulationResults(prev => [result, ...prev.slice(0, 9)])
      }
    } catch (err) {
      console.error('Simulation failed:', err)
    } finally {
      setRunningSimulation(null)
    }
  }

  // Status cast generator function
  const generateStatusCast = useCallback(async () => {
    if (!summary?.currentRound?.roundId) {
      setStatusCastText("No active round found.")
      return
    }

    setStatusCastLoading(true)
    setStatusCastCopied(false)

    try {
      const response = await fetch(`/api/round/top-guessers`)
      const topGuessersData = response.ok ? await response.json() : { topGuessers: [], uniqueGuessersCount: 0 }

      const round = summary.currentRound
      const roundNumber = round.roundId
      const prizePool = parseFloat(round.prizePoolEth).toFixed(4)
      const globalGuesses = round.totalGuesses.toLocaleString()
      const playerCount = topGuessersData.uniqueGuessersCount?.toLocaleString() || "0"

      let topGuessersStr = ""
      if (topGuessersData.topGuessers && topGuessersData.topGuessers.length > 0) {
        const guessers = topGuessersData.topGuessers.slice(0, 10)

        const grouped: { count: number; usernames: string[] }[] = []
        for (const g of guessers) {
          const username = `@${g.username || `fid:${g.fid}`}`
          const lastGroup = grouped[grouped.length - 1]
          if (lastGroup && lastGroup.count === g.guessCount) {
            lastGroup.usernames.push(username)
          } else {
            grouped.push({ count: g.guessCount, usernames: [username] })
          }
        }

        topGuessersStr = grouped
          .map(g => `${g.usernames.join(" ")} (${g.count})`)
          .join(" ")
      }

      const castText = `@letshaveaword status
🔵 Round: #${roundNumber}
💰 Prize pool: ${prizePool} ETH
🎯 Global guesses: ${globalGuesses}
👥 Players: ${playerCount}
🏆 Top early guessers: ${topGuessersStr || "N/A"}
🏅 Mini app rank: #`

      setStatusCastText(castText)
    } catch (err) {
      console.error("[AnalyticsSection] Error generating status cast:", err)
      setStatusCastText("Error generating status cast. Please try again.")
    } finally {
      setStatusCastLoading(false)
    }
  }, [summary])

  const copyStatusCast = useCallback(async () => {
    if (!statusCastText) return

    try {
      await navigator.clipboard.writeText(statusCastText)
      setStatusCastCopied(true)
      setTimeout(() => setStatusCastCopied(false), 2000)
    } catch (err) {
      console.error("[AnalyticsSection] Failed to copy to clipboard:", err)
    }
  }, [statusCastText])

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

      {/* ================================================================== */}
      {/* TOP SUMMARY ROW */}
      {/* ================================================================== */}
      <Module title="Summary">
        <div style={{ ...styles.grid, gridTemplateColumns: "repeat(5, 1fr)" }}>
          <StatCard
            label="DAU Today"
            value={summary?.today.dau || 0}
            subtext={`7d avg: ${Math.round(summary?.avg7d.dau || 0)}`}
            loading={loading}
          />
          <StatCard
            label="Pack Purchases"
            value={summary?.today.packPurchases || 0}
            subtext={`7d avg: ${(summary?.avg7d.packPurchases || 0).toFixed(1)}`}
            loading={loading}
          />
          <StatCard
            label="Paid Guesses"
            value={summary?.today.paidGuesses || 0}
            subtext={`7d avg: ${(summary?.avg7d.paidGuesses || 0).toFixed(1)}`}
            loading={loading}
          />
          <StatCard
            label="Revenue Today"
            value={`${formatEth(summary?.today.revenueEth || 0)} ETH`}
            subtext={`7d avg: ${formatEth(summary?.avg7d.revenueEth || 0)} ETH`}
            loading={loading}
          />
          <StatCard
            label="Current Round"
            value={summary?.currentRound.roundId ? `#${summary.currentRound.roundId}` : 'None'}
            subtext={`${formatEth(summary?.currentRound.prizePoolEth || '0')} ETH prize`}
            loading={loading}
          />
        </div>
      </Module>

      {/* ================================================================== */}
      {/* ROUND PHASE & INCENTIVES MODULE */}
      {/* ================================================================== */}
      <Module title="Round Phase & Incentives">
        <div style={{ ...styles.grid, gridTemplateColumns: "repeat(4, 1fr)", marginBottom: "16px" }}>
          <div style={styles.statCard}>
            <div style={styles.statLabel}>Pricing Phase</div>
            <div style={{ marginTop: "8px" }}>
              <span style={{
                ...styles.badge,
                ...(summary?.currentRound.pricingPhase === 'BASE' ? styles.badgeGreen :
                    summary?.currentRound.pricingPhase === 'LATE_1' ? styles.badgeYellow : styles.badgeRed)
              }}>
                {summary?.currentRound.pricingPhaseLabel || 'Unknown'}
              </span>
            </div>
          </div>
          <StatCard
            label="Total Guesses"
            value={formatNumber(summary?.currentRound.totalGuesses || 0)}
            loading={loading}
          />
          <div style={styles.statCard}>
            <div style={styles.statLabel}>Top 10 Lock</div>
            <div style={{ marginTop: "8px" }}>
              {summary?.currentRound.top10Locked ? (
                <span style={{ ...styles.badge, ...styles.badgeBlue }}>Locked</span>
              ) : (
                <span style={{ ...styles.badge, ...styles.badgeGreen }}>
                  {summary?.currentRound.guessesToLock || 0} to lock
                </span>
              )}
            </div>
          </div>
          <StatCard
            label="Pack Price"
            value={`${summary?.currentRound.packPriceEth || '0.0003'} ETH`}
            loading={loading}
          />
        </div>
        <div style={{ ...styles.grid, gridTemplateColumns: "repeat(2, 1fr)" }}>
          <StatCard
            label="Eligible Guesses (≤750)"
            value={formatNumber(summary?.currentRound.eligibleGuesses || 0)}
            subtext="Can place in Top 10"
            loading={loading}
          />
          <StatCard
            label="Ineligible Guesses (>750)"
            value={formatNumber(summary?.currentRound.ineligibleGuesses || 0)}
            subtext="Cannot place in Top 10"
            loading={loading}
          />
        </div>
      </Module>

      {/* ================================================================== */}
      {/* PACK PRICING MODULE */}
      {/* ================================================================== */}
      <Module title="Pack Pricing Analytics">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
          {/* Last 24h */}
          <div>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "12px", fontFamily }}>Last 24 hours</div>
            <div style={{ ...styles.grid, gridTemplateColumns: "repeat(3, 1fr)" }}>
              <div style={{ ...styles.statCard, borderLeft: "3px solid #10b981" }}>
                <div style={styles.statLabel}>Early (BASE)</div>
                <div style={styles.statValue}>{packPricing?.last24h.base.count || 0}</div>
                <div style={styles.statSubtext}>{formatEth(packPricing?.last24h.base.revenueEth || 0)} ETH</div>
              </div>
              <div style={{ ...styles.statCard, borderLeft: "3px solid #f59e0b" }}>
                <div style={styles.statLabel}>Late (LATE_1)</div>
                <div style={styles.statValue}>{packPricing?.last24h.late1.count || 0}</div>
                <div style={styles.statSubtext}>{formatEth(packPricing?.last24h.late1.revenueEth || 0)} ETH</div>
              </div>
              <div style={{ ...styles.statCard, borderLeft: "3px solid #ef4444" }}>
                <div style={styles.statLabel}>Capped (LATE_2)</div>
                <div style={styles.statValue}>{packPricing?.last24h.late2.count || 0}</div>
                <div style={styles.statSubtext}>{formatEth(packPricing?.last24h.late2.revenueEth || 0)} ETH</div>
              </div>
            </div>
          </div>
          {/* Last 7d */}
          <div>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "12px", fontFamily }}>Last 7 days</div>
            <div style={{ ...styles.grid, gridTemplateColumns: "repeat(3, 1fr)" }}>
              <div style={{ ...styles.statCard, borderLeft: "3px solid #10b981" }}>
                <div style={styles.statLabel}>Early (BASE)</div>
                <div style={styles.statValue}>{packPricing?.last7d.base.count || 0}</div>
                <div style={styles.statSubtext}>{formatPercent(packPricing?.phaseDistribution7d.base || 0)} of total</div>
              </div>
              <div style={{ ...styles.statCard, borderLeft: "3px solid #f59e0b" }}>
                <div style={styles.statLabel}>Late (LATE_1)</div>
                <div style={styles.statValue}>{packPricing?.last7d.late1.count || 0}</div>
                <div style={styles.statSubtext}>{formatPercent(packPricing?.phaseDistribution7d.late1 || 0)} of total</div>
              </div>
              <div style={{ ...styles.statCard, borderLeft: "3px solid #ef4444" }}>
                <div style={styles.statLabel}>Capped (LATE_2)</div>
                <div style={styles.statValue}>{packPricing?.last7d.late2.count || 0}</div>
                <div style={styles.statSubtext}>{formatPercent(packPricing?.phaseDistribution7d.late2 || 0)} of total</div>
              </div>
            </div>
          </div>
        </div>
        <div style={{ ...styles.grid, gridTemplateColumns: "repeat(3, 1fr)", marginTop: "16px" }}>
          <StatCard
            label="Total 7d Revenue"
            value={`${formatEth((packPricing?.last7d.base.revenueEth || 0) + (packPricing?.last7d.late1.revenueEth || 0) + (packPricing?.last7d.late2.revenueEth || 0))} ETH`}
            loading={loading}
          />
          <StatCard
            label="Early Reinforcement Shown"
            value={packPricing?.earlyRoundReinforcementCount || 0}
            subtext="Last 7 days"
            loading={loading}
          />
          <StatCard
            label="Avg Packs/Early Buyer"
            value={(packPricing?.avgPacksPerEarlyBuyer || 0).toFixed(2)}
            loading={loading}
          />
        </div>
      </Module>

      {/* ================================================================== */}
      {/* ONBOARDING FUNNEL MODULE */}
      {/* ================================================================== */}
      <Module title="Onboarding Funnel">
        <div style={{ ...styles.grid, gridTemplateColumns: "repeat(6, 1fr)" }}>
          <StatCard
            label="Tutorial Viewed"
            value={onboarding?.howItWorksViewed || 0}
            loading={loading}
          />
          <StatCard
            label="Tutorial Completed"
            value={onboarding?.howItWorksCompleted || 0}
            subtext={`${formatPercent(onboarding?.tutorialCompletionRate || 0)} rate`}
            loading={loading}
          />
          <StatCard
            label="Add App Shown"
            value={onboarding?.addAppViewed || 0}
            loading={loading}
          />
          <StatCard
            label="Add App Accepted"
            value={onboarding?.addAppAccepted || 0}
            subtext={`${formatPercent(onboarding?.addAppAcceptRate || 0)} rate`}
            loading={loading}
          />
          <StatCard
            label="Add App Skipped"
            value={onboarding?.addAppSkipped || 0}
            subtext={`${formatPercent(onboarding?.addAppSkipRate || 0)} rate`}
            loading={loading}
          />
          <StatCard
            label="Flow Completed"
            value={onboarding?.flowCompleted || 0}
            subtext={`${formatPercent(onboarding?.overallCompletionRate || 0)} overall`}
            loading={loading}
          />
        </div>
      </Module>

      {/* ================================================================== */}
      {/* DAU CHART */}
      {/* ================================================================== */}
      {dauChartData.length > 0 && (
        <Module title="Daily Active Users">
          <div style={styles.chartContainer}>
            <AnalyticsChart
              data={dauChartData}
              type="line"
              xKey="day"
              yKeys={["Active Users"]}
              colors={["#6366f1"]}
            />
          </div>
        </Module>
      )}

      {/* ================================================================== */}
      {/* GUESSES CHART */}
      {/* ================================================================== */}
      {guessChartData.length > 0 && (
        <Module title="Free vs Paid Guesses">
          <div style={styles.chartContainer}>
            <AnalyticsChart
              data={guessChartData}
              type="bar"
              xKey="day"
              yKeys={["Free", "Paid"]}
              colors={["#10b981", "#f59e0b"]}
              stacked
            />
          </div>
        </Module>
      )}

      {/* ================================================================== */}
      {/* ECONOMY MODULE */}
      {/* ================================================================== */}
      <Module title="Economy & Revenue">
        <div style={{ ...styles.grid, gridTemplateColumns: "repeat(4, 1fr)" }}>
          <StatCard
            label="ARPDAU"
            value={`${formatEth(economyAnalytics?.arpdau || 0, 6)} ETH`}
            subtext="Avg revenue per DAU"
            loading={loading}
          />
          <StatCard
            label="ARPPU"
            value={`${formatEth(economyAnalytics?.arppu || 0, 6)} ETH`}
            subtext="Avg revenue per paying user"
            loading={loading}
          />
          <StatCard
            label="Pack Attach Rate"
            value={formatPercent(economyAnalytics?.packAttachRate || 0)}
            subtext="Users who purchase"
            loading={loading}
          />
          <StatCard
            label="7d Avg Jackpot"
            value={`${formatEth(economyAnalytics?.avgJackpot7Day || 0)} ETH`}
            loading={loading}
          />
        </div>
      </Module>

      {/* ================================================================== */}
      {/* GAMEPLAY INSIGHTS */}
      {/* ================================================================== */}
      <Module title="Gameplay Insights">
        <div style={{ ...styles.grid, gridTemplateColumns: "repeat(3, 1fr)", marginBottom: "16px" }}>
          <StatCard
            label="Solve Rate"
            value={formatPercent(gameplayInsights?.solveRate || 0)}
            loading={loading}
          />
          <StatCard
            label="Median Guesses to Solve"
            value={(gameplayInsights?.medianGuessesToSolve || 0).toFixed(1)}
            loading={loading}
          />
          <StatCard
            label="Hardest Word"
            value={gameplayInsights?.hardestWords?.[0]?.word || 'N/A'}
            subtext={gameplayInsights?.hardestWords?.[0] ? `${formatPercent(gameplayInsights.hardestWords[0].solveRate)} solve rate` : ''}
            loading={loading}
          />
        </div>
        {gameplayInsights?.guessDistribution && gameplayInsights.guessDistribution.length > 0 && (
          <div style={styles.chartContainer}>
            <AnalyticsChart
              data={gameplayInsights.guessDistribution.map(d => ({
                guesses: `${d.guessCount}`,
                "Rounds": d.rounds
              }))}
              type="bar"
              xKey="guesses"
              yKeys={["Rounds"]}
              colors={["#8b5cf6"]}
            />
          </div>
        )}
      </Module>

      {/* ================================================================== */}
      {/* ADVERSARIAL SIMULATIONS */}
      {/* ================================================================== */}
      <Module title="Adversarial Simulations">
        <div style={{ ...styles.grid, gridTemplateColumns: "repeat(5, 1fr)", marginBottom: "16px" }}>
          <button
            onClick={() => runSimulation('wallet_clustering')}
            disabled={runningSimulation !== null}
            style={{
              padding: "12px 16px",
              background: runningSimulation === 'wallet_clustering' ? "#d1d5db" : "#3b82f6",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: runningSimulation ? "not-allowed" : "pointer",
              fontSize: "13px",
              fontWeight: 500,
              fontFamily,
            }}
          >
            {runningSimulation === 'wallet_clustering' ? 'Running...' : 'Wallet Clustering'}
          </button>
          <button
            onClick={() => runSimulation('rapid_winner')}
            disabled={runningSimulation !== null}
            style={{
              padding: "12px 16px",
              background: runningSimulation === 'rapid_winner' ? "#d1d5db" : "#8b5cf6",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: runningSimulation ? "not-allowed" : "pointer",
              fontSize: "13px",
              fontWeight: 500,
              fontFamily,
            }}
          >
            {runningSimulation === 'rapid_winner' ? 'Running...' : 'Rapid Winner'}
          </button>
          <button
            onClick={() => runSimulation('frontrun_risk')}
            disabled={runningSimulation !== null}
            style={{
              padding: "12px 16px",
              background: runningSimulation === 'frontrun_risk' ? "#d1d5db" : "#f59e0b",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: runningSimulation ? "not-allowed" : "pointer",
              fontSize: "13px",
              fontWeight: 500,
              fontFamily,
            }}
          >
            {runningSimulation === 'frontrun_risk' ? 'Running...' : 'Front-Run Risk'}
          </button>
          <button
            onClick={() => runSimulation('jackpot_runway')}
            disabled={runningSimulation !== null}
            style={{
              padding: "12px 16px",
              background: runningSimulation === 'jackpot_runway' ? "#d1d5db" : "#10b981",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: runningSimulation ? "not-allowed" : "pointer",
              fontSize: "13px",
              fontWeight: 500,
              fontFamily,
            }}
          >
            {runningSimulation === 'jackpot_runway' ? 'Running...' : 'Jackpot Runway'}
          </button>
          <button
            onClick={() => runSimulation('full_suite')}
            disabled={runningSimulation !== null}
            style={{
              padding: "12px 16px",
              background: runningSimulation === 'full_suite' ? "#d1d5db" : "#ef4444",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: runningSimulation ? "not-allowed" : "pointer",
              fontSize: "13px",
              fontWeight: 500,
              fontFamily,
            }}
          >
            {runningSimulation === 'full_suite' ? 'Running...' : 'Full Suite'}
          </button>
        </div>

        {/* Simulation Results */}
        {simulationResults.length > 0 && (
          <div style={{ marginTop: "16px" }}>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "12px", fontFamily }}>Recent Results</div>
            {simulationResults.map((result, idx) => (
              <div key={idx} style={{
                padding: "12px",
                background: result.result?.status === 'critical' ? '#fecaca' :
                  result.result?.status === 'warning' ? '#fef3c7' :
                  result.result?.status === 'error' ? '#fee2e2' : '#d1fae5',
                borderRadius: "8px",
                marginBottom: "8px",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong style={{ fontSize: "13px", fontFamily }}>{result.type}</strong>
                  <span style={{
                    padding: "2px 8px",
                    borderRadius: "4px",
                    fontSize: "11px",
                    fontWeight: 600,
                    background: result.result?.status === 'critical' ? '#ef4444' :
                      result.result?.status === 'warning' ? '#f59e0b' :
                      result.result?.status === 'error' ? '#ef4444' : '#10b981',
                    color: "white",
                  }}>
                    {result.result?.status?.toUpperCase() || 'UNKNOWN'}
                  </span>
                </div>
                <div style={{ fontSize: "12px", marginTop: "8px", color: "#4b5563", fontFamily }}>
                  {result.result?.summary || 'No summary available'}
                </div>
                {result.executionTimeMs && (
                  <div style={{ fontSize: "11px", marginTop: "4px", color: "#9ca3af", fontFamily }}>
                    Completed in {result.executionTimeMs}ms
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Module>

      {/* ================================================================== */}
      {/* STATUS CAST GENERATOR */}
      {/* ================================================================== */}
      <Module title="Status Cast Generator">
        <p style={{ fontSize: "13px", color: "#6b7280", marginBottom: "12px", fontFamily }}>
          Generate a formatted status update for Farcaster with current game stats.
        </p>
        <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
          <button
            onClick={generateStatusCast}
            disabled={statusCastLoading || !summary?.currentRound?.roundId}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              border: "none",
              background: statusCastLoading ? "#d1d5db" : "#6366f1",
              color: "white",
              fontWeight: 500,
              cursor: statusCastLoading ? "not-allowed" : "pointer",
              fontFamily,
            }}
          >
            {statusCastLoading ? "Generating..." : "Generate Status Cast"}
          </button>
          {statusCastText && (
            <button
              onClick={copyStatusCast}
              style={{
                padding: "8px 16px",
                borderRadius: "8px",
                border: "1px solid #e5e7eb",
                background: statusCastCopied ? "#dcfce7" : "white",
                color: statusCastCopied ? "#16a34a" : "#374151",
                fontWeight: 500,
                cursor: "pointer",
                fontFamily,
              }}
            >
              {statusCastCopied ? "Copied!" : "Copy to Clipboard"}
            </button>
          )}
        </div>
        {statusCastText && (
          <textarea
            value={statusCastText}
            readOnly
            style={{
              width: "100%",
              minHeight: "160px",
              padding: "12px",
              borderRadius: "8px",
              border: "1px solid #e5e7eb",
              background: "#f9fafb",
              fontFamily: "monospace",
              fontSize: "13px",
              lineHeight: "1.5",
              resize: "vertical",
            }}
          />
        )}
      </Module>

    </div>
  )
}

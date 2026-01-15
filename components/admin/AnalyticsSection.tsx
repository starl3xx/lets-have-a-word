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
  currentRoundId: number | null
  currentRound: {
    base: { count: number; revenueEth: number; buyers: number }
    late1: { count: number; revenueEth: number; buyers: number }
    late2: { count: number; revenueEth: number; buyers: number }
    total: { count: number; revenueEth: number; buyers: number }
  }
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

interface WAUData {
  week_start: string
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
  hardestWords: Array<{ word: string; roundId: number; solveRate: number; medianGuesses: number }>
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

interface RetentionAnalytics {
  returnRate: number
  yesterdayUsers: number
  returningUsers: number
  wau: number
  mau: number
  stickiness: number
  churnedUsers7d: number
  churnedUsers30d: number
  totalUsers: number
  churnRate7d: number
  powerUsers: number
  powerUserPercentage: number
  dailyRetention: Array<{
    day: string
    returning_users: number
    previous_day_users: number
    return_rate: number
  }>
}

interface CohortData {
  cohort_week: string
  cohort_size: number
  retention: Array<{
    weeks_after: number
    active_users: number
    retention_rate: number
  }>
}

interface CohortAnalytics {
  cohorts: CohortData[]
  totalCohorts: number
  oldestCohort: string
  newestCohort: string
}

interface ShareFunnelAnalytics {
  sharePromptsShown: number
  shareClicks: number
  shareSuccesses: number
  promptToClickRate: number
  clickToSuccessRate: number
  overallConversionRate: number
  totalReferralShares: number
  referralJoins: number
  referralGuesses: number
  shareToJoinRate: number
  joinToGuessRate: number
  avgGuessesUnlockedViaShare: number
  shareFunnelDaily: Array<{
    day: string
    prompts_shown: number
    clicks: number
    successes: number
    conversion_rate: number
  }>
  referralVelocityDaily: Array<{
    day: string
    shares: number
    joins: number
    guesses: number
  }>
  sharesByChannel: Array<{
    channel: string
    clicks: number
    successes: number
  }>
}

interface PurchaseEvent {
  txHash: string
  blockNumber: number
  timestamp: string
  player: string
  fid: number | null
  username: string | null
  quantity: number
  ethAmount: string
  roundNumber: number
  isSmartWallet: boolean
  toJackpot: string
  toCreator: string
}

interface PurchaseEventsResponse {
  events: PurchaseEvent[]
  totalEvents: number
  fromBlock: number
  toBlock: number
  contractAddress: string
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

function formatTimeAgo(isoTimestamp: string): string {
  const startTime = new Date(isoTimestamp).getTime()
  const now = Date.now()
  const diffMs = now - startTime

  const minutes = Math.floor(diffMs / (1000 * 60))
  const hours = Math.floor(diffMs / (1000 * 60 * 60))
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (days > 0) {
    return `${days}d ${hours % 24}h ago`
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m ago`
  } else {
    return `${minutes}m ago`
  }
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
  const [wauData, setWauData] = useState<WAUData[]>([])
  const [guessData, setGuessData] = useState<GuessData[]>([])
  const [economyAnalytics, setEconomyAnalytics] = useState<EconomyAnalytics | null>(null)
  const [gameplayInsights, setGameplayInsights] = useState<GameplayInsights | null>(null)
  const [shareFunnel, setShareFunnel] = useState<ShareFunnelAnalytics | null>(null)
  const [retention, setRetention] = useState<RetentionAnalytics | null>(null)
  const [cohorts, setCohorts] = useState<CohortAnalytics | null>(null)
  const [purchaseEvents, setPurchaseEvents] = useState<PurchaseEventsResponse | null>(null)
  const [purchaseEventsLoading, setPurchaseEventsLoading] = useState(false)
  const [simulationResults, setSimulationResults] = useState<SimulationResult[]>([])
  const [runningSimulation, setRunningSimulation] = useState<string | null>(null)

  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const filterByTimeRange = (data: any[], range: TimeRange, currentRoundStartTime?: string) => {
    if (range === "all") return data
    if (range === "current") {
      // For "current" range, filter to data from when the current round started
      // Compare at day level only (round start date, not time)
      if (!currentRoundStartTime) return data
      const roundStartDate = new Date(currentRoundStartTime)
      // Set to start of day in UTC to compare day-level
      const cutoffDate = new Date(Date.UTC(
        roundStartDate.getUTCFullYear(),
        roundStartDate.getUTCMonth(),
        roundStartDate.getUTCDate(),
        0, 0, 0, 0
      ))
      return data.filter(item => {
        const itemDate = new Date(item.day || item.week_start)
        return itemDate >= cutoffDate
      })
    }
    const daysBack = range === "7d" ? 7 : range === "30d" ? 30 : 7
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
        wauRes,
        guessRes,
        economyRes,
        gameplayRes,
        shareFunnelRes,
        retentionRes,
        cohortsRes,
      ] = await Promise.all([
        fetch(`/api/admin/analytics/dashboard-summary${devFidParam}`),
        fetch(`/api/admin/analytics/pack-pricing${devFidParam}`),
        fetch(`/api/admin/analytics/onboarding${devFidParam}${rangeParam}`),
        fetch(`/api/admin/analytics/dau${devFidParam}`),
        fetch(`/api/admin/analytics/wau${devFidParam}`),
        fetch(`/api/admin/analytics/free-paid${devFidParam}`),
        fetch(`/api/admin/analytics/economy${devFidParam}${rangeParam}`),
        fetch(`/api/admin/analytics/gameplay${devFidParam}${rangeParam}`),
        fetch(`/api/admin/analytics/share-funnel${devFidParam}${rangeParam}`),
        fetch(`/api/admin/analytics/retention${devFidParam}`),
        fetch(`/api/admin/analytics/cohorts${devFidParam}`),
      ])

      // Parse summary first to get current round start time for filtering
      let summaryData: DashboardSummary | null = null
      if (summaryRes.ok) {
        summaryData = await summaryRes.json()
        setSummary(summaryData)
      }
      const currentRoundStartTime = summaryData?.currentRound?.startedAt || undefined

      if (packPricingRes.ok) setPackPricing(await packPricingRes.json())
      if (onboardingRes.ok) setOnboarding(await onboardingRes.json())
      if (dauRes.ok) {
        const dau = await dauRes.json()
        setDauData(filterByTimeRange(dau.data || dau, timeRange, currentRoundStartTime))
      }
      if (wauRes.ok) {
        const wau = await wauRes.json()
        setWauData(wau.data || wau)
      }
      if (guessRes.ok) {
        const guesses = await guessRes.json()
        setGuessData(filterByTimeRange(guesses.data || guesses, timeRange, currentRoundStartTime))
      }
      if (economyRes.ok) setEconomyAnalytics(await economyRes.json())
      if (gameplayRes.ok) setGameplayInsights(await gameplayRes.json())
      if (shareFunnelRes.ok) setShareFunnel(await shareFunnelRes.json())
      if (retentionRes.ok) setRetention(await retentionRes.json())
      if (cohortsRes.ok) setCohorts(await cohortsRes.json())

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

  // Fetch purchase events from contract (on-demand, can be slow)
  const fetchPurchaseEvents = async (roundNumber?: number) => {
    if (!user?.fid) return
    setPurchaseEventsLoading(true)
    try {
      const params = new URLSearchParams({ devFid: user.fid.toString() })
      if (roundNumber) params.set('roundNumber', roundNumber.toString())
      const res = await fetch(`/api/admin/analytics/purchase-events?${params}`)
      if (res.ok) {
        setPurchaseEvents(await res.json())
      }
    } catch (err) {
      console.error('Failed to fetch purchase events:', err)
    } finally {
      setPurchaseEventsLoading(false)
    }
  }

  const dauChartData = [...dauData].reverse().map(d => ({
    day: new Date(d.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' }),
    "Active Users": d.active_users
  }))

  const wauChartData = [...wauData].reverse().map(d => ({
    week: new Date(d.week_start).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' }),
    "Active Users": d.active_users
  }))

  const guessChartData = [...guessData].reverse().map(d => ({
    day: new Date(d.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' }),
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
      {/* At-a-Glance Health Badges */}
      <div style={{
        display: 'flex',
        gap: '12px',
        marginBottom: '16px',
        flexWrap: 'wrap',
      }}>
        {/* Game Health */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '8px 14px',
          borderRadius: '20px',
          fontSize: '12px',
          fontWeight: 500,
          fontFamily,
          background: summary?.currentRound?.roundId ? '#dcfce7' : '#fef3c7',
          color: summary?.currentRound?.roundId ? '#166534' : '#92400e',
        }}>
          <span>{summary?.currentRound?.roundId ? '🟢' : '🟡'}</span>
          <span>Game: {summary?.currentRound?.roundId ? 'Active' : 'Paused'}</span>
        </div>

        {/* Revenue Health */}
        {summary && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '8px 14px',
            borderRadius: '20px',
            fontSize: '12px',
            fontWeight: 500,
            fontFamily,
            background: (summary.packPurchasesToday || 0) > 0 ? '#dcfce7' :
                        summary.packPurchases7dAvg > 0 ? '#fef3c7' : '#fee2e2',
            color: (summary.packPurchasesToday || 0) > 0 ? '#166534' :
                   summary.packPurchases7dAvg > 0 ? '#92400e' : '#991b1b',
          }}>
            <span>{(summary.packPurchasesToday || 0) > 0 ? '🟢' : summary.packPurchases7dAvg > 0 ? '🟡' : '🔴'}</span>
            <span>Revenue: {(summary.packPurchasesToday || 0) > 0 ? 'Active' : 'Low'}</span>
          </div>
        )}

        {/* Retention Health */}
        {retention && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '8px 14px',
            borderRadius: '20px',
            fontSize: '12px',
            fontWeight: 500,
            fontFamily,
            background: retention.returnRate >= 30 ? '#dcfce7' :
                        retention.returnRate >= 15 ? '#fef3c7' : '#fee2e2',
            color: retention.returnRate >= 30 ? '#166534' :
                   retention.returnRate >= 15 ? '#92400e' : '#991b1b',
          }}>
            <span>{retention.returnRate >= 30 ? '🟢' : retention.returnRate >= 15 ? '🟡' : '🔴'}</span>
            <span>Retention: {formatPercent(retention.returnRate, 0)}</span>
          </div>
        )}

        {/* DAU */}
        {summary && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '8px 14px',
            borderRadius: '20px',
            fontSize: '12px',
            fontWeight: 500,
            fontFamily,
            background: '#f3f4f6',
            color: '#374151',
          }}>
            <span>👥</span>
            <span>DAU: {summary.dauToday}</span>
          </div>
        )}
      </div>

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
      {/* LIVE ROUND DASHBOARD - Real-time current round stats */}
      {/* ================================================================== */}
      {summary?.currentRound?.roundId && (
        <div style={{
          ...styles.section,
          background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
          borderColor: '#7dd3fc',
          marginBottom: '24px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h3 style={{ ...styles.sectionTitle, margin: 0, color: '#0369a1' }}>
              🎯 Live Round #{summary.currentRound.roundId}
            </h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {autoRefresh && (
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '11px',
                  color: '#0369a1',
                  background: '#e0f2fe',
                  padding: '4px 10px',
                  borderRadius: '12px',
                  fontFamily,
                }}>
                  <span style={{ width: '6px', height: '6px', background: '#10b981', borderRadius: '50%', animation: 'pulse 2s infinite' }} />
                  Live
                </span>
              )}
              {summary.currentRound.startedAt && (
                <span style={{ fontSize: '11px', color: '#6b7280', fontFamily }}>
                  Started {formatTimeAgo(summary.currentRound.startedAt)}
                </span>
              )}
            </div>
          </div>

          {/* Big Numbers Row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '20px' }}>
            {/* Prize Pool */}
            <div style={{
              background: 'white',
              borderRadius: '12px',
              padding: '20px',
              textAlign: 'center',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            }}>
              <div style={{ fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px', fontFamily }}>
                Prize Pool
              </div>
              <div style={{ fontSize: '32px', fontWeight: 700, color: '#059669', fontFamily }}>
                {formatEth(summary.currentRound.prizePoolEth)}
              </div>
              <div style={{ fontSize: '12px', color: '#9ca3af', fontFamily }}>ETH</div>
            </div>

            {/* Total Guesses */}
            <div style={{
              background: 'white',
              borderRadius: '12px',
              padding: '20px',
              textAlign: 'center',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            }}>
              <div style={{ fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px', fontFamily }}>
                Total Guesses
              </div>
              <div style={{ fontSize: '32px', fontWeight: 700, color: '#6366f1', fontFamily }}>
                {formatNumber(summary.currentRound.totalGuesses)}
              </div>
              <div style={{ fontSize: '12px', color: '#9ca3af', fontFamily }}>this round</div>
            </div>

            {/* Top 10 Status */}
            <div style={{
              background: 'white',
              borderRadius: '12px',
              padding: '20px',
              textAlign: 'center',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            }}>
              <div style={{ fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px', fontFamily }}>
                Top 10 Status
              </div>
              {summary.currentRound.top10Locked ? (
                <>
                  <div style={{ fontSize: '32px', fontWeight: 700, color: '#dc2626', fontFamily }}>
                    Locked
                  </div>
                  <div style={{ fontSize: '12px', color: '#9ca3af', fontFamily }}>rankings frozen</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: '32px', fontWeight: 700, color: '#f59e0b', fontFamily }}>
                    {summary.currentRound.guessesToLock}
                  </div>
                  <div style={{ fontSize: '12px', color: '#9ca3af', fontFamily }}>guesses to lock</div>
                </>
              )}
            </div>

            {/* Pricing Phase */}
            <div style={{
              background: 'white',
              borderRadius: '12px',
              padding: '20px',
              textAlign: 'center',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            }}>
              <div style={{ fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px', fontFamily }}>
                Pack Price
              </div>
              <div style={{ fontSize: '32px', fontWeight: 700, color: '#8b5cf6', fontFamily }}>
                {summary.currentRound.packPriceEth}
              </div>
              <div style={{ fontSize: '12px', color: '#9ca3af', fontFamily }}>ETH ({summary.currentRound.pricingPhaseLabel})</div>
            </div>
          </div>

          {/* Top 10 Progress Bar */}
          {!summary.currentRound.top10Locked && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '12px', color: '#374151', fontWeight: 500, fontFamily }}>
                  Top 10 Race Progress
                </span>
                <span style={{ fontSize: '12px', color: '#6b7280', fontFamily }}>
                  {summary.currentRound.eligibleGuesses} / 850 eligible guesses
                </span>
              </div>
              <div style={{
                height: '12px',
                background: '#e5e7eb',
                borderRadius: '6px',
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  width: `${Math.min((summary.currentRound.eligibleGuesses / 850) * 100, 100)}%`,
                  background: summary.currentRound.eligibleGuesses >= 750 ? '#f59e0b' : '#10b981',
                  borderRadius: '6px',
                  transition: 'width 0.3s ease',
                }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                <span style={{ fontSize: '10px', color: '#9ca3af', fontFamily }}>Open</span>
                <span style={{ fontSize: '10px', color: '#9ca3af', fontFamily }}>850 = Locked</span>
              </div>
            </div>
          )}

          {/* Eligible vs Ineligible */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={{
              background: '#dcfce7',
              borderRadius: '8px',
              padding: '12px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span style={{ fontSize: '12px', color: '#166534', fontFamily }}>Eligible Guesses (Top 10 eligible)</span>
              <span style={{ fontSize: '16px', fontWeight: 600, color: '#166534', fontFamily }}>
                {formatNumber(summary.currentRound.eligibleGuesses)}
              </span>
            </div>
            <div style={{
              background: '#fee2e2',
              borderRadius: '8px',
              padding: '12px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span style={{ fontSize: '12px', color: '#991b1b', fontFamily }}>Ineligible Guesses (can win, can't rank)</span>
              <span style={{ fontSize: '16px', fontWeight: 600, color: '#991b1b', fontFamily }}>
                {formatNumber(summary.currentRound.ineligibleGuesses)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* No Active Round State */}
      {!summary?.currentRound?.roundId && (
        <div style={{
          ...styles.section,
          background: '#fef3c7',
          borderColor: '#fde68a',
          textAlign: 'center',
          padding: '40px 24px',
        }}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>⏸️</div>
          <h3 style={{ fontSize: '18px', fontWeight: 600, color: '#92400e', margin: '0 0 8px 0', fontFamily }}>
            No Active Round
          </h3>
          <p style={{ fontSize: '13px', color: '#b45309', margin: 0, fontFamily }}>
            Start a new round from the Operations tab to see live statistics.
          </p>
        </div>
      )}

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
          {/* Current Round */}
          <div>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "12px", fontFamily }}>
              Current Round{packPricing?.currentRoundId ? ` (#${packPricing.currentRoundId})` : ''}
            </div>
            <div style={{ ...styles.grid, gridTemplateColumns: "repeat(3, 1fr)" }}>
              <div style={{ ...styles.statCard, borderLeft: "3px solid #10b981" }}>
                <div style={styles.statLabel}>Early (BASE)</div>
                <div style={styles.statValue}>{packPricing?.currentRound?.base.count || 0}</div>
                <div style={styles.statSubtext}>{formatEth(packPricing?.currentRound?.base.revenueEth || 0)} ETH</div>
              </div>
              <div style={{ ...styles.statCard, borderLeft: "3px solid #f59e0b" }}>
                <div style={styles.statLabel}>Late (LATE_1)</div>
                <div style={styles.statValue}>{packPricing?.currentRound?.late1.count || 0}</div>
                <div style={styles.statSubtext}>{formatEth(packPricing?.currentRound?.late1.revenueEth || 0)} ETH</div>
              </div>
              <div style={{ ...styles.statCard, borderLeft: "3px solid #ef4444" }}>
                <div style={styles.statLabel}>Capped (LATE_2)</div>
                <div style={styles.statValue}>{packPricing?.currentRound?.late2.count || 0}</div>
                <div style={styles.statSubtext}>{formatEth(packPricing?.currentRound?.late2.revenueEth || 0)} ETH</div>
              </div>
            </div>
          </div>
          {/* Last 7d */}
          <div>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "12px", fontFamily }}>Last 7 days</div>
            <div style={{ ...styles.grid, gridTemplateColumns: "repeat(3, 1fr)" }}>
              <div style={{ ...styles.statCard, borderLeft: "3px solid #10b981" }}>
                <div style={styles.statLabel}>Early (BASE)</div>
                <div style={styles.statValue}>{packPricing?.last7d?.base.count || 0}</div>
                <div style={styles.statSubtext}>{formatPercent(packPricing?.phaseDistribution7d?.base || 0)} of total</div>
              </div>
              <div style={{ ...styles.statCard, borderLeft: "3px solid #f59e0b" }}>
                <div style={styles.statLabel}>Late (LATE_1)</div>
                <div style={styles.statValue}>{packPricing?.last7d?.late1.count || 0}</div>
                <div style={styles.statSubtext}>{formatPercent(packPricing?.phaseDistribution7d?.late1 || 0)} of total</div>
              </div>
              <div style={{ ...styles.statCard, borderLeft: "3px solid #ef4444" }}>
                <div style={styles.statLabel}>Capped (LATE_2)</div>
                <div style={styles.statValue}>{packPricing?.last7d?.late2.count || 0}</div>
                <div style={styles.statSubtext}>{formatPercent(packPricing?.phaseDistribution7d?.late2 || 0)} of total</div>
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
      {/* SHARE & REFERRAL ANALYTICS */}
      {/* ================================================================== */}
      {shareFunnel && (
        <Module title="Share & Referral Analytics">
          {/* Summary Stats */}
          <div style={{ ...styles.grid, gridTemplateColumns: "repeat(4, 1fr)", marginBottom: "24px" }}>
            <StatCard
              label="Share Success Rate"
              value={formatPercent(shareFunnel.overallConversionRate)}
              subtext={`${shareFunnel.shareSuccesses.toLocaleString()} of ${shareFunnel.sharePromptsShown.toLocaleString()} prompts`}
              loading={loading}
            />
            <StatCard
              label="Referral Joins"
              value={shareFunnel.referralJoins.toLocaleString()}
              subtext={`${formatPercent(shareFunnel.shareToJoinRate)} of shares`}
              loading={loading}
            />
            <StatCard
              label="Guesses via Referral"
              value={shareFunnel.referralGuesses.toLocaleString()}
              subtext={`${formatPercent(shareFunnel.joinToGuessRate)} of joins`}
              loading={loading}
            />
            <StatCard
              label="Avg Guesses Unlocked"
              value={shareFunnel.avgGuessesUnlockedViaShare.toFixed(1)}
              subtext="Per share bonus"
              loading={loading}
            />
          </div>

          {/* Charts Row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
            {/* Channel Breakdown */}
            {shareFunnel.sharesByChannel.length > 0 && (
              <div>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "12px", fontFamily }}>
                  Share Performance by Channel
                </div>
                <AnalyticsChart
                  data={shareFunnel.sharesByChannel.map(c => ({
                    channel: c.channel === 'unknown' ? 'Direct' : c.channel.charAt(0).toUpperCase() + c.channel.slice(1),
                    "Clicks": c.clicks,
                    "Successes": c.successes,
                  }))}
                  type="bar"
                  xAxisKey="channel"
                  dataKey={["Clicks", "Successes"]}
                  colors={["#94a3b8", "#10b981"]}
                  height={200}
                  embedded
                />
              </div>
            )}

            {/* Referral Velocity */}
            {shareFunnel.referralVelocityDaily.length > 0 && (
              <div>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "12px", fontFamily }}>
                  Daily Referral Velocity
                </div>
                <AnalyticsChart
                  data={[...shareFunnel.referralVelocityDaily].reverse().slice(-14).map(d => ({
                    day: new Date(d.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' }),
                    "Shares": d.shares,
                    "Joins": d.joins,
                    "Guesses": d.guesses,
                  }))}
                  type="line"
                  xAxisKey="day"
                  dataKey={["Shares", "Joins", "Guesses"]}
                  colors={["#6366f1", "#8b5cf6", "#10b981"]}
                  height={200}
                  embedded
                />
              </div>
            )}
          </div>
        </Module>
      )}

      {/* ================================================================== */}
      {/* USER ACTIVITY CHARTS (DAU + WAU) */}
      {/* ================================================================== */}
      <Module title="User Activity">
        <div style={{ display: "grid", gridTemplateColumns: wauChartData.length > 0 ? "1fr 1fr" : "1fr", gap: "24px" }}>
          {/* DAU Chart */}
          {dauChartData.length > 0 && (
            <div>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "12px", fontFamily }}>
                Daily Active Users (DAU)
              </div>
              <AnalyticsChart
                data={dauChartData}
                type="line"
                xAxisKey="day"
                dataKey={["Active Users"]}
                colors={["#6366f1"]}
                height={200}
                embedded
              />
            </div>
          )}
          {/* WAU Chart */}
          {wauChartData.length > 0 && (
            <div>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "12px", fontFamily }}>
                Weekly Active Users (WAU)
              </div>
              <AnalyticsChart
                data={wauChartData}
                type="line"
                xAxisKey="week"
                dataKey={["Active Users"]}
                colors={["#8b5cf6"]}
                height={200}
                embedded
              />
            </div>
          )}
        </div>
        {/* DAU/WAU Ratio indicator */}
        {dauData.length > 0 && wauData.length > 0 && (
          <div style={{ marginTop: "16px", padding: "12px", background: "#f3f4f6", borderRadius: "8px" }}>
            <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "4px", fontFamily }}>
              Stickiness (DAU/WAU Ratio)
            </div>
            <div style={{ fontSize: "20px", fontWeight: 600, color: "#111827", fontFamily }}>
              {wauData[0]?.active_users > 0
                ? `${((dauData[0]?.active_users / wauData[0]?.active_users) * 100).toFixed(1)}%`
                : 'N/A'
              }
            </div>
            <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "2px", fontFamily }}>
              Higher = more engaged users returning daily
            </div>
          </div>
        )}
      </Module>

      {/* ================================================================== */}
      {/* RETENTION & COHORTS */}
      {/* ================================================================== */}
      {retention && (
        <Module title="Retention & User Health">
          {/* Key Retention Metrics */}
          <div style={{ ...styles.grid, gridTemplateColumns: "repeat(5, 1fr)", marginBottom: "24px" }}>
            <div style={{
              ...styles.statCard,
              background: retention.returnRate >= 30 ? '#dcfce7' : retention.returnRate >= 15 ? '#fef3c7' : '#fee2e2',
              borderLeft: `4px solid ${retention.returnRate >= 30 ? '#10b981' : retention.returnRate >= 15 ? '#f59e0b' : '#ef4444'}`,
            }}>
              <div style={styles.statLabel}>Return Rate</div>
              <div style={{ ...styles.statValue, color: retention.returnRate >= 30 ? '#059669' : retention.returnRate >= 15 ? '#d97706' : '#dc2626' }}>
                {formatPercent(retention.returnRate)}
              </div>
              <div style={styles.statSubtext}>
                {retention.returningUsers} of {retention.yesterdayUsers} returned
              </div>
            </div>
            <StatCard
              label="Stickiness (DAU/WAU)"
              value={formatPercent(retention.stickiness)}
              subtext="Higher = more engaged"
              loading={loading}
            />
            <StatCard
              label="WAU"
              value={formatNumber(retention.wau)}
              subtext="Weekly Active Users"
              loading={loading}
            />
            <StatCard
              label="MAU"
              value={formatNumber(retention.mau)}
              subtext="Monthly Active Users"
              loading={loading}
            />
            <div style={{
              ...styles.statCard,
              background: retention.churnRate7d <= 20 ? '#dcfce7' : retention.churnRate7d <= 40 ? '#fef3c7' : '#fee2e2',
              borderLeft: `4px solid ${retention.churnRate7d <= 20 ? '#10b981' : retention.churnRate7d <= 40 ? '#f59e0b' : '#ef4444'}`,
            }}>
              <div style={styles.statLabel}>7-Day Churn</div>
              <div style={{ ...styles.statValue, color: retention.churnRate7d <= 20 ? '#059669' : retention.churnRate7d <= 40 ? '#d97706' : '#dc2626' }}>
                {formatPercent(retention.churnRate7d)}
              </div>
              <div style={styles.statSubtext}>
                {retention.churnedUsers7d} inactive users
              </div>
            </div>
          </div>

          {/* Power Users */}
          <div style={{ marginBottom: "24px" }}>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "12px", fontFamily }}>
              User Segments
            </div>
            <div style={{ ...styles.grid, gridTemplateColumns: "repeat(3, 1fr)" }}>
              <div style={{ ...styles.statCard, borderLeft: "3px solid #8b5cf6" }}>
                <div style={styles.statLabel}>Power Users (10+ Rounds)</div>
                <div style={styles.statValue}>{retention.powerUsers}</div>
                <div style={styles.statSubtext}>{formatPercent(retention.powerUserPercentage)} of all users</div>
              </div>
              <div style={{ ...styles.statCard, borderLeft: "3px solid #6366f1" }}>
                <div style={styles.statLabel}>Total Users</div>
                <div style={styles.statValue}>{formatNumber(retention.totalUsers)}</div>
                <div style={styles.statSubtext}>All time</div>
              </div>
              <div style={{ ...styles.statCard, borderLeft: "3px solid #f59e0b" }}>
                <div style={styles.statLabel}>Churned (30+ days)</div>
                <div style={styles.statValue}>{formatNumber(retention.churnedUsers30d)}</div>
                <div style={styles.statSubtext}>Haven't played in a month</div>
              </div>
            </div>
          </div>

          {/* Daily Retention Chart */}
          {retention.dailyRetention.length > 0 && (
            <div>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "12px", fontFamily }}>
                Daily Return Rate Trend
              </div>
              <AnalyticsChart
                data={[...retention.dailyRetention].reverse().map(d => ({
                  day: new Date(d.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' }),
                  "Return Rate %": d.return_rate,
                }))}
                type="line"
                xAxisKey="day"
                dataKey={["Return Rate %"]}
                colors={["#10b981"]}
                height={200}
                embedded
              />
            </div>
          )}
        </Module>
      )}

      {/* Cohort Retention Heatmap */}
      {cohorts && cohorts.cohorts.length > 0 && (
        <Module title="Weekly Cohort Retention">
          <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "16px", fontFamily }}>
            Each row is a weekly cohort (when users first played). Columns show retention in subsequent weeks.
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "12px",
              fontFamily,
            }}>
              <thead>
                <tr>
                  <th style={{
                    textAlign: "left",
                    padding: "8px 12px",
                    borderBottom: "2px solid #e5e7eb",
                    color: "#374151",
                    fontWeight: 600,
                  }}>
                    Cohort Week
                  </th>
                  <th style={{
                    textAlign: "center",
                    padding: "8px 12px",
                    borderBottom: "2px solid #e5e7eb",
                    color: "#374151",
                    fontWeight: 600,
                  }}>
                    Size
                  </th>
                  {[0, 1, 2, 3, 4, 5, 6, 7].map(week => (
                    <th key={week} style={{
                      textAlign: "center",
                      padding: "8px 12px",
                      borderBottom: "2px solid #e5e7eb",
                      color: "#6b7280",
                      fontWeight: 500,
                    }}>
                      W{week}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cohorts.cohorts.slice(0, 8).map((cohort) => (
                  <tr key={cohort.cohort_week}>
                    <td style={{
                      padding: "8px 12px",
                      borderBottom: "1px solid #f3f4f6",
                      color: "#374151",
                      fontWeight: 500,
                    }}>
                      {new Date(cohort.cohort_week).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </td>
                    <td style={{
                      textAlign: "center",
                      padding: "8px 12px",
                      borderBottom: "1px solid #f3f4f6",
                      color: "#6b7280",
                    }}>
                      {cohort.cohort_size}
                    </td>
                    {[0, 1, 2, 3, 4, 5, 6, 7].map(weekIdx => {
                      const weekData = cohort.retention.find(r => r.weeks_after === weekIdx);
                      const rate = weekData?.retention_rate || 0;
                      // Color gradient: green (100%) -> yellow (50%) -> red (0%)
                      const bgColor = rate >= 60 ? '#dcfce7' :
                                      rate >= 40 ? '#d1fae5' :
                                      rate >= 20 ? '#fef3c7' :
                                      rate > 0 ? '#fee2e2' :
                                      '#f9fafb';
                      return (
                        <td key={weekIdx} style={{
                          textAlign: "center",
                          padding: "8px 12px",
                          borderBottom: "1px solid #f3f4f6",
                          background: bgColor,
                          color: rate > 0 ? '#374151' : '#d1d5db',
                          fontWeight: rate > 0 ? 500 : 400,
                        }}>
                          {rate > 0 ? `${rate}%` : '-'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: "12px", fontSize: "11px", color: "#9ca3af", fontFamily }}>
            W0 = Same week as signup. Higher retention in later weeks = better engagement.
          </div>
        </Module>
      )}

      {/* ================================================================== */}
      {/* ONCHAIN PURCHASE EVENTS */}
      {/* ================================================================== */}
      <Module title="Onchain Purchase Events">
        <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "16px", fontFamily }}>
          Query GuessesPurchased events directly from the contract. This captures ALL purchases including smart wallet transactions that don't appear in Basescan's external tx filter.
        </div>
        <div style={{ display: "flex", gap: "12px", marginBottom: "16px", alignItems: "center" }}>
          <button
            onClick={() => fetchPurchaseEvents(summary?.currentRound?.roundId || undefined)}
            disabled={purchaseEventsLoading}
            style={{
              padding: "8px 16px",
              background: purchaseEventsLoading ? "#d1d5db" : "#059669",
              color: "white",
              border: "none",
              borderRadius: "6px",
              fontSize: "13px",
              fontWeight: 500,
              cursor: purchaseEventsLoading ? "not-allowed" : "pointer",
              fontFamily,
            }}
          >
            {purchaseEventsLoading ? "Loading events..." : summary?.currentRound?.roundId ? `Load Round ${summary.currentRound.roundId} Events` : "Load Recent Events"}
          </button>
          <button
            onClick={() => fetchPurchaseEvents()}
            disabled={purchaseEventsLoading}
            style={{
              padding: "8px 16px",
              background: purchaseEventsLoading ? "#d1d5db" : "#6366f1",
              color: "white",
              border: "none",
              borderRadius: "6px",
              fontSize: "13px",
              fontWeight: 500,
              cursor: purchaseEventsLoading ? "not-allowed" : "pointer",
              fontFamily,
            }}
          >
            Load All Recent
          </button>
          {purchaseEvents && (
            <span style={{ fontSize: "12px", color: "#6b7280" }}>
              {purchaseEvents.totalEvents} events (blocks {purchaseEvents.fromBlock.toLocaleString()} - {purchaseEvents.toBlock.toLocaleString()})
            </span>
          )}
        </div>
        {purchaseEvents && purchaseEvents.events.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "12px",
              fontFamily,
            }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "8px", borderBottom: "2px solid #e5e7eb", color: "#374151", fontWeight: 600 }}>Time</th>
                  <th style={{ textAlign: "left", padding: "8px", borderBottom: "2px solid #e5e7eb", color: "#374151", fontWeight: 600 }}>User</th>
                  <th style={{ textAlign: "center", padding: "8px", borderBottom: "2px solid #e5e7eb", color: "#374151", fontWeight: 600 }}>Qty</th>
                  <th style={{ textAlign: "right", padding: "8px", borderBottom: "2px solid #e5e7eb", color: "#374151", fontWeight: 600 }}>ETH</th>
                  <th style={{ textAlign: "center", padding: "8px", borderBottom: "2px solid #e5e7eb", color: "#374151", fontWeight: 600 }}>Round</th>
                  <th style={{ textAlign: "center", padding: "8px", borderBottom: "2px solid #e5e7eb", color: "#374151", fontWeight: 600 }}>Type</th>
                  <th style={{ textAlign: "left", padding: "8px", borderBottom: "2px solid #e5e7eb", color: "#374151", fontWeight: 600 }}>Tx</th>
                </tr>
              </thead>
              <tbody>
                {purchaseEvents.events.slice(0, 50).map((event) => (
                  <tr key={event.txHash}>
                    <td style={{ padding: "8px", borderBottom: "1px solid #f3f4f6", color: "#6b7280" }}>
                      {event.timestamp ? new Date(event.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : `Block ${event.blockNumber}`}
                    </td>
                    <td style={{ padding: "8px", borderBottom: "1px solid #f3f4f6", color: "#374151" }}>
                      {event.fid ? (
                        <span>@{event.username || event.fid}</span>
                      ) : (
                        <span style={{ fontFamily: "monospace", fontSize: "11px" }}>{event.player.slice(0, 6)}...{event.player.slice(-4)}</span>
                      )}
                    </td>
                    <td style={{ textAlign: "center", padding: "8px", borderBottom: "1px solid #f3f4f6", color: "#374151", fontWeight: 600 }}>
                      {event.quantity}
                    </td>
                    <td style={{ textAlign: "right", padding: "8px", borderBottom: "1px solid #f3f4f6", color: "#059669", fontWeight: 500, fontFamily: "monospace" }}>
                      {parseFloat(event.ethAmount).toFixed(4)}
                    </td>
                    <td style={{ textAlign: "center", padding: "8px", borderBottom: "1px solid #f3f4f6", color: "#6b7280" }}>
                      #{event.roundNumber}
                    </td>
                    <td style={{ textAlign: "center", padding: "8px", borderBottom: "1px solid #f3f4f6" }}>
                      {event.isSmartWallet ? (
                        <span style={{ padding: "2px 6px", background: "#ddd6fe", color: "#7c3aed", borderRadius: "4px", fontSize: "10px", fontWeight: 600 }}>SMART</span>
                      ) : (
                        <span style={{ padding: "2px 6px", background: "#dbeafe", color: "#2563eb", borderRadius: "4px", fontSize: "10px", fontWeight: 600 }}>DIRECT</span>
                      )}
                    </td>
                    <td style={{ padding: "8px", borderBottom: "1px solid #f3f4f6" }}>
                      <a
                        href={`https://basescan.org/tx/${event.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "#6366f1", textDecoration: "none", fontFamily: "monospace", fontSize: "11px" }}
                      >
                        {event.txHash.slice(0, 8)}...
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {purchaseEvents.events.length > 50 && (
              <div style={{ marginTop: "8px", fontSize: "11px", color: "#9ca3af" }}>
                Showing first 50 of {purchaseEvents.events.length} events
              </div>
            )}
          </div>
        )}
        {purchaseEvents && purchaseEvents.events.length === 0 && (
          <div style={{ padding: "24px", textAlign: "center", color: "#9ca3af", fontSize: "13px" }}>
            No purchase events found in the queried block range.
          </div>
        )}
      </Module>

      {/* ================================================================== */}
      {/* GUESSES CHART */}
      {/* ================================================================== */}
      {guessChartData.length > 0 && (
        <Module title="Free vs Paid Guesses">
          <AnalyticsChart
            data={guessChartData}
            type="bar"
            xAxisKey="day"
            dataKey={["Free", "Paid"]}
            colors={["#10b981", "#f59e0b"]}
            height={250}
            embedded
          />
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
            value={gameplayInsights?.hardestWords?.[0]?.word?.toUpperCase() || 'N/A'}
            subtext={gameplayInsights?.hardestWords?.[0] ? `Round #${gameplayInsights.hardestWords[0].roundId} · ${formatPercent(gameplayInsights.hardestWords[0].solveRate)} solve rate` : ''}
            loading={loading}
          />
        </div>
        {gameplayInsights?.guessDistribution && gameplayInsights.guessDistribution.length > 0 && (
          <div style={{ marginTop: "16px" }}>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "12px" }}>Guess Count Distribution</div>
            <AnalyticsChart
              data={gameplayInsights.guessDistribution.map(d => ({
                guesses: `${d.guessCount}`,
                "Rounds": d.rounds
              }))}
              type="bar"
              xAxisKey="guesses"
              dataKey={["Rounds"]}
              colors={["#8b5cf6"]}
              height={200}
              embedded
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

    </div>
  )
}

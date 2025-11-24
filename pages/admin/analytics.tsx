// pages/admin/analytics.tsx
// Phase 4: Advanced Analytics Dashboard
import React, { useState, useEffect, useCallback, useRef } from "react"
import dynamic from "next/dynamic"
import { AdminStatsCard } from "../../components/admin/AdminStatsCard"
import { AdminSection } from "../../components/admin/AdminSection"
import { AnalyticsChart } from "../../components/admin/AnalyticsChart"
import { AnalyticsControls, TimeRange } from "../../components/admin/AnalyticsControls"

// Dynamically import the auth wrapper (client-only)
const AdminAuthWrapper = dynamic(
  () => import("../../components/admin/AdminAuthWrapper").then(m => m.AdminAuthWrapper),
  { ssr: false, loading: () => <div style={{ padding: 24 }}>Loading...</div> }
)

interface DashboardContentProps {
  user?: {
    fid: number
    username: string
    display_name?: string
    pfp_url?: string
  }
  onSignOut?: () => void
}

interface DAUData {
  day: string
  active_users: number
}

interface GuessData {
  day: string
  free_guesses: number
  paid_guesses: number
  free_to_paid_ratio: number
}

interface AdditionalMetrics {
  avgRoundLengthMinutes: number
  avgRoundJackpotEth: number
  totalRounds: number
  avgGuessesPerRound: number
  avgGuessesPerDayPerUser: number
  clanktonGuessesPerUser: number
  creatorRevenuePerRound: number
  creatorRevenueTotalEth: number
  timeRange: string
}

interface GameplayInsights {
  medianGuessesToSolve: number
  solveRate: number
  guessDistribution: Array<{
    guessCount: number
    rounds: number
    percentage: number
  }>
  hardestWords: Array<{
    word: string
    solveRate: number
    avgGuesses: number
    attempts: number
  }>
  easiestWords: Array<{
    word: string
    solveRate: number
    avgGuesses: number
    attempts: number
  }>
  avgLettersCorrectPerGuess: number
  timeRange: string
}

interface ClanktonAnalytics {
  clanktonUserPercentage: number
  clanktonSolveRate: number
  regularSolveRate: number
  avgGuessesPerRoundClankton: number
  avgGuessesPerRoundRegular: number
  clanktonDailyActivity: Array<{
    day: string
    clankton_users: number
    regular_users: number
  }>
  timeRange: string
}

interface EconomyAnalytics {
  packAttachRate: number
  avgPackRevenuePerActiveUser: number
  packPurchaseCount: number
  packViewToPurchaseRate: number
  prizePoolSustainabilityScore: number
  avgJackpot7Day: number
  avgPayoutPerWinner: number
  arpdau: number
  arppu: number
  payingUserPercentage: number
  jackpotTrend: Array<{
    day: string
    avg_jackpot: number
    winners: number
    total_payout: number
  }>
  packSalesTrend: Array<{
    day: string
    packs_sold: number
    revenue_eth: number
    buyers: number
  }>
  timeRange: string
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
  timeRange: string
}

function DashboardContent({ user, onSignOut }: DashboardContentProps) {
  const [dauData, setDauData] = useState<DAUData[]>([])
  const [guessData, setGuessData] = useState<GuessData[]>([])
  const [additionalMetrics, setAdditionalMetrics] = useState<AdditionalMetrics | null>(null)
  const [gameplayInsights, setGameplayInsights] = useState<GameplayInsights | null>(null)
  const [clanktonAnalytics, setClanktonAnalytics] = useState<ClanktonAnalytics | null>(null)
  const [economyAnalytics, setEconomyAnalytics] = useState<EconomyAnalytics | null>(null)
  const [shareFunnelAnalytics, setShareFunnelAnalytics] = useState<ShareFunnelAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [timeRange, setTimeRange] = useState<TimeRange>("30d")
  const [autoRefresh, setAutoRefresh] = useState(false)
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const fetchAnalytics = useCallback(async () => {
    if (!user) return

    setLoading(true)
    setError(null)

    try {
      const devFidParam = `?devFid=${user.fid}`
      const rangeParam = `&range=${timeRange}`

      // Fetch DAU data
      const dauResponse = await fetch(`/api/admin/analytics/dau${devFidParam}`)
      console.log('DAU Response status:', dauResponse.status)

      if (!dauResponse.ok) {
        const responseText = await dauResponse.text()
        console.error('DAU Error response:', responseText)
        try {
          const errorData = JSON.parse(responseText)
          throw new Error(errorData.error || 'Failed to fetch DAU data')
        } catch {
          throw new Error(`Server error: ${dauResponse.status}`)
        }
      }

      const dauText = await dauResponse.text()
      const dau = JSON.parse(dauText)
      console.log('DAU parsed data:', dau)

      // Apply time range filter
      const filteredDau = filterByTimeRange(dau, timeRange)
      setDauData(Array.isArray(filteredDau) ? filteredDau : [])

      // Fetch Free/Paid data
      const guessResponse = await fetch(`/api/admin/analytics/free-paid${devFidParam}`)
      console.log('Free/Paid Response status:', guessResponse.status)

      if (!guessResponse.ok) {
        const responseText = await guessResponse.text()
        console.error('Free/Paid Error response:', responseText)
        try {
          const errorData = JSON.parse(responseText)
          throw new Error(errorData.error || 'Failed to fetch guess data')
        } catch {
          throw new Error(`Server error: ${guessResponse.status}`)
        }
      }

      const guessText = await guessResponse.text()
      const guesses = JSON.parse(guessText)
      console.log('Free/Paid parsed data:', guesses)

      // Apply time range filter
      const filteredGuesses = filterByTimeRange(guesses, timeRange)
      setGuessData(Array.isArray(filteredGuesses) ? filteredGuesses : [])

      // Fetch additional metrics
      const metricsResponse = await fetch(`/api/admin/analytics/metrics${devFidParam}${rangeParam}`)
      if (metricsResponse.ok) {
        const metrics = await metricsResponse.json()
        console.log('Additional metrics:', metrics)
        setAdditionalMetrics(metrics)
      }

      // Fetch Analytics v2 endpoints
      // Gameplay insights
      try {
        const gameplayResponse = await fetch(`/api/admin/analytics/gameplay${devFidParam}${rangeParam}`)
        if (gameplayResponse.ok) {
          const gameplay = await gameplayResponse.json()
          console.log('Gameplay insights:', gameplay)
          setGameplayInsights(gameplay)
        }
      } catch (err) {
        console.warn('Failed to fetch gameplay insights:', err)
        setGameplayInsights(null)
      }

      // CLANKTON analytics
      try {
        const clanktonResponse = await fetch(`/api/admin/analytics/clankton${devFidParam}${rangeParam}`)
        if (clanktonResponse.ok) {
          const clankton = await clanktonResponse.json()
          console.log('CLANKTON analytics:', clankton)
          setClanktonAnalytics(clankton)
        }
      } catch (err) {
        console.warn('Failed to fetch CLANKTON analytics:', err)
        setClanktonAnalytics(null)
      }

      // Economy analytics
      try {
        const economyResponse = await fetch(`/api/admin/analytics/economy${devFidParam}${rangeParam}`)
        if (economyResponse.ok) {
          const economy = await economyResponse.json()
          console.log('Economy analytics:', economy)
          setEconomyAnalytics(economy)
        }
      } catch (err) {
        console.warn('Failed to fetch economy analytics:', err)
        setEconomyAnalytics(null)
      }

      // Share funnel analytics
      try {
        const shareFunnelResponse = await fetch(`/api/admin/analytics/share-funnel${devFidParam}${rangeParam}`)
        if (shareFunnelResponse.ok) {
          const shareFunnel = await shareFunnelResponse.json()
          console.log('Share funnel analytics:', shareFunnel)
          setShareFunnelAnalytics(shareFunnel)
        }
      } catch (err) {
        console.warn('Failed to fetch share funnel analytics:', err)
        setShareFunnelAnalytics(null)
      }

    } catch (err) {
      console.error('Error fetching analytics:', err)
      setError(err instanceof Error ? err.message : 'Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }, [user, timeRange])

  // Filter data by time range
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

  useEffect(() => {
    if (user) {
      console.log('Dashboard user data:', user)
      fetchAnalytics()
    }
  }, [user, fetchAnalytics])

  // Auto-refresh effect
  useEffect(() => {
    if (autoRefresh) {
      refreshIntervalRef.current = setInterval(() => {
        console.log('Auto-refreshing analytics...')
        fetchAnalytics()
      }, 30000) // Refresh every 30 seconds
    } else {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current)
        refreshIntervalRef.current = null
      }
    }

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current)
      }
    }
  }, [autoRefresh, fetchAnalytics])

  // Export functions
  const exportData = (format: "csv" | "json") => {
    const data = {
      dau: dauData,
      guesses: guessData,
      metrics: additionalMetrics,
      gameplay_insights: gameplayInsights,
      clankton_analytics: clanktonAnalytics,
      economy_analytics: economyAnalytics,
      share_funnel_analytics: shareFunnelAnalytics,
      exported_at: new Date().toISOString(),
      time_range: timeRange
    }

    if (format === "json") {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
      downloadBlob(blob, `analytics-${timeRange}-${Date.now()}.json`)
    } else {
      // CSV export - combine all data
      let csv = "Type,Date,Metric,Value\n"

      dauData.forEach(row => {
        csv += `DAU,${row.day},Active Users,${row.active_users}\n`
      })

      guessData.forEach(row => {
        csv += `Guesses,${row.day},Free Guesses,${row.free_guesses}\n`
        csv += `Guesses,${row.day},Paid Guesses,${row.paid_guesses}\n`
        csv += `Guesses,${row.day},Free/Paid Ratio,${row.free_to_paid_ratio}\n`
      })

      if (additionalMetrics) {
        csv += `Metrics,${new Date().toISOString()},Avg Round Length (min),${additionalMetrics.avgRoundLengthMinutes}\n`
        csv += `Metrics,${new Date().toISOString()},Avg Round Jackpot (ETH),${additionalMetrics.avgRoundJackpotEth}\n`
        csv += `Metrics,${new Date().toISOString()},Total Rounds,${additionalMetrics.totalRounds}\n`
        csv += `Metrics,${new Date().toISOString()},Avg Guesses/Round,${additionalMetrics.avgGuessesPerRound}\n`
        csv += `Metrics,${new Date().toISOString()},Avg Guesses/Day/User,${additionalMetrics.avgGuessesPerDayPerUser}\n`
        csv += `Metrics,${new Date().toISOString()},CLANKTON Guesses/User,${additionalMetrics.clanktonGuessesPerUser}\n`
        csv += `Metrics,${new Date().toISOString()},Creator Revenue/Round (ETH),${additionalMetrics.creatorRevenuePerRound}\n`
        csv += `Metrics,${new Date().toISOString()},Total Creator Revenue (ETH),${additionalMetrics.creatorRevenueTotalEth}\n`
      }

      const blob = new Blob([csv], { type: "text/csv" })
      downloadBlob(blob, `analytics-${timeRange}-${Date.now()}.csv`)
    }
  }

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Calculate stats from data
  const todayDAU = dauData[0]?.active_users || 0
  const yesterdayDAU = dauData[1]?.active_users || 0
  const avgDAU7 = dauData.slice(0, Math.min(7, dauData.length)).reduce((sum, d) => sum + d.active_users, 0) / Math.min(7, dauData.length) || 0
  const avgDAU30 = dauData.reduce((sum, d) => sum + d.active_users, 0) / dauData.length || 0

  const totalFreeGuesses = guessData.reduce((sum, d) => sum + d.free_guesses, 0)
  const totalPaidGuesses = guessData.reduce((sum, d) => sum + d.paid_guesses, 0)
  const totalGuesses = totalFreeGuesses + totalPaidGuesses
  const avgRatio = guessData.length > 0
    ? guessData.reduce((sum, d) => sum + d.free_to_paid_ratio, 0) / guessData.length
    : 0

  // Prepare chart data
  const dauChartData = [...dauData].reverse().map(d => ({
    day: new Date(d.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    "Active Users": d.active_users
  }))

  const guessChartData = [...guessData].reverse().map(d => ({
    day: new Date(d.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    "Free Guesses": d.free_guesses,
    "Paid Guesses": d.paid_guesses
  }))

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
                Let's Have A Word — Admin Analytics
              </h1>
              <p style={{
                margin: "8px 0 0 0",
                fontSize: "14px",
                color: "#6b7280",
              }}>
                Analytics v2: Gameplay insights, CLANKTON analytics, economy & share funnel
              </p>
            </div>

            {/* User info */}
            {user && (
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
              }}>
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
                  {user.username ? (
                    <div style={{
                      fontSize: "14px",
                      fontWeight: 600,
                      color: "#111827",
                    }}>
                      @{user.username}
                    </div>
                  ) : (
                    <div style={{
                      fontSize: "14px",
                      fontWeight: 600,
                      color: "#111827",
                    }}>
                      {user.display_name || 'Admin User'}
                    </div>
                  )}
                  <div style={{
                    fontSize: "12px",
                    color: "#6b7280",
                  }}>
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
                      marginLeft: "8px",
                    }}
                  >
                    Sign Out
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Content */}
      <div style={{
        maxWidth: "1280px",
        margin: "0 auto",
        padding: "32px 24px",
      }}>

        {/* Controls */}
        <AnalyticsControls
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
          autoRefresh={autoRefresh}
          onAutoRefreshToggle={() => setAutoRefresh(!autoRefresh)}
          onExport={exportData}
          onRefresh={fetchAnalytics}
          isLoading={loading}
        />

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

        {/* Daily Active Users */}
        <AdminSection title="Daily active users">
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
            gap: "16px",
            marginBottom: "24px",
          }}>
            <AdminStatsCard
              title="Today"
              value={loading ? "..." : todayDAU.toLocaleString()}
              subtitle="Active players"
              loading={loading}
            />
            <AdminStatsCard
              title="Yesterday"
              value={loading ? "..." : yesterdayDAU.toLocaleString()}
              subtitle="Active players"
              loading={loading}
            />
            <AdminStatsCard
              title="7-Day Average"
              value={loading ? "..." : Math.round(avgDAU7).toLocaleString()}
              subtitle="Active players"
              loading={loading}
            />
            <AdminStatsCard
              title="30-Day Average"
              value={loading ? "..." : Math.round(avgDAU30).toLocaleString()}
              subtitle="Active players"
              loading={loading}
            />
          </div>

          {/* DAU Trend Chart */}
          <AnalyticsChart
            data={dauChartData}
            type="line"
            dataKey="Active Users"
            xAxisKey="day"
            title="Daily Active Users Trend"
            colors={["#3b82f6"]}
          />
        </AdminSection>

        {/* Guesses per Round */}
        <AdminSection title="Guesses per round">
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
            gap: "16px",
            marginBottom: "24px",
          }}>
            <AdminStatsCard
              title="Total Guesses"
              value={loading ? "..." : totalGuesses.toLocaleString()}
              subtitle={`Last ${timeRange}`}
              loading={loading}
            />
            <AdminStatsCard
              title="Avg Free/Paid Ratio"
              value={loading ? "..." : avgRatio.toFixed(2)}
              subtitle="Free per paid"
              loading={loading}
            />
            <AdminStatsCard
              title="Free Guesses"
              value={loading ? "..." : totalFreeGuesses.toLocaleString()}
              subtitle={`${totalGuesses > 0 ? Math.round((totalFreeGuesses / totalGuesses) * 100) : 0}% of total`}
              loading={loading}
            />
            <AdminStatsCard
              title="Paid Guesses"
              value={loading ? "..." : totalPaidGuesses.toLocaleString()}
              subtitle={`${totalGuesses > 0 ? Math.round((totalPaidGuesses / totalGuesses) * 100) : 0}% of total`}
              loading={loading}
            />
          </div>

          {/* Guesses Bar Chart */}
          <AnalyticsChart
            data={guessChartData}
            type="bar"
            dataKey={["Free Guesses", "Paid Guesses"]}
            xAxisKey="day"
            title="Free vs Paid Guesses"
            colors={["#10b981", "#f59e0b"]}
          />
        </AdminSection>

        {/* Game Metrics */}
        <AdminSection title="Game metrics">
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
            gap: "16px",
          }}>
            <AdminStatsCard
              title="Avg Round Length"
              value={loading ? "..." : additionalMetrics ? `${Math.round(additionalMetrics.avgRoundLengthMinutes)} min` : "0 min"}
              subtitle="From start to resolution"
              loading={loading}
            />
            <AdminStatsCard
              title="Avg Round Jackpot"
              value={loading ? "..." : additionalMetrics ? `${additionalMetrics.avgRoundJackpotEth.toFixed(4)} ETH` : "0 ETH"}
              subtitle="Average prize pool"
              loading={loading}
            />
            <AdminStatsCard
              title="Total Rounds"
              value={loading ? "..." : additionalMetrics ? additionalMetrics.totalRounds.toLocaleString() : "0"}
              subtitle={`In ${timeRange}`}
              loading={loading}
            />
            <AdminStatsCard
              title="Avg Guesses/Round"
              value={loading ? "..." : additionalMetrics ? additionalMetrics.avgGuessesPerRound.toFixed(1) : "0"}
              subtitle="Per round"
              loading={loading}
            />
          </div>
        </AdminSection>

        {/* User Engagement */}
        <AdminSection title="User engagement">
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
            gap: "16px",
          }}>
            <AdminStatsCard
              title="Avg Guesses/Day/User"
              value={loading ? "..." : additionalMetrics ? additionalMetrics.avgGuessesPerDayPerUser.toFixed(2) : "0"}
              subtitle="Average daily activity"
              loading={loading}
            />
            <AdminStatsCard
              title="CLANKTON Guesses/User"
              value={loading ? "..." : additionalMetrics ? additionalMetrics.clanktonGuessesPerUser.toFixed(2) : "0"}
              subtitle="Holder bonus usage"
              loading={loading}
            />
            <AdminStatsCard
              title="Day 7 Retention"
              value="Coming soon"
              subtitle="Return rate"
            />
            <AdminStatsCard
              title="Day 30 Retention"
              value="Coming soon"
              subtitle="Return rate"
            />
          </div>
        </AdminSection>

        {/* Economy & Revenue */}
        <AdminSection title="Economy & revenue">
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
            gap: "16px",
            marginBottom: "24px",
          }}>
            <AdminStatsCard
              title="Total Creator Revenue"
              value={loading ? "..." : additionalMetrics ? `${additionalMetrics.creatorRevenueTotalEth.toFixed(4)} ETH` : "0 ETH"}
              subtitle={`In ${timeRange}`}
              loading={loading}
            />
            <AdminStatsCard
              title="Avg Revenue/Round"
              value={loading ? "..." : additionalMetrics ? `${additionalMetrics.creatorRevenuePerRound.toFixed(4)} ETH` : "0 ETH"}
              subtitle="Per round"
              loading={loading}
            />
            <AdminStatsCard
              title="ARPDAU"
              value={loading ? "..." : economyAnalytics ? `${economyAnalytics.arpdau.toFixed(6)} ETH` : "Coming soon"}
              subtitle="Avg revenue per daily active user"
              loading={loading}
            />
            <AdminStatsCard
              title="ARPPU"
              value={loading ? "..." : economyAnalytics ? `${economyAnalytics.arppu.toFixed(6)} ETH` : "Coming soon"}
              subtitle="Avg revenue per paying user"
              loading={loading}
            />
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
            gap: "16px",
            marginBottom: "24px",
          }}>
            <AdminStatsCard
              title="Pack Attach Rate"
              value={loading ? "..." : economyAnalytics ? `${economyAnalytics.packAttachRate.toFixed(2)}%` : "Coming soon"}
              subtitle="Users who purchase packs"
              loading={loading}
            />
            <AdminStatsCard
              title="Pack Purchases"
              value={loading ? "..." : economyAnalytics ? economyAnalytics.packPurchaseCount.toLocaleString() : "0"}
              subtitle={`In ${timeRange}`}
              loading={loading}
            />
            <AdminStatsCard
              title="Avg 7-Day Jackpot"
              value={loading ? "..." : economyAnalytics ? `${economyAnalytics.avgJackpot7Day.toFixed(4)} ETH` : "0 ETH"}
              subtitle="Rolling average"
              loading={loading}
            />
            <AdminStatsCard
              title="Sustainability Score"
              value={loading ? "..." : economyAnalytics ? `${economyAnalytics.prizePoolSustainabilityScore.toFixed(1)}%` : "Coming soon"}
              subtitle="Creator rev + seed / jackpot"
              loading={loading}
            />
          </div>
        </AdminSection>

        {/* Gameplay Insights */}
        <AdminSection title="Gameplay insights">
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
            gap: "16px",
            marginBottom: "24px",
          }}>
            <AdminStatsCard
              title="Solve Rate"
              value={loading ? "..." : gameplayInsights ? `${gameplayInsights.solveRate.toFixed(1)}%` : "Coming soon"}
              subtitle="Rounds won vs started"
              loading={loading}
            />
            <AdminStatsCard
              title="Median Guesses to Solve"
              value={loading ? "..." : gameplayInsights ? gameplayInsights.medianGuessesToSolve.toFixed(1) : "Coming soon"}
              subtitle="Median across all wins"
              loading={loading}
            />
            <AdminStatsCard
              title="Avg Letters Correct"
              value={loading ? "..." : gameplayInsights ? gameplayInsights.avgLettersCorrectPerGuess.toFixed(2) : "Coming soon"}
              subtitle="Per guess"
              loading={loading}
            />
            <AdminStatsCard
              title="Hardest Word"
              value={loading ? "..." : gameplayInsights && gameplayInsights.hardestWords.length > 0 ? gameplayInsights.hardestWords[0].word : "Coming soon"}
              subtitle={gameplayInsights && gameplayInsights.hardestWords.length > 0 ? `${gameplayInsights.hardestWords[0].solveRate.toFixed(1)}% solve rate` : ""}
              loading={loading}
            />
          </div>
          {gameplayInsights && gameplayInsights.guessDistribution.length > 0 && (
            <AnalyticsChart
              data={gameplayInsights.guessDistribution.map(d => ({
                guesses: `${d.guessCount} guess${d.guessCount !== 1 ? 'es' : ''}`,
                "Rounds": d.rounds
              }))}
              type="bar"
              dataKey="Rounds"
              xAxisKey="guesses"
              title="Guess Distribution Histogram"
              colors={["#8b5cf6"]}
            />
          )}
        </AdminSection>

        {/* CLANKTON Analytics */}
        <AdminSection title="CLANKTON analytics">
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
            gap: "16px",
            marginBottom: "24px",
          }}>
            <AdminStatsCard
              title="CLANKTON Holders"
              value={loading ? "..." : clanktonAnalytics ? `${clanktonAnalytics.clanktonUserPercentage.toFixed(1)}%` : "Coming soon"}
              subtitle="Of total users"
              loading={loading}
            />
            <AdminStatsCard
              title="CLANKTON Solve Rate"
              value={loading ? "..." : clanktonAnalytics ? `${clanktonAnalytics.clanktonSolveRate.toFixed(1)}%` : "Coming soon"}
              subtitle="Holder solve rate"
              loading={loading}
            />
            <AdminStatsCard
              title="Regular Solve Rate"
              value={loading ? "..." : clanktonAnalytics ? `${clanktonAnalytics.regularSolveRate.toFixed(1)}%` : "Coming soon"}
              subtitle="Non-holder solve rate"
              loading={loading}
            />
            <AdminStatsCard
              title="Holder Advantage"
              value={loading ? "..." : clanktonAnalytics ? `+${(clanktonAnalytics.clanktonSolveRate - clanktonAnalytics.regularSolveRate).toFixed(1)}%` : "Coming soon"}
              subtitle="Solve rate difference"
              loading={loading}
            />
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
            gap: "16px",
          }}>
            <AdminStatsCard
              title="Avg Guesses (Holders)"
              value={loading ? "..." : clanktonAnalytics ? clanktonAnalytics.avgGuessesPerRoundClankton.toFixed(2) : "Coming soon"}
              subtitle="Per round per user"
              loading={loading}
            />
            <AdminStatsCard
              title="Avg Guesses (Regular)"
              value={loading ? "..." : clanktonAnalytics ? clanktonAnalytics.avgGuessesPerRoundRegular.toFixed(2) : "Coming soon"}
              subtitle="Per round per user"
              loading={loading}
            />
          </div>
        </AdminSection>

        {/* Share & Referral Funnel */}
        <AdminSection title="Share & referral funnel">
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
            gap: "16px",
            marginBottom: "24px",
          }}>
            <AdminStatsCard
              title="Share Prompts Shown"
              value={loading ? "..." : shareFunnelAnalytics ? shareFunnelAnalytics.sharePromptsShown.toLocaleString() : "Coming soon"}
              subtitle={`In ${timeRange}`}
              loading={loading}
            />
            <AdminStatsCard
              title="Share Clicks"
              value={loading ? "..." : shareFunnelAnalytics ? shareFunnelAnalytics.shareClicks.toLocaleString() : "Coming soon"}
              subtitle={`${shareFunnelAnalytics ? shareFunnelAnalytics.promptToClickRate.toFixed(1) : 0}% click rate`}
              loading={loading}
            />
            <AdminStatsCard
              title="Share Successes"
              value={loading ? "..." : shareFunnelAnalytics ? shareFunnelAnalytics.shareSuccesses.toLocaleString() : "Coming soon"}
              subtitle={`${shareFunnelAnalytics ? shareFunnelAnalytics.overallConversionRate.toFixed(1) : 0}% conversion`}
              loading={loading}
            />
            <AdminStatsCard
              title="Referral Joins"
              value={loading ? "..." : shareFunnelAnalytics ? shareFunnelAnalytics.referralJoins.toLocaleString() : "Coming soon"}
              subtitle={`${shareFunnelAnalytics ? shareFunnelAnalytics.shareToJoinRate.toFixed(1) : 0}% join rate`}
              loading={loading}
            />
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
            gap: "16px",
          }}>
            <AdminStatsCard
              title="Referral Guesses"
              value={loading ? "..." : shareFunnelAnalytics ? shareFunnelAnalytics.referralGuesses.toLocaleString() : "Coming soon"}
              subtitle="From referred users"
              loading={loading}
            />
            <AdminStatsCard
              title="Avg Bonus Guesses"
              value={loading ? "..." : shareFunnelAnalytics ? shareFunnelAnalytics.avgGuessesUnlockedViaShare.toFixed(1) : "Coming soon"}
              subtitle="Unlocked via sharing"
              loading={loading}
            />
          </div>
        </AdminSection>

      </div>
    </main>
  )
}

export default function AnalyticsPage() {
  return (
    <AdminAuthWrapper>
      <DashboardContent />
    </AdminAuthWrapper>
  )
}

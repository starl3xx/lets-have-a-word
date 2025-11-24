// pages/admin/analytics.tsx
import React, { useState, useEffect } from "react"
import dynamic from "next/dynamic"
import { AdminStatsCard } from "../../components/admin/AdminStatsCard"
import { AdminSection } from "../../components/admin/AdminSection"

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

function DashboardContent({ user, onSignOut }: DashboardContentProps) {
  const [dauData, setDauData] = useState<DAUData[]>([])
  const [guessData, setGuessData] = useState<GuessData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (user) {
      fetchAnalytics()
    }
  }, [user])

  const fetchAnalytics = async () => {
    if (!user) return

    setLoading(true)
    setError(null)

    try {
      const devFidParam = `?devFid=${user.fid}`

      // Fetch DAU data
      const dauResponse = await fetch(`/api/admin/analytics/dau${devFidParam}`)
      if (!dauResponse.ok) throw new Error('Failed to fetch DAU data')
      const dau = await dauResponse.json()
      setDauData(dau)

      // Fetch Free/Paid data
      const guessResponse = await fetch(`/api/admin/analytics/free-paid${devFidParam}`)
      if (!guessResponse.ok) throw new Error('Failed to fetch guess data')
      const guesses = await guessResponse.json()
      setGuessData(guesses)

    } catch (err) {
      console.error('Error fetching analytics:', err)
      setError(err instanceof Error ? err.message : 'Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }

  // Calculate stats from data
  const todayDAU = dauData[0]?.active_users || 0
  const yesterdayDAU = dauData[1]?.active_users || 0
  const avgDAU7 = dauData.slice(0, 7).reduce((sum, d) => sum + d.active_users, 0) / Math.min(7, dauData.length) || 0
  const avgDAU30 = dauData.reduce((sum, d) => sum + d.active_users, 0) / dauData.length || 0

  const totalFreeGuesses = guessData.reduce((sum, d) => sum + d.free_guesses, 0)
  const totalPaidGuesses = guessData.reduce((sum, d) => sum + d.paid_guesses, 0)
  const totalGuesses = totalFreeGuesses + totalPaidGuesses
  const avgRatio = guessData.length > 0
    ? guessData.reduce((sum, d) => sum + d.free_to_paid_ratio, 0) / guessData.length
    : 0

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
                Phase 3: Real data from Neon database
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
                    alt={user.username}
                    style={{
                      width: "40px",
                      height: "40px",
                      borderRadius: "50%",
                    }}
                  />
                )}
                <div style={{ textAlign: "right" }}>
                  <div style={{
                    fontSize: "14px",
                    fontWeight: 600,
                    color: "#111827",
                  }}>
                    @{user.username}
                  </div>
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
        <AdminSection title="Daily Active Users">
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
            gap: "16px",
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
        </AdminSection>

        {/* Guesses per Round */}
        <AdminSection title="Guesses per Round">
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
            gap: "16px",
          }}>
            <AdminStatsCard
              title="Total Guesses"
              value={loading ? "..." : totalGuesses.toLocaleString()}
              subtitle="Last 30 days"
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
        </AdminSection>

        {/* Revenue - Placeholder */}
        <AdminSection title="Revenue">
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
            gap: "16px",
          }}>
            <AdminStatsCard title="Total Revenue" value="Coming soon" subtitle="All time" />
            <AdminStatsCard title="This Month" value="Coming soon" subtitle="November 2025" />
            <AdminStatsCard title="Avg per User" value="Coming soon" subtitle="Per paying user" />
            <AdminStatsCard title="Conversion Rate" value="Coming soon" subtitle="Free to paid" />
          </div>
        </AdminSection>

        {/* Player Retention - Placeholder */}
        <AdminSection title="Player Retention">
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
            gap: "16px",
          }}>
            <AdminStatsCard title="Day 1" value="Coming soon" subtitle="Return rate" />
            <AdminStatsCard title="Day 7" value="Coming soon" subtitle="Return rate" />
            <AdminStatsCard title="Day 30" value="Coming soon" subtitle="Return rate" />
            <AdminStatsCard title="Avg Sessions" value="Coming soon" subtitle="Per week" />
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

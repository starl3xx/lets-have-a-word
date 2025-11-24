// pages/admin/analytics.tsx
import React from "react"
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
}

function DashboardContent({ user }: DashboardContentProps) {
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
                Phase 2: SIWN authentication added
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

        {/* Daily Active Users */}
        <AdminSection title="Daily Active Users">
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
            gap: "16px",
          }}>
            <AdminStatsCard title="Today" value="1,234" subtitle="Active players" />
            <AdminStatsCard title="Yesterday" value="1,156" subtitle="Active players" />
            <AdminStatsCard title="7-Day Average" value="1,189" subtitle="Active players" />
            <AdminStatsCard title="30-Day Average" value="1,067" subtitle="Active players" />
          </div>
        </AdminSection>

        {/* Guesses per Round */}
        <AdminSection title="Guesses per Round">
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
            gap: "16px",
          }}>
            <AdminStatsCard title="Total Rounds" value="45,678" subtitle="Since launch" />
            <AdminStatsCard title="Avg Guesses" value="3.4" subtitle="Per round" />
            <AdminStatsCard title="Free Guesses" value="32,145" subtitle="70% of total" />
            <AdminStatsCard title="Paid Guesses" value="13,533" subtitle="30% of total" />
          </div>
        </AdminSection>

        {/* Revenue */}
        <AdminSection title="Revenue">
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
            gap: "16px",
          }}>
            <AdminStatsCard title="Total Revenue" value="$12,345" subtitle="All time" />
            <AdminStatsCard title="This Month" value="$2,890" subtitle="November 2025" />
            <AdminStatsCard title="Avg per User" value="$2.45" subtitle="Per paying user" />
            <AdminStatsCard title="Conversion Rate" value="18.5%" subtitle="Free to paid" />
          </div>
        </AdminSection>

        {/* Player Retention */}
        <AdminSection title="Player Retention">
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
            gap: "16px",
          }}>
            <AdminStatsCard title="Day 1" value="67%" subtitle="Return rate" />
            <AdminStatsCard title="Day 7" value="42%" subtitle="Return rate" />
            <AdminStatsCard title="Day 30" value="28%" subtitle="Return rate" />
            <AdminStatsCard title="Avg Sessions" value="4.2" subtitle="Per week" />
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

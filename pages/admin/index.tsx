/**
 * Unified Admin Dashboard
 * Combines Operations, Analytics, and Archive into a single tabbed interface
 *
 * Tab Navigation:
 * - Operations: Kill switch, dead day, refund monitoring
 * - Analytics: Metrics, charts, economics data
 * - Archive: Historical round data
 */

import React, { useState, useEffect } from "react"
import dynamic from "next/dynamic"
import { useRouter } from "next/router"

// Dynamically import the auth wrapper (client-only)
const AdminAuthWrapper = dynamic(
  () => import("../../components/admin/AdminAuthWrapper").then(m => m.AdminAuthWrapper),
  { ssr: false, loading: () => <div style={{ padding: 24, fontFamily: 'Söhne, system-ui, sans-serif' }}>Loading...</div> }
)

// Dynamically import each dashboard section
const OperationsSection = dynamic(
  () => import("../../components/admin/OperationsSection"),
  { ssr: false, loading: () => <SectionLoader name="Operations" /> }
)

const AnalyticsSection = dynamic(
  () => import("../../components/admin/AnalyticsSection"),
  { ssr: false, loading: () => <SectionLoader name="Analytics" /> }
)

const ArchiveSection = dynamic(
  () => import("../../components/admin/ArchiveSection"),
  { ssr: false, loading: () => <SectionLoader name="Archive" /> }
)

// =============================================================================
// Types
// =============================================================================

type TabId = 'operations' | 'analytics' | 'archive'

interface DashboardContentProps {
  user?: {
    fid: number
    username: string
    display_name?: string
    pfp_url?: string
  }
  onSignOut?: () => void
}

// =============================================================================
// Styling
// =============================================================================

const fontFamily = "'Söhne', 'SF Pro Display', system-ui, -apple-system, sans-serif"

const styles = {
  page: {
    minHeight: "100vh",
    background: "#f8f9fa",
    fontFamily,
  },
  header: {
    background: "white",
    borderBottom: "1px solid #e5e7eb",
    padding: "16px 24px",
  },
  headerContent: {
    maxWidth: "1400px",
    margin: "0 auto",
    display: "flex" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
  },
  title: {
    fontSize: "22px",
    fontWeight: 700,
    color: "#111827",
    margin: 0,
    fontFamily,
  },
  subtitle: {
    fontSize: "13px",
    color: "#6b7280",
    margin: "4px 0 0 0",
    fontFamily,
  },
  userInfo: {
    display: "flex" as const,
    alignItems: "center" as const,
    gap: "12px",
  },
  signOutBtn: {
    padding: "6px 12px",
    background: "#6b7280",
    color: "white",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    fontSize: "12px",
    fontFamily,
  },
  tabBar: {
    background: "white",
    borderBottom: "1px solid #e5e7eb",
    padding: "0 24px",
  },
  tabBarInner: {
    maxWidth: "1400px",
    margin: "0 auto",
    display: "flex" as const,
    gap: "0",
  },
  tab: (isActive: boolean, color: string) => ({
    padding: "14px 24px",
    fontSize: "14px",
    fontWeight: 600,
    fontFamily,
    cursor: "pointer",
    border: "none",
    background: "transparent",
    color: isActive ? color : "#6b7280",
    borderBottom: isActive ? `3px solid ${color}` : "3px solid transparent",
    marginBottom: "-1px",
    transition: "all 0.15s ease",
  }),
  content: {
    maxWidth: "1400px",
    margin: "0 auto",
    padding: "24px",
  },
  loadingSection: {
    padding: "48px",
    textAlign: "center" as const,
    color: "#6b7280",
    fontFamily,
  },
}

// Tab configuration
const tabs: { id: TabId; label: string; color: string; icon: string }[] = [
  { id: 'operations', label: 'Operations', color: '#dc2626', icon: '🔧' },
  { id: 'analytics', label: 'Analytics', color: '#6366f1', icon: '📊' },
  { id: 'archive', label: 'Round Archive', color: '#6366f1', icon: '📁' },
]

// =============================================================================
// Loading Component
// =============================================================================

function SectionLoader({ name }: { name: string }) {
  return (
    <div style={styles.loadingSection}>
      Loading {name}...
    </div>
  )
}

// =============================================================================
// Dashboard Content
// =============================================================================

function DashboardContent({ user, onSignOut }: DashboardContentProps) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<TabId>('operations')

  // Sync tab with URL hash
  useEffect(() => {
    const hash = window.location.hash.slice(1) as TabId
    if (hash && tabs.some(t => t.id === hash)) {
      setActiveTab(hash)
    }
  }, [])

  const handleTabChange = (tabId: TabId) => {
    setActiveTab(tabId)
    // Update URL hash without triggering navigation
    window.history.replaceState(null, '', `#${tabId}`)
  }

  return (
    <div style={styles.page}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerContent}>
          <div>
            <h1 style={styles.title}>Admin Dashboard</h1>
            <p style={styles.subtitle}>Let's Have a Word — Unified Control Panel</p>
          </div>
          <div style={styles.userInfo}>
            {user?.pfp_url && (
              <img
                src={user.pfp_url}
                alt=""
                style={{ width: 36, height: 36, borderRadius: "50%" }}
              />
            )}
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "#111827" }}>
                {user?.username ? `@${user.username}` : user?.display_name || 'Admin'}
              </div>
              <div style={{ fontSize: "11px", color: "#6b7280" }}>FID: {user?.fid}</div>
            </div>
            {onSignOut && (
              <button onClick={onSignOut} style={styles.signOutBtn}>
                Sign Out
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Tab Bar */}
      <div style={styles.tabBar}>
        <div style={styles.tabBarInner}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              style={styles.tab(activeTab === tab.id, tab.color)}
            >
              <span style={{ marginRight: "8px" }}>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={styles.content}>
        {activeTab === 'operations' && <OperationsSection user={user} />}
        {activeTab === 'analytics' && <AnalyticsSection user={user} />}
        {activeTab === 'archive' && <ArchiveSection user={user} />}
      </div>
    </div>
  )
}

// =============================================================================
// Main Page
// =============================================================================

export default function AdminPage() {
  return (
    <AdminAuthWrapper>
      <DashboardContent />
    </AdminAuthWrapper>
  )
}

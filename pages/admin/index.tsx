/**
 * Unified Admin Dashboard
 * Combines Operations, Analytics, Archive, and Economics into a single tabbed interface
 *
 * Features:
 * - Tab Navigation with URL query params (?tab=operations|analytics|archive|economics)
 * - Persistent status strip showing operational state across all tabs
 * - Keyboard shortcuts (1/2/3/4) for fast tab switching
 */

import React, { useState, useEffect, useCallback } from "react"
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

const EconomicsSection = dynamic(
  () => import("../../components/admin/EconomicsSection"),
  { ssr: false, loading: () => <SectionLoader name="Economics" /> }
)

// =============================================================================
// Types
// =============================================================================

type TabId = 'operations' | 'analytics' | 'archive' | 'economics'

interface DashboardContentProps {
  user?: {
    fid: number
    username: string
    display_name?: string
    pfp_url?: string
  }
  onSignOut?: () => void
}

interface OperationalStatus {
  ok: boolean
  status: 'NORMAL' | 'KILL_SWITCH_ACTIVE' | 'DEAD_DAY_ACTIVE' | 'PAUSED_BETWEEN_ROUNDS'
  activeRoundId?: number
  killSwitch: {
    enabled: boolean
    activatedAt?: string
    reason?: string
  }
  deadDay: {
    enabled: boolean
    activatedAt?: string
  }
  timestamp: string
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
  // Status strip styles
  statusStrip: {
    background: "#fafafa",
    borderBottom: "1px solid #e5e7eb",
    padding: "10px 24px",
  },
  statusStripInner: {
    maxWidth: "1400px",
    margin: "0 auto",
    display: "flex" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    flexWrap: "wrap" as const,
    gap: "12px",
  },
  statusLeft: {
    display: "flex" as const,
    alignItems: "center" as const,
    gap: "16px",
    flexWrap: "wrap" as const,
  },
  statusItem: {
    display: "flex" as const,
    alignItems: "center" as const,
    gap: "6px",
    fontSize: "13px",
    color: "#374151",
    fontFamily,
  },
  statusLabel: {
    color: "#6b7280",
    fontSize: "11px",
    textTransform: "uppercase" as const,
    letterSpacing: "0.03em",
  },
  statusBadge: (status: string) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    padding: "3px 8px",
    borderRadius: "4px",
    fontSize: "12px",
    fontWeight: 600,
    background: status === 'NORMAL' ? "#dcfce7" :
                status === 'KILL_SWITCH_ACTIVE' ? "#fef3c7" :
                status === 'DEAD_DAY_ACTIVE' ? "#dbeafe" :
                "#f3f4f6",
    color: status === 'NORMAL' ? "#166534" :
           status === 'KILL_SWITCH_ACTIVE' ? "#92400e" :
           status === 'DEAD_DAY_ACTIVE' ? "#1e40af" :
           "#374151",
  }),
  statusDot: (status: string) => ({
    width: "6px",
    height: "6px",
    borderRadius: "50%",
    background: status === 'NORMAL' ? "#22c55e" :
                status === 'KILL_SWITCH_ACTIVE' ? "#f59e0b" :
                status === 'DEAD_DAY_ACTIVE' ? "#3b82f6" :
                "#9ca3af",
  }),
  // Tab bar styles
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
    display: "flex" as const,
    alignItems: "center" as const,
    gap: "8px",
  }),
  shortcutHint: {
    fontSize: "10px",
    fontWeight: 500,
    color: "#9ca3af",
    background: "#f3f4f6",
    padding: "2px 5px",
    borderRadius: "3px",
    marginLeft: "4px",
  },
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

// Tab configuration with keyboard shortcuts
const tabs: { id: TabId; label: string; color: string; icon: string; shortcut: string }[] = [
  { id: 'operations', label: 'Operations', color: '#dc2626', icon: '🔧', shortcut: '1' },
  { id: 'analytics', label: 'Analytics', color: '#6366f1', icon: '📊', shortcut: '2' },
  { id: 'archive', label: 'Round Archive', color: '#6366f1', icon: '📁', shortcut: '3' },
  { id: 'economics', label: 'Economics', color: '#059669', icon: '💰', shortcut: '4' },
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
// Status Strip Component
// =============================================================================

function StatusStrip({ user }: { user?: { fid: number } }) {
  const [status, setStatus] = useState<OperationalStatus | null>(null)

  const fetchStatus = useCallback(async () => {
    if (!user?.fid) return

    try {
      const res = await fetch(`/api/admin/operational/status?devFid=${user.fid}`)
      if (res.ok) {
        const data = await res.json()
        setStatus(data)
      }
    } catch {
      // Silent fail - status strip is informational
    }
  }, [user?.fid])

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 30000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  const getStatusLabel = (s: string) => {
    switch (s) {
      case 'NORMAL': return 'Normal'
      case 'KILL_SWITCH_ACTIVE': return 'Kill Switch'
      case 'DEAD_DAY_ACTIVE': return 'Dead Day'
      case 'PAUSED_BETWEEN_ROUNDS': return 'Paused'
      default: return s
    }
  }

  const getSinceTimestamp = () => {
    if (!status) return null
    if (status.status === 'KILL_SWITCH_ACTIVE' && status.killSwitch.activatedAt) {
      return status.killSwitch.activatedAt
    }
    if ((status.status === 'DEAD_DAY_ACTIVE' || status.status === 'PAUSED_BETWEEN_ROUNDS') && status.deadDay.activatedAt) {
      return status.deadDay.activatedAt
    }
    return null
  }

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    const today = new Date()
    if (date.toDateString() === today.toDateString()) {
      return `Today ${formatTime(dateStr)}`
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + formatTime(dateStr)
  }

  if (!status) {
    return (
      <div style={styles.statusStrip}>
        <div style={styles.statusStripInner}>
          <div style={{ fontSize: "12px", color: "#9ca3af" }}>Loading status...</div>
        </div>
      </div>
    )
  }

  const sinceTimestamp = getSinceTimestamp()

  return (
    <div style={styles.statusStrip}>
      <div style={styles.statusStripInner}>
        <div style={styles.statusLeft}>
          {/* Status */}
          <div style={styles.statusItem}>
            <span style={styles.statusLabel}>Status</span>
            <span style={styles.statusBadge(status.status)}>
              <span style={styles.statusDot(status.status)} />
              {getStatusLabel(status.status)}
            </span>
          </div>

          {/* Active Round */}
          <div style={styles.statusItem}>
            <span style={styles.statusLabel}>Round</span>
            <span style={{ fontWeight: 600 }}>
              {status.activeRoundId ? `#${status.activeRoundId}` : 'None'}
            </span>
          </div>

          {/* Since timestamp (when applicable) */}
          {sinceTimestamp && status.status !== 'NORMAL' && (
            <div style={styles.statusItem}>
              <span style={styles.statusLabel}>Since</span>
              <span>{formatDate(sinceTimestamp)}</span>
            </div>
          )}
        </div>

        {/* Last updated */}
        <div style={{ fontSize: "11px", color: "#9ca3af" }}>
          Updated {formatTime(status.timestamp)}
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Dashboard Content
// =============================================================================

function DashboardContent({ user, onSignOut }: DashboardContentProps) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<TabId>('operations')
  const [isInitialized, setIsInitialized] = useState(false)

  // Sync tab with URL query param on mount and when query changes
  useEffect(() => {
    const tabParam = router.query.tab as string
    if (tabParam && tabs.some(t => t.id === tabParam)) {
      setActiveTab(tabParam as TabId)
    } else if (!tabParam && isInitialized) {
      // If no tab param and already initialized, stay on current tab
    } else {
      // Default to operations
      setActiveTab('operations')
    }
    setIsInitialized(true)
  }, [router.query.tab, isInitialized])

  const handleTabChange = (tabId: TabId) => {
    setActiveTab(tabId)
    // Update URL with query param
    router.replace(
      { pathname: router.pathname, query: { tab: tabId } },
      undefined,
      { shallow: true }
    )
  }

  // Keyboard shortcuts for tab switching
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if focus is in input/textarea
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }

      // Don't interfere with modifier keys
      if (e.ctrlKey || e.metaKey || e.altKey) {
        return
      }

      switch (e.key) {
        case '1':
          handleTabChange('operations')
          break
        case '2':
          handleTabChange('analytics')
          break
        case '3':
          handleTabChange('archive')
          break
        case '4':
          handleTabChange('economics')
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

      {/* Status Strip */}
      <StatusStrip user={user} />

      {/* Tab Bar */}
      <div style={styles.tabBar}>
        <div style={styles.tabBarInner}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              style={styles.tab(activeTab === tab.id, tab.color)}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
              <span style={styles.shortcutHint}>{tab.shortcut}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={styles.content}>
        {activeTab === 'operations' && <OperationsSection user={user} />}
        {activeTab === 'analytics' && <AnalyticsSection user={user} />}
        {activeTab === 'archive' && <ArchiveSection user={user} />}
        {activeTab === 'economics' && <EconomicsSection user={user} />}
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

/**
 * Unified Admin Dashboard
 * Combines Operations, Analytics, Archive, Economics, and Wallet into a single tabbed interface
 *
 * Features:
 * - Tab Navigation with URL query params (?tab=operations|analytics|archive|economics|wallet)
 * - Persistent status strip showing operational state across all tabs
 * - Keyboard shortcuts (1/2/3/4/5) for fast tab switching
 */

import React, { useState, useEffect, useCallback } from "react"
import dynamic from "next/dynamic"
import { useRouter } from "next/router"
import { StatusPill, UpdatedStamp, type Severity } from "../../components/admin/ui"
import { formatCentralTime } from "../../components/admin/format"
import { OperationalStatusProvider, useOperationalStatus } from "../../components/admin/operational-status"
import { adminFont as fontFamily } from "../../components/admin/ui"

// Dynamically import the auth gate (client-only).
//
// Sign In With Farcaster, replacing Sign In With Neynar — Neynar retired SIWN
// on 2026-08-14 and stopped issuing new connections, so the old flow would
// have stranded anyone signing in on a new browser.
const AdminSiwfProvider = dynamic(
  () => import("../../components/admin/AdminSiwfGate").then(m => m.AdminSiwfProvider),
  { ssr: false, loading: () => <div style={{ padding: 24, fontFamily: 'Soehne, system-ui, sans-serif' }}>Loading...</div> }
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

const WalletSection = dynamic(
  () => import("../../components/admin/WalletSection"),
  { ssr: false, loading: () => <SectionLoader name="Wallet" /> }
)

const SocialSection = dynamic(
  () => import("../../components/admin/SocialSection"),
  { ssr: false, loading: () => <SectionLoader name="Social" /> }
)

const AirdropSection = dynamic(
  () => import("../../components/admin/AirdropManagerSection"),
  { ssr: false, loading: () => <SectionLoader name="Airdrop" /> }
)

// =============================================================================
// Types
// =============================================================================

type TabId = 'operations' | 'analytics' | 'archive' | 'economics' | 'wallet' | 'social' | 'airdrop'

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
  { id: 'analytics', label: 'Analytics', color: '#6366f1', icon: '📊', shortcut: '1' },
  { id: 'archive', label: 'Round Archive', color: '#6366f1', icon: '📁', shortcut: '2' },
  { id: 'economics', label: 'Economics', color: '#059669', icon: '💰', shortcut: '3' },
  { id: 'wallet', label: 'Treasury', color: '#7c3aed', icon: '💼', shortcut: '4' },
  { id: 'social', label: 'Social', color: '#1DA1F2', icon: '📣', shortcut: '5' },
  { id: 'operations', label: 'Operations', color: '#dc2626', icon: '🔧', shortcut: '6' },
  // Airdrop tab is BURIED, not deleted (decided 2026-08-17): the CLANKTON→
  // $WORD campaign is dormant but the operator wants the infra kept. No tab
  // button, no shortcut — the manager still renders at /admin?tab=airdrop.
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
  const { status } = useOperationalStatus()

  const getStatusLabel = (s: string) => {
    switch (s) {
      case 'NORMAL': return 'Normal'
      case 'KILL_SWITCH_ACTIVE': return 'Kill Switch'
      case 'DEAD_DAY_ACTIVE': return 'Dead Day'
      case 'PAUSED_BETWEEN_ROUNDS': return 'Paused'
      default: return s
    }
  }

  // Shared-vocabulary severity for the one header verdict (Phase 0 rules:
  // color + icon + word, red only when action is needed now).
  const getStatusSeverity = (s: string): Severity => {
    switch (s) {
      case 'NORMAL': return 'ok'
      case 'KILL_SWITCH_ACTIVE': return 'alert'
      case 'DEAD_DAY_ACTIVE': return 'watch'
      case 'PAUSED_BETWEEN_ROUNDS': return 'watch'
      default: return 'info'
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

  // The strip reads in Central like everything else in the admin. "Today" has to
  // be decided on the Central calendar day as well: toDateString() buckets in
  // the browser's zone, so the strip flipped between "Today" and a dated label
  // depending on where the laptop was.
  const centralDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    if (centralDay(date) === centralDay(new Date())) {
      return `Today ${formatCentralTime(dateStr)}`
    }
    const day = date.toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' })
    return `${day} ${formatCentralTime(dateStr)}`
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
            <StatusPill severity={getStatusSeverity(status.status)}>
              {getStatusLabel(status.status)}
            </StatusPill>
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

          {/* $WORD contract indicator. Green mirrors isWordEconomyConfigured()
              (WordJackpot + WordPackSales) plus WordManager: any partial
              combination means round starts still take the ETH path while the
              strip glows green. Amber = partially configured. */}
          {(() => {
            const missing = [
              !status.wordManagerConfigured && 'WORD_MANAGER_ADDRESS',
              !status.wordJackpotConfigured && 'WORD_JACKPOT_ADDRESS',
              !status.wordPackSalesConfigured && 'WORD_PACK_SALES_ADDRESS',
            ].filter(Boolean) as string[];
            const wordReady = missing.length === 0;
            const wordPartial = !wordReady && missing.length < 3;
            return (
          <div style={styles.statusItem} title={
            wordReady ? 'WordManager + WordJackpot + WordPackSales configured'
              : `Missing: ${missing.join(', ')}`
          }>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px 8px',
              borderRadius: '4px',
              fontSize: '11px',
              fontWeight: 600,
              background: wordReady ? '#dcfce7' : wordPartial ? '#fef3c7' : '#f3f4f6',
              color: wordReady ? '#166534' : wordPartial ? '#92400e' : '#9ca3af',
            }}>
              <span style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: wordReady ? '#22c55e' : wordPartial ? '#f59e0b' : '#d1d5db',
              }} />
              $WORD
            </span>
          </div>
            );
          })()}
        </div>

        {/* Last updated — turns amber when polling silently stops. This week's
            failure mode: the strip said Normal while dead day was armed. */}
        <UpdatedStamp updatedAt={status.timestamp} staleAfterMs={2 * 60 * 1000} />
      </div>
    </div>
  )
}

// =============================================================================
// Dashboard Content
// =============================================================================

function DashboardContent({ user, onSignOut }: DashboardContentProps) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<TabId>('analytics')
  const [isInitialized, setIsInitialized] = useState(false)
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [walletBalance, setWalletBalance] = useState<string | null>(null)

  // Check for browser-connected wallet and get balance
  useEffect(() => {
    const checkWallet = async () => {
      if (typeof window === 'undefined' || !window.ethereum) return

      try {
        const accounts = await window.ethereum.request({ method: 'eth_accounts' })
        if (accounts && accounts.length > 0) {
          const address = accounts[0]
          setWalletAddress(address)

          // Get balance using ethers
          const { ethers } = await import('ethers')
          const provider = new ethers.BrowserProvider(window.ethereum)
          const balance = await provider.getBalance(address)
          setWalletBalance(ethers.formatEther(balance))
        }
      } catch {
        // Silent fail - wallet display is optional
      }
    }

    checkWallet()

    // Listen for account changes
    if (typeof window !== 'undefined' && window.ethereum) {
      window.ethereum.on('accountsChanged', checkWallet)
      return () => window.ethereum?.removeListener('accountsChanged', checkWallet)
    }
  }, [])

  // Sync tab with URL query param on mount and when query changes
  useEffect(() => {
    const tabParam = router.query.tab as string
    // 'airdrop' has no tab button but stays deep-linkable (buried, not deleted).
    if (tabParam && (tabs.some(t => t.id === tabParam) || tabParam === 'airdrop')) {
      setActiveTab(tabParam as TabId)
    } else if (!tabParam && isInitialized) {
      // If no tab param and already initialized, stay on current tab
    } else {
      // Default to analytics
      setActiveTab('analytics')
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
          handleTabChange('analytics')
          break
        case '2':
          handleTabChange('archive')
          break
        case '3':
          handleTabChange('economics')
          break
        case '4':
          handleTabChange('wallet')
          break
        case '5':
          handleTabChange('social')
          break
        case '6':
          handleTabChange('operations')
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <OperationalStatusProvider fid={user?.fid}>
    <div style={styles.page}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerContent}>
          <div>
            <h1 style={styles.title}>Admin Dashboard</h1>
            <p style={styles.subtitle}>Let's Have a Word — Unified Control Panel</p>
          </div>
          <div style={styles.userInfo}>
            {/* Connected Wallet Balance */}
            {walletAddress && (
              <div style={{
                padding: "8px 14px",
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                borderRadius: "8px",
                marginRight: "12px",
              }}>
                <div style={{ fontSize: "11px", color: "#166534", marginBottom: "2px" }}>
                  {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
                </div>
                <div style={{ fontSize: "15px", fontWeight: 600, color: "#111827" }}>
                  {walletBalance ? parseFloat(walletBalance).toFixed(4) : '--'} ETH
                </div>
              </div>
            )}
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
        {activeTab === 'wallet' && <WalletSection user={user} />}
        {activeTab === 'social' && <SocialSection user={user} />}
        {activeTab === 'airdrop' && <AirdropSection user={user} />}
      </div>
    </div>
    </OperationalStatusProvider>
  )
}

// =============================================================================
// Main Page
// =============================================================================

export default function AdminPage() {
  return (
    <AdminSiwfProvider>
      <DashboardContent />
    </AdminSiwfProvider>
  )
}

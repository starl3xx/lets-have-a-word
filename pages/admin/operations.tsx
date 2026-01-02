/**
 * Admin Operations Dashboard
 * Milestone 9.5: Kill Switch and Dead Day Controls
 *
 * Provides admin UI for:
 * - Viewing operational status
 * - Enabling/disabling kill switch
 * - Enabling/disabling dead day
 * - Viewing refund status
 */

import React, { useState, useEffect, useCallback } from "react"
import dynamic from "next/dynamic"

// Dynamically import the auth wrapper (client-only)
const AdminAuthWrapper = dynamic(
  () => import("../../components/admin/AdminAuthWrapper").then(m => m.AdminAuthWrapper),
  { ssr: false, loading: () => <div style={{ padding: 24, fontFamily: 'Soehne, system-ui, sans-serif' }}>Loading...</div> }
)

// =============================================================================
// Types
// =============================================================================

interface OperationalStatus {
  ok: boolean
  status: 'NORMAL' | 'KILL_SWITCH_ACTIVE' | 'DEAD_DAY_ACTIVE' | 'PAUSED_BETWEEN_ROUNDS'
  activeRoundId?: number
  killSwitch: {
    enabled: boolean
    activatedAt?: string
    reason?: string
    roundId?: number
    activatedBy?: number
    refundsRunning?: boolean
  }
  deadDay: {
    enabled: boolean
    activatedAt?: string
    reason?: string
    reopenAt?: string
    appliesAfterRoundId?: number
    activatedBy?: number
  }
  cancelledRounds: Array<{
    roundId: number
    cancelledAt: string
    cancelledReason?: string
    cancelledBy?: number
    refundsStartedAt?: string
    refundsCompletedAt?: string
    refunds: {
      total: number
      pending: number
      processing: number
      sent: number
      failed: number
      totalAmountEth: string
    }
  }>
  refundCron?: {
    lastRun: string | null
    lastResult: {
      roundsProcessed: number
      totalSent: number
      totalFailed: number
      durationMs: number
      timestamp: string
    } | null
    nextRunEstimate: string
  }
  timestamp: string
}

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
// Styles
// =============================================================================

const styles = {
  container: {
    minHeight: "100vh",
    background: "#f9fafb",
    fontFamily: "'Soehne', 'SF Pro Display', system-ui, -apple-system, sans-serif",
  },
  header: {
    background: "white",
    borderBottom: "1px solid #e5e7eb",
    padding: "16px 24px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: {
    fontSize: "20px",
    fontWeight: 600,
    color: "#111827",
    margin: 0,
  },
  userInfo: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  signOutBtn: {
    padding: "6px 12px",
    background: "#f3f4f6",
    border: "1px solid #e5e7eb",
    borderRadius: "6px",
    fontSize: "13px",
    color: "#374151",
    cursor: "pointer",
  },
  main: {
    maxWidth: "900px",
    margin: "0 auto",
    padding: "24px",
  },
  card: {
    background: "white",
    borderRadius: "12px",
    border: "1px solid #e5e7eb",
    padding: "24px",
    marginBottom: "24px",
  },
  cardTitle: {
    fontSize: "16px",
    fontWeight: 600,
    color: "#111827",
    margin: "0 0 16px 0",
  },
  statusBadge: (status: string) => ({
    display: "inline-block",
    padding: "4px 12px",
    borderRadius: "9999px",
    fontSize: "13px",
    fontWeight: 500,
    background: status === 'NORMAL' ? "#dcfce7" :
                status === 'KILL_SWITCH_ACTIVE' ? "#fef3c7" :
                "#dbeafe",
    color: status === 'NORMAL' ? "#166534" :
           status === 'KILL_SWITCH_ACTIVE' ? "#92400e" :
           "#1e40af",
  }),
  label: {
    display: "block",
    fontSize: "13px",
    fontWeight: 500,
    color: "#374151",
    marginBottom: "6px",
  },
  input: {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid #d1d5db",
    borderRadius: "8px",
    fontSize: "14px",
    outline: "none",
  },
  textarea: {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid #d1d5db",
    borderRadius: "8px",
    fontSize: "14px",
    outline: "none",
    resize: "vertical" as const,
    minHeight: "80px",
  },
  btnPrimary: {
    padding: "10px 20px",
    background: "#2563eb",
    color: "white",
    border: "none",
    borderRadius: "8px",
    fontSize: "14px",
    fontWeight: 500,
    cursor: "pointer",
  },
  btnDanger: {
    padding: "10px 20px",
    background: "#dc2626",
    color: "white",
    border: "none",
    borderRadius: "8px",
    fontSize: "14px",
    fontWeight: 500,
    cursor: "pointer",
  },
  btnSuccess: {
    padding: "10px 20px",
    background: "#16a34a",
    color: "white",
    border: "none",
    borderRadius: "8px",
    fontSize: "14px",
    fontWeight: 500,
    cursor: "pointer",
  },
  btnSecondary: {
    padding: "10px 20px",
    background: "#f3f4f6",
    color: "#374151",
    border: "1px solid #d1d5db",
    borderRadius: "8px",
    fontSize: "14px",
    fontWeight: 500,
    cursor: "pointer",
  },
  infoRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "8px 0",
    borderBottom: "1px solid #f3f4f6",
    fontSize: "14px",
  },
  infoLabel: {
    color: "#6b7280",
  },
  infoValue: {
    color: "#111827",
    fontWeight: 500,
  },
  alert: (type: 'error' | 'success' | 'warning') => ({
    padding: "12px 16px",
    borderRadius: "8px",
    marginBottom: "16px",
    fontSize: "14px",
    background: type === 'error' ? "#fef2f2" :
                type === 'success' ? "#f0fdf4" :
                "#fffbeb",
    color: type === 'error' ? "#dc2626" :
           type === 'success' ? "#16a34a" :
           "#d97706",
    border: `1px solid ${type === 'error' ? "#fecaca" :
                         type === 'success' ? "#bbf7d0" :
                         "#fde68a"}`,
  }),
}

// =============================================================================
// Dashboard Content Component
// =============================================================================

function DashboardContent({ user, onSignOut }: DashboardContentProps) {
  const [status, setStatus] = useState<OperationalStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  // Form states
  const [killSwitchReason, setKillSwitchReason] = useState("")
  const [deadDayReason, setDeadDayReason] = useState("")
  const [deadDayReopenAt, setDeadDayReopenAt] = useState("")

  // Start Round state
  const [startRoundLoading, setStartRoundLoading] = useState(false)

  // Reset for Launch state
  const [resetLoading, setResetLoading] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  // Kill Switch confirmation states
  const [showKillSwitchConfirm, setShowKillSwitchConfirm] = useState(false)
  const [killSwitchConfirmText, setKillSwitchConfirmText] = useState("")
  const KILL_SWITCH_CONFIRM_PHRASE = "CANCEL ROUND"

  // Copy feedback state
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null)

  // XP Award state
  const [xpTargetFid, setXpTargetFid] = useState("")
  const [xpEventType, setXpEventType] = useState("")
  const [xpReason, setXpReason] = useState("")
  const [xpLoading, setXpLoading] = useState(false)

  // XP event options with labels and values
  const xpEventOptions = [
    { value: 'DAILY_PARTICIPATION', label: 'Daily participation (+10 XP)', xp: 10 },
    { value: 'GUESS', label: 'Valid guess (+2 XP)', xp: 2 },
    { value: 'WIN', label: 'Winning jackpot (+2500 XP)', xp: 2500 },
    { value: 'TOP_TEN_GUESSER', label: 'Top 10 placement (+50 XP)', xp: 50 },
    { value: 'REFERRAL_FIRST_GUESS', label: 'Referred user first guess (+20 XP)', xp: 20 },
    { value: 'STREAK_DAY', label: 'Consecutive day streak (+15 XP)', xp: 15 },
    { value: 'CLANKTON_BONUS_DAY', label: 'CLANKTON holder daily (+10 XP)', xp: 10 },
    { value: 'SHARE_CAST', label: 'Sharing to Farcaster (+15 XP)', xp: 15 },
    { value: 'PACK_PURCHASE', label: 'Buying guess pack (+20 XP)', xp: 20 },
    { value: 'OG_HUNTER_AWARD', label: 'OG Hunter badge (+500 XP)', xp: 500 },
  ]

  const fetchStatus = useCallback(async () => {
    if (!user?.fid) return

    try {
      setLoading(true)
      const res = await fetch(`/api/admin/operational/status?devFid=${user.fid}`)
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch status')
      }

      setStatus(data)
      setError(null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [user?.fid])

  useEffect(() => {
    fetchStatus()
    // Refresh every 30 seconds
    const interval = setInterval(fetchStatus, 30000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  const handleEnableKillSwitch = async () => {
    if (!killSwitchReason || killSwitchReason.length < 10) {
      setError("Reason must be at least 10 characters")
      return
    }

    try {
      setActionLoading(true)
      setError(null)

      const res = await fetch('/api/admin/operational/kill-switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          devFid: user?.fid,
          action: 'enable',
          reason: killSwitchReason,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to enable kill switch')
      }

      setSuccess(`Kill switch enabled. Round ${data.roundId} cancelled. ${data.refundsCreated} refunds created.`)
      setKillSwitchReason("")
      setShowKillSwitchConfirm(false)
      setKillSwitchConfirmText("")
      await fetchStatus()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setActionLoading(false)
    }
  }

  const handleDisableKillSwitch = async () => {
    try {
      setActionLoading(true)
      setError(null)

      const res = await fetch('/api/admin/operational/kill-switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          devFid: user?.fid,
          action: 'disable',
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to disable kill switch')
      }

      setSuccess("Kill switch disabled. A new round can now be created.")
      await fetchStatus()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setActionLoading(false)
    }
  }

  const handleEnableDeadDay = async () => {
    if (!deadDayReason || deadDayReason.length < 10) {
      setError("Reason must be at least 10 characters")
      return
    }

    try {
      setActionLoading(true)
      setError(null)

      const body: any = {
        devFid: user?.fid,
        action: 'enable',
        reason: deadDayReason,
      }

      if (deadDayReopenAt) {
        body.reopenAt = new Date(deadDayReopenAt).toISOString()
      }

      const res = await fetch('/api/admin/operational/dead-day', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to enable dead day')
      }

      setSuccess(data.message)
      setDeadDayReason("")
      setDeadDayReopenAt("")
      await fetchStatus()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setActionLoading(false)
    }
  }

  const handleDisableDeadDay = async () => {
    try {
      setActionLoading(true)
      setError(null)

      const res = await fetch('/api/admin/operational/dead-day', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          devFid: user?.fid,
          action: 'disable',
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to disable dead day')
      }

      setSuccess("Dead day disabled. Normal round progression will resume.")
      await fetchStatus()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setActionLoading(false)
    }
  }

  const handleStartRound = async () => {
    try {
      setStartRoundLoading(true)
      setError(null)

      const res = await fetch(`/api/admin/operational/start-round?devFid=${user?.fid}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })

      // Safely parse response - handle empty or invalid JSON
      const text = await res.text()
      let data: any = {}
      if (text) {
        try {
          data = JSON.parse(text)
        } catch {
          throw new Error(`Server returned invalid response: ${text.slice(0, 100) || '(empty)'}`)
        }
      }

      if (!res.ok) {
        throw new Error(data.error || data.message || `Failed to start round (${res.status})`)
      }

      if (!data.roundId) {
        throw new Error('Server returned success but no round ID')
      }

      setSuccess(`Round #${data.roundId} started successfully! Commit hash: ${data.commitHash?.slice(0, 16)}...`)
      await fetchStatus()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setStartRoundLoading(false)
    }
  }

  const handleResetForLaunch = async () => {
    try {
      setResetLoading(true)
      setError(null)

      const res = await fetch(`/api/admin/reset-for-launch?devFid=${user?.fid}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ confirm: 'RESET_FOR_LAUNCH' }),
      })

      const text = await res.text()
      let data: any = {}
      if (text) {
        try {
          data = JSON.parse(text)
        } catch {
          throw new Error(`Server returned invalid response: ${text.slice(0, 100) || '(empty)'}`)
        }
      }

      if (!res.ok) {
        throw new Error(data.message || data.error || `Failed to reset (${res.status})`)
      }

      setSuccess(`Database reset! Deleted ${data.deletedRounds} rounds and ${data.deletedGuesses} guesses. Ready for Round #1!`)
      setShowResetConfirm(false)
      await fetchStatus()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setResetLoading(false)
    }
  }

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleString()
  }

  const getRelativeTime = (dateStr?: string) => {
    if (!dateStr) return null
    const targetTime = new Date(dateStr).getTime()
    const now = Date.now()
    const diffMs = targetTime - now

    if (diffMs <= 0) return 'now'

    const diffMin = Math.round(diffMs / 60000)
    if (diffMin < 1) return 'in <1 min'
    if (diffMin === 1) return 'in ~1 min'
    if (diffMin < 60) return `in ~${diffMin} min`

    const diffHours = Math.round(diffMin / 60)
    return `in ~${diffHours} hr`
  }

  const copyIncidentSummary = async () => {
    if (!status) return

    const lines: string[] = []
    lines.push('=== LET\'S HAVE A WORD - INCIDENT SUMMARY ===')
    lines.push('')

    // Status
    const statusLabels: Record<string, string> = {
      'NORMAL': 'Normal Operations',
      'KILL_SWITCH_ACTIVE': 'KILL SWITCH ACTIVE',
      'DEAD_DAY_ACTIVE': 'Dead Day (Round Active)',
      'PAUSED_BETWEEN_ROUNDS': 'Paused Between Rounds',
    }
    lines.push(`Status: ${statusLabels[status.status] || status.status}`)

    // Active round
    if (status.activeRoundId) {
      lines.push(`Active Round: #${status.activeRoundId}`)
    } else {
      lines.push('Active Round: None')
    }

    // Kill switch details
    if (status.killSwitch.enabled) {
      lines.push('')
      lines.push('--- Kill Switch ---')
      if (status.killSwitch.activatedAt) {
        lines.push(`Activated: ${formatDate(status.killSwitch.activatedAt)}`)
      }
      if (status.killSwitch.reason) {
        lines.push(`Reason: ${status.killSwitch.reason}`)
      }
      if (status.killSwitch.roundId) {
        lines.push(`Cancelled Round: #${status.killSwitch.roundId}`)
      }

      // Refund details
      const cancelledRound = status.cancelledRounds.find(r => r.roundId === status.killSwitch.roundId)
      if (cancelledRound?.refunds) {
        const r = cancelledRound.refunds
        lines.push('')
        lines.push('--- Refund Progress ---')
        lines.push(`Total: ${r.total} | Sent: ${r.sent} | In Progress: ${r.pending + r.processing} | Failed: ${r.failed}`)
        lines.push(`Total ETH: ${parseFloat(r.totalAmountEth).toFixed(6)} ETH`)
        if (cancelledRound.refundsCompletedAt) {
          lines.push(`Completed: ${formatDate(cancelledRound.refundsCompletedAt)}`)
        }
      }
    }

    // Dead day details
    if (status.deadDay.enabled) {
      lines.push('')
      lines.push('--- Dead Day ---')
      if (status.deadDay.activatedAt) {
        lines.push(`Activated: ${formatDate(status.deadDay.activatedAt)}`)
      }
      if (status.deadDay.reason) {
        lines.push(`Reason: ${status.deadDay.reason}`)
      }
      if (status.deadDay.reopenAt) {
        lines.push(`Scheduled Reopen: ${formatDate(status.deadDay.reopenAt)}`)
      }
    }

    // Cron timing
    if (status.refundCron && status.killSwitch.enabled) {
      lines.push('')
      lines.push('--- Refund Cron ---')
      lines.push(`Last Run: ${status.refundCron.lastRun ? formatDate(status.refundCron.lastRun) : 'Never'}`)
      lines.push(`Next Run: ${getRelativeTime(status.refundCron.nextRunEstimate) || formatDate(status.refundCron.nextRunEstimate)}`)
    }

    // Timestamp
    lines.push('')
    lines.push(`Generated: ${formatDate(status.timestamp)}`)

    const summary = lines.join('\n')

    try {
      await navigator.clipboard.writeText(summary)
      setCopyFeedback('Copied!')
      setTimeout(() => setCopyFeedback(null), 2000)
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea')
      textarea.value = summary
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopyFeedback('Copied!')
      setTimeout(() => setCopyFeedback(null), 2000)
    }
  }

  const handleAwardXp = async () => {
    if (!user?.fid) return

    const targetFid = parseInt(xpTargetFid, 10)
    if (isNaN(targetFid) || targetFid <= 0) {
      setError('Please enter a valid FID')
      return
    }

    if (!xpEventType) {
      setError('Please select an XP event type')
      return
    }

    try {
      setXpLoading(true)
      setError(null)
      setSuccess(null)

      const res = await fetch('/api/admin/award-xp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          devFid: user.fid,
          targetFid,
          eventType: xpEventType,
          reason: xpReason || undefined,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to award XP')
      }

      setSuccess(`${data.message}`)
      // Clear form on success
      setXpTargetFid('')
      setXpEventType('')
      setXpReason('')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setXpLoading(false)
    }
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>Operations Dashboard</h1>
          <p style={{ fontSize: "13px", color: "#6b7280", margin: "4px 0 0 0" }}>
            Milestone 9.5 — Kill Switch & Dead Day Controls
          </p>
        </div>
        <div style={styles.userInfo}>
          <a
            href="/admin/analytics"
            style={{
              padding: "8px 14px",
              background: "#6366f1",
              color: "white",
              borderRadius: "6px",
              textDecoration: "none",
              fontSize: "13px",
              fontWeight: 500,
            }}
          >
            Analytics
          </a>
          <a
            href="/admin/archive"
            style={{
              padding: "8px 14px",
              background: "#6366f1",
              color: "white",
              borderRadius: "6px",
              textDecoration: "none",
              fontSize: "13px",
              fontWeight: 500,
            }}
          >
            Round Archive
          </a>
          {user?.pfp_url && (
            <img
              src={user.pfp_url}
              alt=""
              style={{ width: 32, height: 32, borderRadius: "50%" }}
            />
          )}
          <span style={{ fontSize: "14px", color: "#374151" }}>
            @{user?.username}
          </span>
          <button style={styles.signOutBtn} onClick={onSignOut}>
            Sign Out
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main style={styles.main}>
        {/* Alerts */}
        {error && (
          <div style={styles.alert('error')}>
            {error}
            <button
              onClick={() => setError(null)}
              style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              &times;
            </button>
          </div>
        )}
        {success && (
          <div style={styles.alert('success')}>
            {success}
            <button
              onClick={() => setSuccess(null)}
              style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              &times;
            </button>
          </div>
        )}

        {loading && !status ? (
          <div style={{ textAlign: 'center', padding: '48px', color: '#6b7280' }}>
            Loading operational status...
          </div>
        ) : status ? (
          <>
            {/* Current Status Card */}
            <div style={styles.card}>
              <h2 style={styles.cardTitle}>Current Status</h2>
              <div style={{ marginBottom: "16px", display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '24px' }}>
                  {status.status === 'NORMAL' && '🟢'}
                  {status.status === 'KILL_SWITCH_ACTIVE' && '🔴'}
                  {status.status === 'DEAD_DAY_ACTIVE' && '🟡'}
                  {status.status === 'PAUSED_BETWEEN_ROUNDS' && '⏸️'}
                </span>
                <div>
                  <span style={styles.statusBadge(status.status)}>
                    {status.status === 'NORMAL' && 'Normal Operations'}
                    {status.status === 'KILL_SWITCH_ACTIVE' && 'Kill Switch Active'}
                    {status.status === 'DEAD_DAY_ACTIVE' && 'Dead Day (Round Active)'}
                    {status.status === 'PAUSED_BETWEEN_ROUNDS' && 'Paused Between Rounds'}
                  </span>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
                    {status.status === 'KILL_SWITCH_ACTIVE' && status.killSwitch.activatedAt &&
                      `Since ${formatDate(status.killSwitch.activatedAt)}`}
                    {status.status === 'DEAD_DAY_ACTIVE' && status.deadDay.activatedAt &&
                      `Since ${formatDate(status.deadDay.activatedAt)}`}
                    {status.status === 'PAUSED_BETWEEN_ROUNDS' && status.deadDay.activatedAt &&
                      `Since ${formatDate(status.deadDay.activatedAt)}`}
                    {status.status === 'NORMAL' && 'All systems operational'}
                  </div>
                  {/* Blast radius descriptor */}
                  <div style={{ fontSize: '12px', fontStyle: 'italic', color: '#9ca3af', marginTop: '2px' }}>
                    {status.status === 'KILL_SWITCH_ACTIVE' && 'All gameplay blocked, refunds processing'}
                    {status.status === 'DEAD_DAY_ACTIVE' && 'Current round active, no new rounds after'}
                    {status.status === 'PAUSED_BETWEEN_ROUNDS' && 'No active round, waiting for manual resume'}
                  </div>
                </div>
              </div>
              <div style={styles.infoRow}>
                <span style={styles.infoLabel}>Active Round</span>
                <span style={styles.infoValue}>
                  {status.activeRoundId ? `Round #${status.activeRoundId}` : 'None'}
                </span>
              </div>
              <div style={styles.infoRow}>
                <span style={styles.infoLabel}>Last Updated</span>
                <span style={styles.infoValue}>{formatDate(status.timestamp)}</span>
              </div>
              <div style={{ display: 'flex', gap: '12px', marginTop: '12px', alignItems: 'center' }}>
                <button
                  onClick={fetchStatus}
                  style={styles.btnSecondary}
                  disabled={loading}
                >
                  {loading ? 'Refreshing...' : 'Refresh'}
                </button>
                {status.status !== 'NORMAL' && (
                  <button
                    onClick={copyIncidentSummary}
                    style={{
                      ...styles.btnSecondary,
                      background: '#f0f9ff',
                      borderColor: '#bae6fd',
                      color: '#0369a1',
                    }}
                  >
                    {copyFeedback || 'Copy incident summary'}
                  </button>
                )}
              </div>
            </div>

            {/* Reset for Launch Card - for clearing test data */}
            <div style={{
              ...styles.card,
              background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
              border: '2px solid #f59e0b',
            }}>
              <h2 style={{ ...styles.cardTitle, color: '#92400e' }}>
                🔄 Reset for Launch
              </h2>
              <p style={{ fontSize: '14px', color: '#78350f', marginBottom: '16px' }}>
                Clear all test data and reset to Round #1 for a fresh launch.
              </p>
              <div style={{
                background: 'white',
                borderRadius: '8px',
                padding: '12px 16px',
                marginBottom: '16px',
                fontSize: '13px',
                color: '#374151',
              }}>
                <strong>⚠️ This will permanently delete:</strong>
                <ul style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
                  <li>All rounds (including active round)</li>
                  <li>All guesses</li>
                  <li>All round archives</li>
                  <li>Reset round IDs to start at 1</li>
                </ul>
              </div>
              {!showResetConfirm ? (
                <button
                  onClick={() => setShowResetConfirm(true)}
                  style={{
                    ...styles.btnSecondary,
                    width: '100%',
                    padding: '14px 20px',
                    fontSize: '16px',
                    background: '#fef3c7',
                    borderColor: '#f59e0b',
                    color: '#92400e',
                  }}
                >
                  Reset Database for Launch
                </button>
              ) : (
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button
                    onClick={handleResetForLaunch}
                    disabled={resetLoading}
                    style={{
                      ...styles.btnDanger,
                      flex: 1,
                      padding: '14px 20px',
                      fontSize: '16px',
                      opacity: resetLoading ? 0.7 : 1,
                    }}
                  >
                    {resetLoading ? 'Resetting...' : '⚠️ CONFIRM RESET'}
                  </button>
                  <button
                    onClick={() => setShowResetConfirm(false)}
                    style={{
                      ...styles.btnSecondary,
                      padding: '14px 20px',
                      fontSize: '16px',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {/* Start Round Card - only show when no active round */}
            {!status.activeRoundId && !status.killSwitch.enabled && (
              <div style={{
                ...styles.card,
                background: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)',
                border: '2px solid #10b981',
              }}>
                <h2 style={{ ...styles.cardTitle, color: '#065f46' }}>
                  🚀 Start New Round
                </h2>
                <p style={{ fontSize: '14px', color: '#047857', marginBottom: '16px' }}>
                  No active round. Click below to start a new round with a random secret word.
                </p>
                <div style={{
                  background: 'white',
                  borderRadius: '8px',
                  padding: '12px 16px',
                  marginBottom: '16px',
                  fontSize: '13px',
                  color: '#374151',
                }}>
                  <strong>This will:</strong>
                  <ul style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
                    <li>Select a random secret word</li>
                    <li>Create onchain commitment (provably fair)</li>
                    <li>Announce on Farcaster via @letshaveaword</li>
                  </ul>
                </div>
                <button
                  onClick={handleStartRound}
                  disabled={startRoundLoading}
                  style={{
                    ...styles.btnSuccess,
                    width: '100%',
                    padding: '14px 20px',
                    fontSize: '16px',
                    opacity: startRoundLoading ? 0.7 : 1,
                  }}
                >
                  {startRoundLoading ? '⏳ Starting Round...' : '🎯 Start Round'}
                </button>
              </div>
            )}

            {/* Kill Switch Card */}
            <div style={styles.card}>
              <h2 style={styles.cardTitle}>
                Kill Switch
                {status.killSwitch.enabled && (
                  <span style={{ ...styles.statusBadge('KILL_SWITCH_ACTIVE'), marginLeft: '12px', fontSize: '12px' }}>
                    ACTIVE
                  </span>
                )}
              </h2>

              {status.killSwitch.enabled ? (
                <>
                  <div style={styles.alert('warning')}>
                    Kill switch is currently active. All gameplay is blocked.
                  </div>

                  {/* Refund Monitoring Panel */}
                  {(() => {
                    const cancelledRound = status.cancelledRounds.find(r => r.roundId === status.killSwitch.roundId)
                    const refunds = cancelledRound?.refunds
                    return refunds ? (
                      <div style={{
                        background: '#f0f9ff',
                        border: '1px solid #bae6fd',
                        borderRadius: '8px',
                        padding: '16px',
                        marginBottom: '16px',
                      }}>
                        <div style={{ fontWeight: 600, fontSize: '14px', color: '#0369a1', marginBottom: '12px' }}>
                          📊 Refund Status — Round #{status.killSwitch.roundId}
                        </div>
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(4, 1fr)',
                          gap: '12px',
                          textAlign: 'center',
                        }}>
                          <div style={{ background: 'white', borderRadius: '6px', padding: '12px' }}>
                            <div style={{ fontSize: '24px', fontWeight: 700, color: '#16a34a' }}>
                              {refunds.sent}
                            </div>
                            <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>
                              Sent ✓
                            </div>
                          </div>
                          <div style={{ background: 'white', borderRadius: '6px', padding: '12px' }}>
                            <div style={{ fontSize: '24px', fontWeight: 700, color: '#2563eb' }}>
                              {refunds.pending + refunds.processing}
                            </div>
                            <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>
                              In Progress
                            </div>
                          </div>
                          <div style={{ background: 'white', borderRadius: '6px', padding: '12px' }}>
                            <div style={{ fontSize: '24px', fontWeight: 700, color: refunds.failed > 0 ? '#dc2626' : '#9ca3af' }}>
                              {refunds.failed}
                            </div>
                            <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>
                              Failed
                            </div>
                          </div>
                          <div style={{ background: 'white', borderRadius: '6px', padding: '12px' }}>
                            <div style={{ fontSize: '24px', fontWeight: 700, color: '#111827' }}>
                              {refunds.total}
                            </div>
                            <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>
                              Total
                            </div>
                          </div>
                        </div>
                        <div style={{
                          marginTop: '12px',
                          padding: '8px 12px',
                          background: 'white',
                          borderRadius: '6px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: '13px',
                        }}>
                          <span style={{ color: '#6b7280' }}>Total ETH to Refund</span>
                          <span style={{ fontWeight: 600 }}>{parseFloat(refunds.totalAmountEth).toFixed(6)} ETH</span>
                        </div>
                        {cancelledRound.refundsCompletedAt && (
                          <div style={{ marginTop: '8px', fontSize: '12px', color: '#16a34a', fontWeight: 500 }}>
                            ✓ All refunds completed at {formatDate(cancelledRound.refundsCompletedAt)}
                          </div>
                        )}
                        {status.killSwitch.refundsRunning && (
                          <div style={{ marginTop: '8px', fontSize: '12px', color: '#2563eb' }}>
                            ⏳ Refund processing in progress...
                          </div>
                        )}

                        {/* Cron timing info - only show if refunds are not complete */}
                        {!cancelledRound.refundsCompletedAt && status.refundCron && (
                          <div style={{
                            marginTop: '12px',
                            paddingTop: '12px',
                            borderTop: '1px solid #bae6fd',
                            fontSize: '12px',
                            color: '#64748b',
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                              <span>Last cron run:</span>
                              <span style={{ fontWeight: 500, color: '#475569' }}>
                                {status.refundCron.lastRun
                                  ? formatDate(status.refundCron.lastRun)
                                  : 'Never'}
                              </span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span>Next run (est.):</span>
                              <span style={{ fontWeight: 500, color: '#475569' }}>
                                {getRelativeTime(status.refundCron.nextRunEstimate) || formatDate(status.refundCron.nextRunEstimate)}
                              </span>
                            </div>
                            {status.refundCron.lastResult && (
                              <div style={{ marginTop: '6px', color: '#94a3b8', fontSize: '11px' }}>
                                Last run: {status.refundCron.lastResult.totalSent} sent,{' '}
                                {status.refundCron.lastResult.totalFailed} failed in{' '}
                                {status.refundCron.lastResult.durationMs}ms
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : null
                  })()}

                  <div style={styles.infoRow}>
                    <span style={styles.infoLabel}>Activated At</span>
                    <span style={styles.infoValue}>{formatDate(status.killSwitch.activatedAt)}</span>
                  </div>
                  <div style={styles.infoRow}>
                    <span style={styles.infoLabel}>Reason</span>
                    <span style={styles.infoValue}>{status.killSwitch.reason || '-'}</span>
                  </div>
                  <div style={styles.infoRow}>
                    <span style={styles.infoLabel}>Cancelled Round</span>
                    <span style={styles.infoValue}>
                      {status.killSwitch.roundId ? `#${status.killSwitch.roundId}` : '-'}
                    </span>
                  </div>
                  <button
                    onClick={handleDisableKillSwitch}
                    style={{ ...styles.btnSuccess, marginTop: '16px' }}
                    disabled={actionLoading}
                  >
                    {actionLoading ? 'Processing...' : 'Disable Kill Switch'}
                  </button>
                </>
              ) : (
                <>
                  {!showKillSwitchConfirm ? (
                    // Step 1: Reason input
                    <>
                      <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '16px' }}>
                        Enabling the kill switch will immediately cancel the current round and refund all paid pack purchases.
                      </p>
                      <div style={{ marginBottom: '16px' }}>
                        <label style={styles.label}>Reason (required)</label>
                        <textarea
                          style={styles.textarea}
                          placeholder="Explain why the round is being cancelled..."
                          value={killSwitchReason}
                          onChange={(e) => setKillSwitchReason(e.target.value)}
                        />
                      </div>
                      <button
                        onClick={() => setShowKillSwitchConfirm(true)}
                        style={styles.btnDanger}
                        disabled={!killSwitchReason || killSwitchReason.length < 10}
                      >
                        Continue to Confirmation
                      </button>
                    </>
                  ) : (
                    // Step 2: Confirmation
                    <>
                      <div style={{
                        background: '#fef2f2',
                        border: '1px solid #fecaca',
                        borderRadius: '8px',
                        padding: '16px',
                        marginBottom: '16px',
                      }}>
                        <div style={{ fontWeight: 600, color: '#991b1b', marginBottom: '8px' }}>
                          ⚠️ This action is irreversible
                        </div>
                        <p style={{ fontSize: '13px', color: '#7f1d1d', margin: 0 }}>
                          Enabling the Kill Switch will:
                        </p>
                        <ul style={{ fontSize: '13px', color: '#7f1d1d', margin: '8px 0', paddingLeft: '20px' }}>
                          <li>Immediately cancel Round #{status.activeRoundId}</li>
                          <li>Block all gameplay until disabled</li>
                          <li>Trigger automatic refunds for all paid pack purchases</li>
                        </ul>
                        <p style={{ fontSize: '13px', color: '#7f1d1d', margin: 0 }}>
                          <strong>Reason:</strong> {killSwitchReason}
                        </p>
                      </div>

                      <div style={{ marginBottom: '16px' }}>
                        <label style={styles.label}>
                          Type <code style={{ background: '#fee2e2', padding: '2px 6px', borderRadius: '4px', color: '#991b1b' }}>{KILL_SWITCH_CONFIRM_PHRASE}</code> to confirm
                        </label>
                        <input
                          type="text"
                          style={{
                            ...styles.input,
                            borderColor: killSwitchConfirmText === KILL_SWITCH_CONFIRM_PHRASE ? '#16a34a' : '#d1d5db',
                          }}
                          placeholder={KILL_SWITCH_CONFIRM_PHRASE}
                          value={killSwitchConfirmText}
                          onChange={(e) => setKillSwitchConfirmText(e.target.value.toUpperCase())}
                          autoComplete="off"
                          spellCheck={false}
                        />
                      </div>

                      <div style={{ display: 'flex', gap: '12px' }}>
                        <button
                          onClick={() => {
                            setShowKillSwitchConfirm(false)
                            setKillSwitchConfirmText("")
                          }}
                          style={styles.btnSecondary}
                          disabled={actionLoading}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleEnableKillSwitch}
                          style={{
                            ...styles.btnDanger,
                            opacity: killSwitchConfirmText !== KILL_SWITCH_CONFIRM_PHRASE ? 0.5 : 1,
                            cursor: killSwitchConfirmText !== KILL_SWITCH_CONFIRM_PHRASE ? 'not-allowed' : 'pointer',
                          }}
                          disabled={actionLoading || killSwitchConfirmText !== KILL_SWITCH_CONFIRM_PHRASE}
                        >
                          {actionLoading ? 'Processing...' : 'Enable Kill Switch'}
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>

            {/* Dead Day Card */}
            <div style={styles.card}>
              <h2 style={styles.cardTitle}>
                Dead Day
                {status.deadDay.enabled && (
                  <span style={{ ...styles.statusBadge('PAUSED_BETWEEN_ROUNDS'), marginLeft: '12px', fontSize: '12px' }}>
                    ACTIVE
                  </span>
                )}
              </h2>

              {status.deadDay.enabled ? (
                <>
                  <div style={styles.alert('warning')}>
                    Dead day is active. No new rounds will be created after the current round ends.
                  </div>
                  <div style={styles.infoRow}>
                    <span style={styles.infoLabel}>Activated At</span>
                    <span style={styles.infoValue}>{formatDate(status.deadDay.activatedAt)}</span>
                  </div>
                  <div style={styles.infoRow}>
                    <span style={styles.infoLabel}>Reason</span>
                    <span style={styles.infoValue}>{status.deadDay.reason || '-'}</span>
                  </div>
                  <div style={styles.infoRow}>
                    <span style={styles.infoLabel}>Scheduled Reopen</span>
                    <span style={styles.infoValue}>
                      {status.deadDay.reopenAt ? formatDate(status.deadDay.reopenAt) : 'Manual'}
                    </span>
                  </div>
                  <button
                    onClick={handleDisableDeadDay}
                    style={{ ...styles.btnSuccess, marginTop: '16px' }}
                    disabled={actionLoading}
                  >
                    {actionLoading ? 'Processing...' : 'Disable Dead Day'}
                  </button>
                </>
              ) : (
                <>
                  <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '16px' }}>
                    Enabling dead day will allow the current round to finish, then pause the game until manually resumed or until the scheduled reopen time.
                  </p>
                  <div style={{ marginBottom: '16px' }}>
                    <label style={styles.label}>Reason (required)</label>
                    <textarea
                      style={styles.textarea}
                      placeholder="Explain why the game is being paused..."
                      value={deadDayReason}
                      onChange={(e) => setDeadDayReason(e.target.value)}
                    />
                  </div>
                  <div style={{ marginBottom: '16px' }}>
                    <label style={styles.label}>Auto-reopen at (optional)</label>
                    <input
                      type="datetime-local"
                      style={styles.input}
                      value={deadDayReopenAt}
                      onChange={(e) => setDeadDayReopenAt(e.target.value)}
                    />
                  </div>
                  <button
                    onClick={handleEnableDeadDay}
                    style={styles.btnPrimary}
                    disabled={actionLoading || !deadDayReason}
                  >
                    {actionLoading ? 'Processing...' : 'Enable Dead Day'}
                  </button>
                </>
              )}
            </div>

            {/* Manual XP Award Card */}
            <div style={styles.card}>
              <h2 style={styles.cardTitle}>Manual XP Award</h2>
              <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '16px' }}>
                Award XP events to users manually. Useful for correcting missed XP or compensating users.
              </p>

              <div style={{ marginBottom: '16px' }}>
                <label style={styles.label}>Target FID</label>
                <input
                  type="number"
                  style={styles.input}
                  placeholder="e.g., 310815"
                  value={xpTargetFid}
                  onChange={(e) => setXpTargetFid(e.target.value)}
                />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={styles.label}>XP Event Type</label>
                <select
                  style={{ ...styles.input, cursor: 'pointer' }}
                  value={xpEventType}
                  onChange={(e) => setXpEventType(e.target.value)}
                >
                  <option value="">Select an event type...</option>
                  {xpEventOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={styles.label}>Reason (optional)</label>
                <input
                  type="text"
                  style={styles.input}
                  placeholder="e.g., Missed referral XP"
                  value={xpReason}
                  onChange={(e) => setXpReason(e.target.value)}
                />
              </div>

              <button
                onClick={handleAwardXp}
                style={{
                  ...styles.btnPrimary,
                  opacity: xpLoading || !xpTargetFid || !xpEventType ? 0.6 : 1,
                  cursor: xpLoading || !xpTargetFid || !xpEventType ? 'not-allowed' : 'pointer',
                }}
                disabled={xpLoading || !xpTargetFid || !xpEventType}
              >
                {xpLoading ? 'Awarding...' : 'Award XP'}
              </button>
            </div>

            {/* Cancelled Rounds / Refunds Card */}
            {status.cancelledRounds.length > 0 && (
              <div style={styles.card}>
                <h2 style={styles.cardTitle}>Cancelled Rounds & Refunds</h2>
                {status.cancelledRounds.map((round) => (
                  <div
                    key={round.roundId}
                    style={{
                      padding: '16px',
                      background: '#f9fafb',
                      borderRadius: '8px',
                      marginBottom: '12px',
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: '8px' }}>
                      Round #{round.roundId}
                    </div>
                    <div style={styles.infoRow}>
                      <span style={styles.infoLabel}>Cancelled At</span>
                      <span style={styles.infoValue}>{formatDate(round.cancelledAt)}</span>
                    </div>
                    <div style={styles.infoRow}>
                      <span style={styles.infoLabel}>Reason</span>
                      <span style={styles.infoValue}>{round.cancelledReason || '-'}</span>
                    </div>
                    <div style={styles.infoRow}>
                      <span style={styles.infoLabel}>Refund Status</span>
                      <span style={styles.infoValue}>
                        {round.refundsCompletedAt ? 'Completed' :
                         round.refundsStartedAt ? 'In Progress' : 'Pending'}
                      </span>
                    </div>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(5, 1fr)',
                      gap: '8px',
                      marginTop: '12px',
                      fontSize: '12px',
                      textAlign: 'center',
                    }}>
                      <div>
                        <div style={{ color: '#6b7280' }}>Total</div>
                        <div style={{ fontWeight: 600 }}>{round.refunds.total}</div>
                      </div>
                      <div>
                        <div style={{ color: '#6b7280' }}>Pending</div>
                        <div style={{ fontWeight: 600, color: '#d97706' }}>{round.refunds.pending}</div>
                      </div>
                      <div>
                        <div style={{ color: '#6b7280' }}>Processing</div>
                        <div style={{ fontWeight: 600, color: '#2563eb' }}>{round.refunds.processing}</div>
                      </div>
                      <div>
                        <div style={{ color: '#6b7280' }}>Sent</div>
                        <div style={{ fontWeight: 600, color: '#16a34a' }}>{round.refunds.sent}</div>
                      </div>
                      <div>
                        <div style={{ color: '#6b7280' }}>Failed</div>
                        <div style={{ fontWeight: 600, color: '#dc2626' }}>{round.refunds.failed}</div>
                      </div>
                    </div>
                    <div style={{ marginTop: '8px', fontSize: '13px', color: '#374151' }}>
                      Total Amount: <strong>{parseFloat(round.refunds.totalAmountEth).toFixed(6)} ETH</strong>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : null}
      </main>
    </div>
  )
}

// =============================================================================
// Main Page Component
// =============================================================================

export default function OperationsPage() {
  return (
    <AdminAuthWrapper>
      <DashboardContent />
    </AdminAuthWrapper>
  )
}

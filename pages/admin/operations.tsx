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
  { ssr: false, loading: () => <div style={{ padding: 24, fontFamily: 'Söhne, system-ui, sans-serif' }}>Loading...</div> }
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
    fontFamily: "Söhne, system-ui, -apple-system, sans-serif",
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

  // Kill Switch confirmation states
  const [showKillSwitchConfirm, setShowKillSwitchConfirm] = useState(false)
  const [killSwitchConfirmText, setKillSwitchConfirmText] = useState("")
  const KILL_SWITCH_CONFIRM_PHRASE = "CANCEL ROUND"

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

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleString()
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <h1 style={styles.title}>Operations Dashboard</h1>
        <div style={styles.userInfo}>
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
              <button
                onClick={fetchStatus}
                style={{ ...styles.btnSecondary, marginTop: '12px' }}
                disabled={loading}
              >
                {loading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>

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
                                {formatDate(status.refundCron.nextRunEstimate)}
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

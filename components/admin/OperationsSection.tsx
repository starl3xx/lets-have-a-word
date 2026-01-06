/**
 * Operations Section Component
 * Extracted from pages/admin/operations.tsx for unified admin dashboard
 */

import React, { useState, useEffect, useCallback } from "react"

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

interface ContractNetworkState {
  network: 'mainnet' | 'sepolia'
  contractAddress: string
  rpcUrl: string
  roundNumber: number
  isActive: boolean
  internalJackpot: string
  actualBalance: string
  hasMismatch: boolean
  mismatchAmount: string
  mismatchPercent: number
  canResolve: boolean
  error?: string
}

interface ContractStateResponse {
  ok: boolean
  mainnet: ContractNetworkState
  sepolia: ContractNetworkState
  recommendations: {
    mainnet: string
    sepolia: string
  }
  timestamp: string
}

interface RoundHealthCheck {
  ok: boolean
  roundId: number | null
  checks: {
    legacyGuesses: {
      status: 'ok' | 'warning' | 'error'
      message: string
      details: {
        totalGuesses: number
        indexedGuesses: number
        legacyGuesses: number
        hasIndexedGuesses: boolean
      }
    }
    userRecords: {
      status: 'ok' | 'warning' | 'error'
      message: string
      details: {
        uniqueGuessers: number
        missingUserRecords: number
        missingFids: number[]
      }
    }
    top10Eligibility: {
      status: 'ok' | 'warning' | 'error'
      message: string
      details: {
        eligibleGuesses: number
        top10LockThreshold: number
        isLocked: boolean
      }
    }
  }
  timestamp: string
}

interface OperationsSectionProps {
  user?: {
    fid: number
    username: string
    display_name?: string
    pfp_url?: string
  }
}

// =============================================================================
// Styles
// =============================================================================

const fontFamily = "'Söhne', 'SF Pro Display', system-ui, -apple-system, sans-serif"

const styles = {
  card: {
    background: "white",
    borderRadius: "12px",
    border: "1px solid #e5e7eb",
    padding: "24px",
    marginBottom: "24px",
    fontFamily,
  },
  cardTitle: {
    fontSize: "16px",
    fontWeight: 600,
    color: "#111827",
    margin: "0 0 16px 0",
    fontFamily,
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
  alert: (type: 'error' | 'success' | 'warning' | 'info') => ({
    padding: "12px 16px",
    borderRadius: "8px",
    marginBottom: "16px",
    fontSize: "14px",
    background: type === 'error' ? "#fef2f2" :
                type === 'success' ? "#f0fdf4" :
                type === 'info' ? "#eff6ff" :
                "#fffbeb",
    color: type === 'error' ? "#dc2626" :
           type === 'success' ? "#16a34a" :
           type === 'info' ? "#2563eb" :
           "#d97706",
    border: `1px solid ${type === 'error' ? "#fecaca" :
                         type === 'success' ? "#bbf7d0" :
                         type === 'info' ? "#bfdbfe" :
                         "#fde68a"}`,
  }),
}

// =============================================================================
// Operations Section Component
// =============================================================================

export default function OperationsSection({ user }: OperationsSectionProps) {
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

  // Copy feedback state
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null)

  // XP Award state
  const [xpTargetFid, setXpTargetFid] = useState("")
  const [xpEventType, setXpEventType] = useState("")
  const [xpReason, setXpReason] = useState("")
  const [xpLoading, setXpLoading] = useState(false)

  // Share Bonus state
  const [shareBonusFid, setShareBonusFid] = useState("")
  const [shareBonusReason, setShareBonusReason] = useState("")
  const [shareBonusLoading, setShareBonusLoading] = useState(false)

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

  // Contract state
  const [contractState, setContractState] = useState<ContractStateResponse | null>(null)
  const [contractStateLoading, setContractStateLoading] = useState(false)
  const [clearSepoliaLoading, setClearSepoliaLoading] = useState(false)

  // Simulation states
  const [simAnswer, setSimAnswer] = useState("")
  const [simGuesses, setSimGuesses] = useState("20")
  const [simUsers, setSimUsers] = useState("5")
  const [simLoading, setSimLoading] = useState(false)
  const [forceResolveLoading, setForceResolveLoading] = useState(false)
  const [simResult, setSimResult] = useState<{
    success: boolean;
    message: string;
    roundId?: number;
    answer?: string;
    totalGuesses?: number;
    winnerFid?: number;
    logs: string[];
  } | null>(null)

  // Start round state
  const [startRoundLoading, setStartRoundLoading] = useState(false)

  // Reset for launch state
  const [resetLoading, setResetLoading] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  // Round health check state
  const [roundHealth, setRoundHealth] = useState<RoundHealthCheck | null>(null)
  const [roundHealthLoading, setRoundHealthLoading] = useState(false)
  const [roundHealthError, setRoundHealthError] = useState<string | null>(null)

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
    const interval = setInterval(fetchStatus, 30000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  const fetchContractState = useCallback(async () => {
    if (!user?.fid) return

    try {
      setContractStateLoading(true)
      const res = await fetch(`/api/admin/operational/contract-state?devFid=${user.fid}`)
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch contract state')
      }

      setContractState(data)
    } catch (err: any) {
      console.error('Failed to fetch contract state:', err)
    } finally {
      setContractStateLoading(false)
    }
  }, [user?.fid])

  useEffect(() => {
    fetchContractState()
  }, [fetchContractState])

  const fetchRoundHealth = useCallback(async () => {
    if (!user?.fid) return

    try {
      setRoundHealthLoading(true)
      setRoundHealthError(null)
      const res = await fetch(`/api/admin/operational/round-health?devFid=${user.fid}`)
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch round health')
      }

      setRoundHealth(data)
    } catch (err: any) {
      console.error('Failed to fetch round health:', err)
      setRoundHealthError(err.message || 'Failed to fetch round health')
    } finally {
      setRoundHealthLoading(false)
    }
  }, [user?.fid])

  useEffect(() => {
    fetchRoundHealth()
  }, [fetchRoundHealth])

  const handleClearSepoliaRound = async () => {
    if (!user?.fid) return

    if (!confirm('Clear the Sepolia round? This will pay the jackpot to the operator wallet and reset the contract state.')) {
      return
    }

    try {
      setClearSepoliaLoading(true)
      setError(null)

      const res = await fetch('/api/admin/operational/contract-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          devFid: user.fid,
          action: 'clear-sepolia-round',
          network: 'sepolia',
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to clear Sepolia round')
      }

      setSuccess(data.message)
      await fetchContractState()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setClearSepoliaLoading(false)
    }
  }

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

      // Safe JSON parsing - handle empty or malformed responses
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

      // Safe JSON parsing - handle empty or malformed responses
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

    const statusLabels: Record<string, string> = {
      'NORMAL': 'Normal Operations',
      'KILL_SWITCH_ACTIVE': 'KILL SWITCH ACTIVE',
      'DEAD_DAY_ACTIVE': 'Dead Day (Round Active)',
      'PAUSED_BETWEEN_ROUNDS': 'Paused Between Rounds',
    }
    lines.push(`Status: ${statusLabels[status.status] || status.status}`)

    if (status.activeRoundId) {
      lines.push(`Active Round: #${status.activeRoundId}`)
    } else {
      lines.push('Active Round: None')
    }

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

    if (status.refundCron && status.killSwitch.enabled) {
      lines.push('')
      lines.push('--- Refund Cron ---')
      lines.push(`Last Run: ${status.refundCron.lastRun ? formatDate(status.refundCron.lastRun) : 'Never'}`)
      lines.push(`Next Run: ${getRelativeTime(status.refundCron.nextRunEstimate) || formatDate(status.refundCron.nextRunEstimate)}`)
    }

    lines.push('')
    lines.push(`Generated: ${formatDate(status.timestamp)}`)

    const summary = lines.join('\n')

    try {
      await navigator.clipboard.writeText(summary)
      setCopyFeedback('Copied!')
      setTimeout(() => setCopyFeedback(null), 2000)
    } catch {
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

  const handleRunSimulation = async (dryRun: boolean = false) => {
    if (!user?.fid) return

    try {
      setSimLoading(true)
      setSimResult(null)
      setError(null)

      const res = await fetch('/api/admin/operational/simulate-round', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          devFid: user.fid,
          answer: simAnswer || undefined,
          numGuesses: parseInt(simGuesses, 10) || 20,
          numUsers: parseInt(simUsers, 10) || 5,
          skipOnchain: false,
          dryRun,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.message || data.error || 'Simulation failed')
      }

      setSimResult(data)
      if (data.success && !dryRun) {
        setSuccess(`Simulation complete! Round ${data.roundId} resolved.`)
        await fetchStatus()
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSimLoading(false)
    }
  }

  const handleForceResolve = async () => {
    if (!user?.fid) return

    if (!confirm('Are you sure you want to force-resolve the active round? This will end the round immediately.')) {
      return
    }

    try {
      setForceResolveLoading(true)
      setError(null)

      const res = await fetch('/api/admin/operational/force-resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ devFid: user.fid }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.message || data.error || 'Force resolve failed')
      }

      setSuccess(`Round ${data.roundId} resolved. Answer was: ${data.answer}`)
      await fetchStatus()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setForceResolveLoading(false)
    }
  }

  const handleStartRound = async () => {
    if (!user?.fid) return

    if (!confirm('Start a new round? This will create a new round with a random target word.')) {
      return
    }

    try {
      setStartRoundLoading(true)
      setError(null)

      const res = await fetch(`/api/admin/operational/start-round?devFid=${user.fid}`, {
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
        throw new Error(data.message || data.error || `Failed to start round (${res.status})`)
      }

      if (!data.roundId) {
        throw new Error('Server returned success but no round ID')
      }

      setSuccess(`Round ${data.roundId} started! Prize pool: ${data.prizePoolEth} ETH`)
      await fetchStatus()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setStartRoundLoading(false)
    }
  }

  const handleResetForLaunch = async () => {
    if (!user?.fid) return

    try {
      setResetLoading(true)
      setError(null)

      const res = await fetch(`/api/admin/reset-for-launch?devFid=${user.fid}`, {
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

  const handleGrantShareBonus = async () => {
    if (!user?.fid) return

    const targetFid = parseInt(shareBonusFid, 10)
    if (isNaN(targetFid) || targetFid <= 0) {
      setError('Please enter a valid FID')
      return
    }

    try {
      setShareBonusLoading(true)
      setError(null)
      setSuccess(null)

      const res = await fetch('/api/admin/grant-share-bonus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          devFid: user.fid,
          targetFid,
          reason: shareBonusReason || undefined,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to grant share bonus')
      }

      setSuccess(data.message)
      // Clear form on success
      setShareBonusFid('')
      setShareBonusReason('')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setShareBonusLoading(false)
    }
  }

  return (
    <div>
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

          {/* Round Health Check Card */}
          {status.activeRoundId && (
            <div style={styles.card}>
              <h2 style={styles.cardTitle}>
                Round Health Check
                {roundHealth && (
                  <span style={{
                    marginLeft: '12px',
                    fontSize: '12px',
                    padding: '2px 8px',
                    borderRadius: '9999px',
                    background: roundHealth.ok ? '#dcfce7' : '#fef3c7',
                    color: roundHealth.ok ? '#166534' : '#92400e',
                  }}>
                    {roundHealth.ok ? 'HEALTHY' : 'ISSUES DETECTED'}
                  </span>
                )}
              </h2>

              <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '16px' }}>
                Pre-resolution checks to identify potential issues before the round ends.
              </p>

              {roundHealthError && (
                <div style={styles.alert('error')}>
                  {roundHealthError}
                </div>
              )}

              {roundHealthLoading && !roundHealth ? (
                <div style={{ textAlign: 'center', padding: '24px', color: '#6b7280' }}>
                  Running health checks...
                </div>
              ) : roundHealth ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {/* Legacy Guesses Check */}
                  <div style={{
                    padding: '12px 16px',
                    borderRadius: '8px',
                    background: roundHealth.checks.legacyGuesses.status === 'ok' ? '#f0fdf4' :
                                roundHealth.checks.legacyGuesses.status === 'warning' ? '#fffbeb' : '#fef2f2',
                    border: `1px solid ${roundHealth.checks.legacyGuesses.status === 'ok' ? '#bbf7d0' :
                                          roundHealth.checks.legacyGuesses.status === 'warning' ? '#fde68a' : '#fecaca'}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <span style={{ fontSize: '16px' }}>
                        {roundHealth.checks.legacyGuesses.status === 'ok' ? '✅' :
                         roundHealth.checks.legacyGuesses.status === 'warning' ? '⚠️' : '❌'}
                      </span>
                      <span style={{ fontWeight: 600, fontSize: '14px' }}>Guess Indexing</span>
                    </div>
                    <div style={{ fontSize: '13px', color: '#374151', marginBottom: '8px' }}>
                      {roundHealth.checks.legacyGuesses.message}
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>
                      Total: {roundHealth.checks.legacyGuesses.details.totalGuesses} |
                      Indexed: {roundHealth.checks.legacyGuesses.details.indexedGuesses} |
                      Legacy: {roundHealth.checks.legacyGuesses.details.legacyGuesses}
                    </div>
                  </div>

                  {/* User Records Check */}
                  <div style={{
                    padding: '12px 16px',
                    borderRadius: '8px',
                    background: roundHealth.checks.userRecords.status === 'ok' ? '#f0fdf4' :
                                roundHealth.checks.userRecords.status === 'warning' ? '#fffbeb' : '#fef2f2',
                    border: `1px solid ${roundHealth.checks.userRecords.status === 'ok' ? '#bbf7d0' :
                                          roundHealth.checks.userRecords.status === 'warning' ? '#fde68a' : '#fecaca'}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <span style={{ fontSize: '16px' }}>
                        {roundHealth.checks.userRecords.status === 'ok' ? '✅' :
                         roundHealth.checks.userRecords.status === 'warning' ? '⚠️' : '❌'}
                      </span>
                      <span style={{ fontWeight: 600, fontSize: '14px' }}>User Records</span>
                    </div>
                    <div style={{ fontSize: '13px', color: '#374151', marginBottom: '8px' }}>
                      {roundHealth.checks.userRecords.message}
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>
                      Unique guessers: {roundHealth.checks.userRecords.details.uniqueGuessers} |
                      Missing: {roundHealth.checks.userRecords.details.missingUserRecords}
                      {roundHealth.checks.userRecords.details.missingFids.length > 0 && (
                        <span style={{ color: '#dc2626' }}>
                          {' '}(FIDs: {roundHealth.checks.userRecords.details.missingFids.join(', ')})
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Top-10 Eligibility Check */}
                  <div style={{
                    padding: '12px 16px',
                    borderRadius: '8px',
                    background: roundHealth.checks.top10Eligibility.status === 'ok' ? '#f0fdf4' :
                                roundHealth.checks.top10Eligibility.status === 'warning' ? '#fffbeb' : '#fef2f2',
                    border: `1px solid ${roundHealth.checks.top10Eligibility.status === 'ok' ? '#bbf7d0' :
                                          roundHealth.checks.top10Eligibility.status === 'warning' ? '#fde68a' : '#fecaca'}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <span style={{ fontSize: '16px' }}>
                        {roundHealth.checks.top10Eligibility.status === 'ok' ? '✅' :
                         roundHealth.checks.top10Eligibility.status === 'warning' ? '⚠️' : '❌'}
                      </span>
                      <span style={{ fontWeight: 600, fontSize: '14px' }}>Top-10 Eligibility</span>
                    </div>
                    <div style={{ fontSize: '13px', color: '#374151', marginBottom: '8px' }}>
                      {roundHealth.checks.top10Eligibility.message}
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>
                      Eligible guesses: {roundHealth.checks.top10Eligibility.details.eligibleGuesses} |
                      Lock threshold: {roundHealth.checks.top10Eligibility.details.top10LockThreshold} |
                      {roundHealth.checks.top10Eligibility.details.isLocked ? ' 🔒 Locked' : ' 🔓 Open'}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
                    <button
                      onClick={fetchRoundHealth}
                      style={styles.btnSecondary}
                      disabled={roundHealthLoading}
                    >
                      {roundHealthLoading ? 'Checking...' : 'Re-run Checks'}
                    </button>
                    <span style={{ fontSize: '12px', color: '#9ca3af', alignSelf: 'center' }}>
                      Last checked: {roundHealth.timestamp ? formatDate(roundHealth.timestamp) : 'Never'}
                    </span>
                  </div>
                </div>
              ) : (
                <button
                  onClick={fetchRoundHealth}
                  style={styles.btnPrimary}
                  disabled={roundHealthLoading}
                >
                  Run Health Check
                </button>
              )}
            </div>
          )}

          {/* Start New Round Card */}
          {!status.killSwitch.enabled && (
            <div style={styles.card}>
              <h2 style={styles.cardTitle}>Start New Round</h2>
              {status.activeRoundId ? (
                <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '16px' }}>
                  Round #{status.activeRoundId} is active in the database. If the onchain round hasn't started yet,
                  you may need to resolve or clear the existing round first.
                </p>
              ) : (
                <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '16px' }}>
                  No active round. Start a new round to begin gameplay. A random target word will be selected.
                </p>
              )}
              <button
                onClick={handleStartRound}
                style={styles.btnSuccess}
                disabled={startRoundLoading}
              >
                {startRoundLoading ? 'Starting...' : 'Start New Round'}
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
                        Refund Status — Round #{status.killSwitch.roundId}
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
                            Sent
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
                          All refunds completed at {formatDate(cancelledRound.refundsCompletedAt)}
                        </div>
                      )}
                      {status.killSwitch.refundsRunning && (
                        <div style={{ marginTop: '8px', fontSize: '12px', color: '#2563eb' }}>
                          Refund processing in progress...
                        </div>
                      )}

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
                  <>
                    <div style={{
                      background: '#fef2f2',
                      border: '1px solid #fecaca',
                      borderRadius: '8px',
                      padding: '16px',
                      marginBottom: '16px',
                    }}>
                      <div style={{ fontWeight: 600, color: '#991b1b', marginBottom: '8px' }}>
                        This action is irreversible
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

          {/* Contract State Diagnostics Card */}
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>
              Contract State Diagnostics
              <span style={{
                marginLeft: '12px',
                fontSize: '11px',
                padding: '2px 8px',
                background: '#fef3c7',
                color: '#92400e',
                borderRadius: '9999px',
              }}>
                ONCHAIN
              </span>
            </h2>

            <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '16px' }}>
              Monitor contract balance vs internal jackpot to diagnose resolution issues.
              A mismatch means the contract cannot pay out the expected amounts.
            </p>

            {contractStateLoading && !contractState ? (
              <div style={{ textAlign: 'center', padding: '24px', color: '#6b7280' }}>
                Loading contract state...
              </div>
            ) : contractState ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                {/* Mainnet State */}
                <div style={{
                  padding: '16px',
                  background: contractState.mainnet.hasMismatch ? '#fef2f2' : '#f0fdf4',
                  border: `1px solid ${contractState.mainnet.hasMismatch ? '#fecaca' : '#bbf7d0'}`,
                  borderRadius: '8px',
                }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '12px',
                  }}>
                    <span style={{ fontWeight: 600, fontSize: '14px' }}>
                      Base Mainnet
                    </span>
                    <span style={{
                      fontSize: '20px',
                    }}>
                      {contractState.mainnet.hasMismatch ? '⚠️' : '✅'}
                    </span>
                  </div>
                  {contractState.mainnet.error ? (
                    <div style={{ color: '#dc2626', fontSize: '13px' }}>
                      Error: {contractState.mainnet.error}
                    </div>
                  ) : (
                    <>
                      <div style={styles.infoRow}>
                        <span style={styles.infoLabel}>Contract</span>
                        <span style={{ ...styles.infoValue, fontSize: '10px', fontFamily: 'monospace' }}>
                          {contractState.mainnet.contractAddress?.slice(0, 10)}...{contractState.mainnet.contractAddress?.slice(-8)}
                        </span>
                      </div>
                      <div style={styles.infoRow}>
                        <span style={styles.infoLabel}>RPC</span>
                        <span style={{ ...styles.infoValue, fontSize: '10px' }}>
                          {contractState.mainnet.rpcUrl?.includes('sepolia') ? '⚠️ SEPOLIA!' : contractState.mainnet.rpcUrl?.replace('https://', '')}
                        </span>
                      </div>
                      <div style={styles.infoRow}>
                        <span style={styles.infoLabel}>Round</span>
                        <span style={styles.infoValue}>
                          #{contractState.mainnet.roundNumber} {contractState.mainnet.isActive ? '(active)' : '(inactive)'}
                        </span>
                      </div>
                      <div style={styles.infoRow}>
                        <span style={styles.infoLabel}>Internal Jackpot</span>
                        <span style={styles.infoValue}>{parseFloat(contractState.mainnet.internalJackpot).toFixed(6)} ETH</span>
                      </div>
                      <div style={styles.infoRow}>
                        <span style={styles.infoLabel}>Actual Balance</span>
                        <span style={styles.infoValue}>{parseFloat(contractState.mainnet.actualBalance).toFixed(6)} ETH</span>
                      </div>
                      {contractState.mainnet.hasMismatch && (
                        <div style={{
                          marginTop: '12px',
                          padding: '8px',
                          background: '#fee2e2',
                          borderRadius: '6px',
                          fontSize: '12px',
                          color: '#991b1b',
                        }}>
                          ⚠️ Balance is {contractState.mainnet.mismatchAmount} ETH ({contractState.mainnet.mismatchPercent.toFixed(1)}%) less than jackpot.
                          Resolution will fail.
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Sepolia State */}
                <div style={{
                  padding: '16px',
                  background: contractState.sepolia.hasMismatch ? '#fef2f2' : '#f0fdf4',
                  border: `1px solid ${contractState.sepolia.hasMismatch ? '#fecaca' : '#bbf7d0'}`,
                  borderRadius: '8px',
                }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '12px',
                  }}>
                    <span style={{ fontWeight: 600, fontSize: '14px' }}>
                      Base Sepolia (Testnet)
                    </span>
                    <span style={{
                      fontSize: '20px',
                    }}>
                      {contractState.sepolia.hasMismatch ? '⚠️' : '✅'}
                    </span>
                  </div>
                  {contractState.sepolia.error ? (
                    <div style={{ color: '#dc2626', fontSize: '13px' }}>
                      Error: {contractState.sepolia.error}
                    </div>
                  ) : (
                    <>
                      <div style={styles.infoRow}>
                        <span style={styles.infoLabel}>Contract</span>
                        <span style={{ ...styles.infoValue, fontSize: '10px', fontFamily: 'monospace' }}>
                          {contractState.sepolia.contractAddress?.slice(0, 10)}...{contractState.sepolia.contractAddress?.slice(-8)}
                        </span>
                      </div>
                      <div style={styles.infoRow}>
                        <span style={styles.infoLabel}>RPC</span>
                        <span style={{ ...styles.infoValue, fontSize: '10px' }}>
                          {contractState.sepolia.rpcUrl?.replace('https://', '')}
                        </span>
                      </div>
                      <div style={styles.infoRow}>
                        <span style={styles.infoLabel}>Round</span>
                        <span style={styles.infoValue}>
                          #{contractState.sepolia.roundNumber} {contractState.sepolia.isActive ? '(active)' : '(inactive)'}
                        </span>
                      </div>
                      <div style={styles.infoRow}>
                        <span style={styles.infoLabel}>Internal Jackpot</span>
                        <span style={styles.infoValue}>{parseFloat(contractState.sepolia.internalJackpot).toFixed(6)} ETH</span>
                      </div>
                      <div style={styles.infoRow}>
                        <span style={styles.infoLabel}>Actual Balance</span>
                        <span style={styles.infoValue}>{parseFloat(contractState.sepolia.actualBalance).toFixed(6)} ETH</span>
                      </div>
                      {contractState.sepolia.hasMismatch && (
                        <div style={{
                          marginTop: '12px',
                          padding: '8px',
                          background: '#fee2e2',
                          borderRadius: '6px',
                          fontSize: '12px',
                          color: '#991b1b',
                        }}>
                          ⚠️ Balance is {contractState.sepolia.mismatchAmount} ETH ({contractState.sepolia.mismatchPercent.toFixed(1)}%) less than jackpot.
                        </div>
                      )}
                      {contractState.sepolia.isActive && (
                        <button
                          onClick={handleClearSepoliaRound}
                          style={{
                            ...styles.btnDanger,
                            marginTop: '12px',
                            width: '100%',
                            padding: '8px 12px',
                            fontSize: '12px',
                          }}
                          disabled={clearSepoliaLoading}
                        >
                          {clearSepoliaLoading ? 'Clearing...' : 'Clear Sepolia Round'}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            ) : null}

            {/* Warning if same contract address used for both networks */}
            {contractState?.mainnet.contractAddress &&
             contractState?.sepolia.contractAddress &&
             contractState.mainnet.contractAddress === contractState.sepolia.contractAddress && (
              <div style={{
                marginTop: '16px',
                padding: '12px',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '8px',
                fontSize: '13px',
                color: '#991b1b',
              }}>
                <strong>⚠️ Configuration Warning:</strong> Both networks are using the same contract address!
                <br />
                Set <code style={{ background: '#fee2e2', padding: '2px 4px', borderRadius: '4px' }}>SEPOLIA_JACKPOT_MANAGER_ADDRESS</code> in
                your environment to point to a separate Sepolia contract.
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
              <button
                onClick={fetchContractState}
                style={styles.btnSecondary}
                disabled={contractStateLoading}
              >
                {contractStateLoading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>

            {contractState?.recommendations && (
              <div style={{ marginTop: '16px', fontSize: '12px', color: '#6b7280' }}>
                <div style={{ marginBottom: '4px' }}>
                  <strong>Mainnet:</strong> {contractState.recommendations.mainnet}
                </div>
                <div>
                  <strong>Sepolia:</strong> {contractState.recommendations.sepolia}
                </div>
              </div>
            )}
          </div>

          {/* Sepolia Simulation Card */}
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>
              Sepolia Test Simulation
              <span style={{
                marginLeft: '12px',
                fontSize: '11px',
                padding: '2px 8px',
                background: '#dbeafe',
                color: '#1e40af',
                borderRadius: '9999px',
              }}>
                TESTNET
              </span>
            </h2>

            <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '16px' }}>
              Simulate a complete game round with fake users for testing on Sepolia.
              This creates a round, submits guesses from simulated users, and resolves with a winner.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
              <div>
                <label style={styles.label}>Answer (optional)</label>
                <input
                  type="text"
                  style={styles.input}
                  placeholder="CRANE (random if empty)"
                  value={simAnswer}
                  onChange={(e) => setSimAnswer(e.target.value.toUpperCase().slice(0, 5))}
                  maxLength={5}
                />
                <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>
                  Leave empty for random word
                </div>
              </div>
              <div>
                <label style={styles.label}>Wrong Guesses</label>
                <input
                  type="number"
                  style={styles.input}
                  value={simGuesses}
                  onChange={(e) => setSimGuesses(e.target.value)}
                  min={1}
                  max={100}
                />
                <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>
                  Number of wrong guesses before winning (1-100)
                </div>
              </div>
              <div>
                <label style={styles.label}>Simulated Users</label>
                <input
                  type="number"
                  style={styles.input}
                  value={simUsers}
                  onChange={(e) => setSimUsers(e.target.value)}
                  min={1}
                  max={10}
                />
                <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>
                  Number of fake users (1-10)
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
              <button
                onClick={() => handleRunSimulation(true)}
                style={styles.btnSecondary}
                disabled={simLoading}
              >
                {simLoading ? 'Running...' : 'Dry Run'}
              </button>
              <button
                onClick={() => handleRunSimulation(false)}
                style={{
                  ...styles.btnPrimary,
                  background: '#7c3aed',
                }}
                disabled={simLoading}
              >
                {simLoading ? 'Running...' : 'Run Simulation'}
              </button>
            </div>

            {status?.activeRoundId && (
              <div style={{
                ...styles.alert('info'),
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <span>
                  Production has an active round (#{status.activeRoundId}).
                  Sepolia simulation runs independently.
                </span>
                <button
                  onClick={handleForceResolve}
                  style={{
                    ...styles.btnDanger,
                    padding: '6px 12px',
                    fontSize: '12px',
                    marginLeft: '12px',
                    flexShrink: 0,
                  }}
                  disabled={forceResolveLoading}
                >
                  {forceResolveLoading ? 'Resolving...' : 'Force Resolve'}
                </button>
              </div>
            )}

            {simResult && (
              <div style={{
                background: simResult.success ? '#f0fdf4' : '#fef2f2',
                border: `1px solid ${simResult.success ? '#bbf7d0' : '#fecaca'}`,
                borderRadius: '8px',
                padding: '16px',
              }}>
                <div style={{
                  fontWeight: 600,
                  color: simResult.success ? '#166534' : '#dc2626',
                  marginBottom: '12px',
                }}>
                  {simResult.success ? 'Simulation Complete' : 'Simulation Failed'}
                </div>

                {simResult.roundId && (
                  <div style={{ marginBottom: '12px' }}>
                    <div style={styles.infoRow}>
                      <span style={styles.infoLabel}>Round ID</span>
                      <span style={styles.infoValue}>#{simResult.roundId}</span>
                    </div>
                    <div style={styles.infoRow}>
                      <span style={styles.infoLabel}>Answer</span>
                      <span style={{ ...styles.infoValue, fontFamily: 'monospace' }}>{simResult.answer}</span>
                    </div>
                    <div style={styles.infoRow}>
                      <span style={styles.infoLabel}>Total Guesses</span>
                      <span style={styles.infoValue}>{simResult.totalGuesses}</span>
                    </div>
                    <div style={styles.infoRow}>
                      <span style={styles.infoLabel}>Winner FID</span>
                      <span style={styles.infoValue}>{simResult.winnerFid}</span>
                    </div>
                  </div>
                )}

                <div style={{ fontSize: '13px', color: '#374151' }}>
                  {simResult.message}
                </div>

                {simResult.logs.length > 0 && (
                  <details style={{ marginTop: '12px' }}>
                    <summary style={{ cursor: 'pointer', fontSize: '13px', color: '#6b7280' }}>
                      View Logs ({simResult.logs.length} entries)
                    </summary>
                    <pre style={{
                      marginTop: '8px',
                      padding: '12px',
                      background: '#1f2937',
                      color: '#e5e7eb',
                      borderRadius: '6px',
                      fontSize: '11px',
                      overflow: 'auto',
                      maxHeight: '200px',
                    }}>
                      {simResult.logs.join('\n')}
                    </pre>
                  </details>
                )}
              </div>
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

          {/* Manual Share Bonus Card */}
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Grant Share Bonus</h2>
            <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '16px' }}>
              Manually grant +1 share bonus guess to a user for today. Useful when a user shared but missed the share modal.
            </p>

            <div style={{ marginBottom: '16px' }}>
              <label style={styles.label}>Target FID</label>
              <input
                type="number"
                style={styles.input}
                placeholder="e.g., 310815"
                value={shareBonusFid}
                onChange={(e) => setShareBonusFid(e.target.value)}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={styles.label}>Reason (optional)</label>
              <input
                type="text"
                style={styles.input}
                placeholder="e.g., Missed share modal"
                value={shareBonusReason}
                onChange={(e) => setShareBonusReason(e.target.value)}
              />
            </div>

            <button
              onClick={handleGrantShareBonus}
              style={{
                ...styles.btnPrimary,
                background: '#8b5cf6',
                opacity: shareBonusLoading || !shareBonusFid ? 0.6 : 1,
                cursor: shareBonusLoading || !shareBonusFid ? 'not-allowed' : 'pointer',
              }}
              disabled={shareBonusLoading || !shareBonusFid}
            >
              {shareBonusLoading ? 'Granting...' : 'Grant Share Bonus (+1 guess)'}
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}

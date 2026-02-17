/**
 * Airdrop Manager Section
 * CLANKTON to $WORD migration: CSV import, balance checking, export for Disperse.app
 */

import React, { useState, useEffect, useCallback } from "react"

// =============================================================================
// Types
// =============================================================================

interface AirdropWallet {
  id: number
  walletAddress: string
  snapshotToken: string
  snapshotBalance: string
  snapshotDate: string | null
  currentWordBalance: string | null
  airdropNeeded: string | null
  balanceLastCheckedAt: string | null
  balanceCheckError: string | null
  createdAt: string
  updatedAt: string
  distributions: AirdropDistribution[]
}

interface AirdropDistribution {
  id: number
  airdropWalletId: number
  amountSent: string
  markedByFid: number
  txHash: string | null
  note: string | null
  sentAt: string
}

interface Summary {
  totalWallets: number
  totalWordNeeded: number
  aboveFloor: number
  needingAirdrop: number
  alreadySent: number
}

type SortKey = 'walletAddress' | 'snapshotBalance' | 'currentWordBalance' | 'airdropNeeded' | 'balanceLastCheckedAt' | 'status'
type SortDir = 'asc' | 'desc'

interface Props {
  user?: {
    fid: number
    username: string
  }
}

// =============================================================================
// Styles
// =============================================================================

const styles = {
  card: {
    background: "white",
    borderRadius: "12px",
    border: "1px solid #e5e7eb",
    padding: "24px",
    marginBottom: "24px",
  } as React.CSSProperties,
  cardTitle: {
    fontSize: "16px",
    fontWeight: 600,
    color: "#111827",
    margin: "0 0 16px 0",
  } as React.CSSProperties,
  statGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: "16px",
    marginBottom: "24px",
  } as React.CSSProperties,
  statCard: {
    background: "#f9fafb",
    borderRadius: "8px",
    padding: "16px",
    textAlign: "center" as const,
  } as React.CSSProperties,
  statLabel: {
    fontSize: "12px",
    fontWeight: 500,
    color: "#6b7280",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    marginBottom: "4px",
  } as React.CSSProperties,
  statValue: {
    fontSize: "22px",
    fontWeight: 700,
    color: "#111827",
  } as React.CSSProperties,
  btnPrimary: {
    padding: "10px 20px",
    background: "#2563eb",
    color: "white",
    border: "none",
    borderRadius: "8px",
    fontSize: "14px",
    fontWeight: 500,
    cursor: "pointer",
  } as React.CSSProperties,
  btnSecondary: {
    padding: "10px 20px",
    background: "#f3f4f6",
    color: "#374151",
    border: "1px solid #d1d5db",
    borderRadius: "8px",
    fontSize: "14px",
    fontWeight: 500,
    cursor: "pointer",
  } as React.CSSProperties,
  btnDanger: {
    padding: "6px 14px",
    background: "#fef2f2",
    color: "#dc2626",
    border: "1px solid #fecaca",
    borderRadius: "6px",
    fontSize: "13px",
    fontWeight: 500,
    cursor: "pointer",
  } as React.CSSProperties,
  btnSmall: {
    padding: "4px 10px",
    fontSize: "12px",
    borderRadius: "6px",
    cursor: "pointer",
    border: "1px solid #d1d5db",
    background: "#f3f4f6",
    color: "#374151",
  } as React.CSSProperties,
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
  } as React.CSSProperties),
  input: {
    padding: "8px 12px",
    border: "1px solid #d1d5db",
    borderRadius: "8px",
    fontSize: "14px",
    outline: "none",
  } as React.CSSProperties,
  textarea: {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid #d1d5db",
    borderRadius: "8px",
    fontSize: "13px",
    fontFamily: "monospace",
    outline: "none",
    resize: "vertical" as const,
    minHeight: "120px",
  } as React.CSSProperties,
  th: {
    padding: "10px 12px",
    textAlign: "left" as const,
    fontSize: "12px",
    fontWeight: 600,
    color: "#6b7280",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    borderBottom: "2px solid #e5e7eb",
    cursor: "pointer",
    userSelect: "none" as const,
    whiteSpace: "nowrap" as const,
  } as React.CSSProperties,
  td: {
    padding: "10px 12px",
    fontSize: "13px",
    borderBottom: "1px solid #f3f4f6",
    color: "#374151",
  } as React.CSSProperties,
}

// =============================================================================
// Helpers
// =============================================================================

function formatNumber(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function formatCompact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return formatNumber(n)
}

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return '-'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function getWalletStatus(w: AirdropWallet): 'sent' | 'error' | 'pending' {
  if (w.distributions.length > 0) return 'sent'
  if (w.balanceCheckError) return 'error'
  return 'pending'
}

// Disperse.app — batch ERC-20 transfers in a single tx
const DISPERSE_ADDRESS = '0xD152f549545093347A162Dce210e7293f1452150'
const WORD_TOKEN_ADDRESS = '0x304e649e69979298bd1aee63e175adf07885fb4b'
const BASE_CHAIN_ID = 8453n

function isEligibleForAirdrop(w: AirdropWallet): boolean {
  return parseFloat(w.airdropNeeded || '0') > 0 && w.distributions.length === 0
}

// =============================================================================
// Component
// =============================================================================

export default function AirdropManagerSection({ user }: Props) {
  const [wallets, setWallets] = useState<AirdropWallet[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // CSV upload
  const [showUpload, setShowUpload] = useState(false)
  const [csvText, setCsvText] = useState("")
  const [importing, setImporting] = useState(false)

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>('airdropNeeded')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // Filter
  const [showOnlyNeeding, setShowOnlyNeeding] = useState(false)

  // Mark sent inline
  const [markSentWalletId, setMarkSentWalletId] = useState<number | null>(null)
  const [markSentTxHash, setMarkSentTxHash] = useState("")
  const [markSentNote, setMarkSentNote] = useState("")

  // Mark all sent
  const [showMarkAll, setShowMarkAll] = useState(false)
  const [markAllTxHash, setMarkAllTxHash] = useState("")
  const [markAllNote, setMarkAllNote] = useState("")

  // Copy feedback
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null)

  // Migration setup
  const [needsMigration, setNeedsMigration] = useState(false)
  const [migrationRunning, setMigrationRunning] = useState<string | null>(null)
  const [schemaApplied, setSchemaApplied] = useState(false)

  // Selection + on-chain airdrop
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [airdropStep, setAirdropStep] = useState<'idle' | 'confirming' | 'approving' | 'sending' | 'done' | 'error'>('idle')
  const [airdropTxHash, setAirdropTxHash] = useState<string | null>(null)
  const [airdropError, setAirdropError] = useState<string | null>(null)

  const devFid = user?.fid

  // ============================================================================
  // Data fetching
  // ============================================================================

  const fetchData = useCallback(async () => {
    if (!devFid) return
    try {
      setLoading(true)
      const [listRes, summaryRes] = await Promise.all([
        fetch(`/api/admin/airdrop/manage?action=list&devFid=${devFid}`),
        fetch(`/api/admin/airdrop/manage?action=summary&devFid=${devFid}`),
      ])

      const listData = await listRes.json()
      const summaryData = await summaryRes.json()

      if (!listRes.ok) throw new Error(listData.error)
      if (!summaryRes.ok) throw new Error(summaryData.error)

      setWallets(listData.wallets)
      setSummary(summaryData.summary)
      setError(null)
    } catch (err: any) {
      if (err.message?.includes('does not exist')) {
        setNeedsMigration(true)
      }
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [devFid])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // ============================================================================
  // Actions
  // ============================================================================

  const handleRunMigration = async (migrationName: string) => {
    if (!devFid) return
    try {
      setMigrationRunning(migrationName)
      setError(null)
      const res = await fetch(`/api/admin/operational/apply-migration?devFid=${devFid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ migration: migrationName }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || data.details || 'Migration failed')

      if (migrationName === '0006_airdrop_manager') {
        setSchemaApplied(true)
        setSuccess('Schema migration applied — tables created')
      } else if (migrationName === '0007_seed_airdrop_holders') {
        setSuccess('Seed data applied — 38 wallets imported')
        setNeedsMigration(false)
        setSchemaApplied(false)
        await fetchData()
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setMigrationRunning(null)
    }
  }

  const handleImportCsv = async () => {
    if (!csvText.trim() || !devFid) return
    try {
      setImporting(true)
      setError(null)
      const res = await fetch('/api/admin/airdrop/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import-csv', csvData: csvText, devFid }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      setSuccess(`Imported ${data.imported} wallets${data.skipped ? `, ${data.skipped} skipped` : ''}`)
      setCsvText("")
      setShowUpload(false)
      await fetchData()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setImporting(false)
    }
  }

  const handleRefreshAll = async () => {
    if (!devFid) return
    try {
      setRefreshing(true)
      setError(null)
      const res = await fetch('/api/admin/airdrop/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh-balances', devFid }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      setSuccess(`Refreshed ${data.updated} wallets${data.failed ? `, ${data.failed} failed` : ''}`)
      await fetchData()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setRefreshing(false)
    }
  }

  const handleRefreshSingle = async (walletId: number) => {
    if (!devFid) return
    try {
      setError(null)
      const res = await fetch('/api/admin/airdrop/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh-single', walletId, devFid }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      await fetchData()
    } catch (err: any) {
      setError(err.message)
    }
  }

  const handleMarkSent = async (walletId: number) => {
    if (!devFid) return
    try {
      setError(null)
      const res = await fetch('/api/admin/airdrop/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'mark-sent',
          walletId,
          txHash: markSentTxHash || undefined,
          note: markSentNote || undefined,
          devFid,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      setMarkSentWalletId(null)
      setMarkSentTxHash("")
      setMarkSentNote("")
      setSuccess(`Marked wallet as sent`)
      await fetchData()
    } catch (err: any) {
      setError(err.message)
    }
  }

  const handleMarkAllSent = async () => {
    if (!devFid) return
    try {
      setError(null)
      const res = await fetch('/api/admin/airdrop/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'mark-all-sent',
          txHash: markAllTxHash || undefined,
          note: markAllNote || undefined,
          devFid,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      setShowMarkAll(false)
      setMarkAllTxHash("")
      setMarkAllNote("")
      setSuccess(`Marked ${data.marked} wallets as sent`)
      await fetchData()
    } catch (err: any) {
      setError(err.message)
    }
  }

  const handleUnmarkSent = async (distributionId: number) => {
    if (!devFid) return
    try {
      setError(null)
      const res = await fetch('/api/admin/airdrop/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unmark-sent', distributionId, devFid }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      setSuccess('Distribution record removed')
      await fetchData()
    } catch (err: any) {
      setError(err.message)
    }
  }

  const handleDeleteWallet = async (walletId: number) => {
    if (!devFid) return
    if (!confirm('Remove this wallet from tracking?')) return
    try {
      setError(null)
      const res = await fetch('/api/admin/airdrop/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete-wallet', walletId, devFid }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      setSuccess('Wallet removed')
      await fetchData()
    } catch (err: any) {
      setError(err.message)
    }
  }

  const handleExportCsv = () => {
    const rows = wallets.filter(w => {
      const needed = parseFloat(w.airdropNeeded || '0')
      return needed > 0 && w.distributions.length === 0
    })

    const csv = rows
      .map(w => `${w.walletAddress},${Math.round(parseFloat(w.airdropNeeded || '0'))}`)
      .join('\n')

    const blob = new Blob([`wallet_address,airdrop_amount\n${csv}`], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const date = new Date().toISOString().split('T')[0]
    a.download = `word-airdrop-${date}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      setCsvText(ev.target?.result as string || '')
    }
    reader.readAsText(file)
  }

  const copyAddress = async (addr: string) => {
    try {
      await navigator.clipboard.writeText(addr)
      setCopiedAddr(addr)
      setTimeout(() => setCopiedAddr(null), 1500)
    } catch {
      // fallback
      const ta = document.createElement('textarea')
      ta.value = addr
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopiedAddr(addr)
      setTimeout(() => setCopiedAddr(null), 1500)
    }
  }

  // ============================================================================
  // Selection + on-chain airdrop
  // ============================================================================

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const eligibleWallets = wallets.filter(isEligibleForAirdrop)

  const toggleSelectAll = () => {
    if (selectedIds.size >= eligibleWallets.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(eligibleWallets.map(w => w.id)))
    }
  }

  const selectedWallets = wallets.filter(w => selectedIds.has(w.id) && isEligibleForAirdrop(w))
  const selectedTotal = selectedWallets.reduce((sum, w) => sum + Math.round(parseFloat(w.airdropNeeded || '0')), 0)

  const handleExecuteAirdrop = async () => {
    if (selectedWallets.length === 0 || !devFid) return
    const ethereum = (window as any).ethereum
    if (!ethereum) {
      setError('No wallet detected. Connect MetaMask or a browser wallet.')
      return
    }

    try {
      const { ethers } = await import('ethers')
      setAirdropStep('confirming')
      setAirdropTxHash(null)
      setAirdropError(null)

      // Connect
      await ethereum.request({ method: 'eth_requestAccounts' })
      const provider = new ethers.BrowserProvider(ethereum)
      const signer = await provider.getSigner()
      const signerAddress = await signer.getAddress()

      // Chain check
      const network = await provider.getNetwork()
      if (network.chainId !== BASE_CHAIN_ID) {
        try {
          await ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0x2105' }],
          })
        } catch {
          setAirdropStep('error')
          setAirdropError('Please switch to Base network in your wallet')
          return
        }
      }

      const addresses = selectedWallets.map(w => w.walletAddress)
      const amounts = selectedWallets.map(w =>
        ethers.parseUnits(Math.round(parseFloat(w.airdropNeeded || '0')).toString(), 18)
      )
      const totalAmount = amounts.reduce((sum, a) => sum + a, 0n)

      // Balance check
      const wordToken = new ethers.Contract(WORD_TOKEN_ADDRESS, [
        'function balanceOf(address) view returns (uint256)',
        'function allowance(address owner, address spender) view returns (uint256)',
        'function approve(address spender, uint256 amount) returns (bool)',
      ], signer)

      const balance = await wordToken.balanceOf(signerAddress)
      if (balance < totalAmount) {
        const have = parseFloat(ethers.formatUnits(balance, 18))
        setAirdropStep('error')
        setAirdropError(`Insufficient $WORD. Need ${formatCompact(selectedTotal)}, have ${formatCompact(have)}`)
        return
      }

      // Approve
      setAirdropStep('approving')
      const allowance = await wordToken.allowance(signerAddress, DISPERSE_ADDRESS)
      if (allowance < totalAmount) {
        const approveTx = await wordToken.approve(DISPERSE_ADDRESS, totalAmount)
        await approveTx.wait()
      }

      // Disperse
      setAirdropStep('sending')
      const disperse = new ethers.Contract(DISPERSE_ADDRESS, [
        'function disperseToken(address token, address[] recipients, uint256[] values)',
      ], signer)
      const tx = await disperse.disperseToken(WORD_TOKEN_ADDRESS, addresses, amounts)
      setAirdropTxHash(tx.hash)
      await tx.wait()

      // Mark all as sent via API
      for (const wallet of selectedWallets) {
        await fetch('/api/admin/airdrop/manage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'mark-sent',
            walletId: wallet.id,
            txHash: tx.hash,
            note: `Batch airdrop via Disperse (${selectedWallets.length} wallets)`,
            devFid,
          }),
        })
      }

      setAirdropStep('done')
      setSelectedIds(new Set())
      setSuccess(`Airdrop sent to ${selectedWallets.length} wallets`)
      await fetchData()
    } catch (err: any) {
      const msg = err.code === 'ACTION_REJECTED'
        ? 'Transaction rejected'
        : (err.shortMessage || err.message || 'Airdrop failed')
      setAirdropStep('error')
      setAirdropError(msg)
    }
  }

  const dismissAirdropPanel = () => {
    setAirdropStep('idle')
    setAirdropTxHash(null)
    setAirdropError(null)
  }

  // ============================================================================
  // Sorting
  // ============================================================================

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sortArrow = (key: SortKey) => {
    if (sortKey !== key) return ''
    return sortDir === 'asc' ? ' \u25B2' : ' \u25BC'
  }

  const sortedWallets = [...wallets]
    .filter(w => {
      if (!showOnlyNeeding) return true
      const needed = parseFloat(w.airdropNeeded || '0')
      return needed > 0 && w.distributions.length === 0
    })
    .sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'walletAddress':
          cmp = a.walletAddress.localeCompare(b.walletAddress)
          break
        case 'snapshotBalance':
          cmp = parseFloat(a.snapshotBalance || '0') - parseFloat(b.snapshotBalance || '0')
          break
        case 'currentWordBalance':
          cmp = parseFloat(a.currentWordBalance || '0') - parseFloat(b.currentWordBalance || '0')
          break
        case 'airdropNeeded':
          cmp = parseFloat(a.airdropNeeded || '0') - parseFloat(b.airdropNeeded || '0')
          break
        case 'balanceLastCheckedAt': {
          const aTime = a.balanceLastCheckedAt ? new Date(a.balanceLastCheckedAt).getTime() : 0
          const bTime = b.balanceLastCheckedAt ? new Date(b.balanceLastCheckedAt).getTime() : 0
          cmp = aTime - bTime
          break
        }
        case 'status': {
          const order = { sent: 0, pending: 1, error: 2 }
          cmp = order[getWalletStatus(a)] - order[getWalletStatus(b)]
          break
        }
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

  // ============================================================================
  // Render
  // ============================================================================

  if (loading && wallets.length === 0 && !needsMigration) {
    return (
      <div style={{ textAlign: 'center', padding: '48px', color: '#6b7280' }}>
        Loading airdrop data...
      </div>
    )
  }

  // ---------- Migration setup panel ----------
  if (needsMigration) {
    return (
      <div>
        {error && (
          <div style={styles.alert('error')}>
            {error}
            <button
              onClick={() => setError(null)}
              style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626' }}
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
              style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: '#16a34a' }}
            >
              &times;
            </button>
          </div>
        )}
        <div style={{
          ...styles.card,
          textAlign: 'center' as const,
          padding: '48px 24px',
        }}>
          <div style={{ fontSize: '40px', marginBottom: '16px' }}>🪂</div>
          <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#111827', margin: '0 0 8px 0' }}>
            Airdrop Manager Setup
          </h2>
          <p style={{ fontSize: '14px', color: '#6b7280', margin: '0 0 32px 0' }}>
            The airdrop tables need to be created in the database. Run the migrations below in order.
          </p>

          <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
            {/* Step 1: Schema */}
            <button
              onClick={() => handleRunMigration('0006_airdrop_manager')}
              disabled={migrationRunning !== null || schemaApplied}
              style={{
                padding: '14px 28px',
                background: schemaApplied ? '#dcfce7' : '#2563eb',
                color: schemaApplied ? '#166534' : 'white',
                border: schemaApplied ? '1px solid #bbf7d0' : 'none',
                borderRadius: '10px',
                fontSize: '15px',
                fontWeight: 600,
                cursor: migrationRunning !== null || schemaApplied ? 'default' : 'pointer',
                opacity: migrationRunning === '0006_airdrop_manager' ? 0.7 : 1,
                minWidth: '220px',
              }}
            >
              {migrationRunning === '0006_airdrop_manager'
                ? 'Creating tables...'
                : schemaApplied
                ? 'Step 1: Tables Created'
                : 'Step 1: Create Tables'}
            </button>

            {/* Step 2: Seed data */}
            <button
              onClick={() => handleRunMigration('0007_seed_airdrop_holders')}
              disabled={migrationRunning !== null || !schemaApplied}
              style={{
                padding: '14px 28px',
                background: !schemaApplied ? '#f3f4f6' : '#f59e0b',
                color: !schemaApplied ? '#9ca3af' : 'white',
                border: !schemaApplied ? '1px solid #e5e7eb' : 'none',
                borderRadius: '10px',
                fontSize: '15px',
                fontWeight: 600,
                cursor: migrationRunning !== null || !schemaApplied ? 'default' : 'pointer',
                opacity: migrationRunning === '0007_seed_airdrop_holders' ? 0.7 : 1,
                minWidth: '220px',
              }}
            >
              {migrationRunning === '0007_seed_airdrop_holders'
                ? 'Seeding wallets...'
                : 'Step 2: Seed 38 Wallets'}
            </button>
          </div>

          <p style={{ fontSize: '12px', color: '#9ca3af', marginTop: '24px' }}>
            Both operations are idempotent and safe to re-run.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Alerts */}
      {error && (
        <div style={styles.alert('error')}>
          {error}
          <button
            onClick={() => setError(null)}
            style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626' }}
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
            style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: '#16a34a' }}
          >
            &times;
          </button>
        </div>
      )}

      {/* A. Summary Stats */}
      {summary && (
        <div style={styles.statGrid}>
          <div style={styles.statCard}>
            <div style={styles.statLabel}>Total Wallets</div>
            <div style={styles.statValue}>{summary.totalWallets}</div>
          </div>
          <div style={styles.statCard}>
            <div style={styles.statLabel}>Total $WORD Needed</div>
            <div style={{ ...styles.statValue, color: '#d97706' }}>
              {formatCompact(summary.totalWordNeeded)}
            </div>
          </div>
          <div style={styles.statCard}>
            <div style={styles.statLabel}>Already Above 200M</div>
            <div style={{ ...styles.statValue, color: '#16a34a' }}>
              {summary.aboveFloor}
            </div>
          </div>
          <div style={styles.statCard}>
            <div style={styles.statLabel}>Needing Airdrop</div>
            <div style={{ ...styles.statValue, color: '#dc2626' }}>
              {summary.needingAirdrop}
            </div>
          </div>
        </div>
      )}

      {/* B. Action Bar */}
      <div style={{
        ...styles.card,
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        flexWrap: 'wrap',
        padding: '16px 24px',
      }}>
        <button
          style={{
            ...styles.btnSecondary,
            background: showUpload ? '#dbeafe' : '#f3f4f6',
            borderColor: showUpload ? '#93c5fd' : '#d1d5db',
          }}
          onClick={() => setShowUpload(!showUpload)}
        >
          {showUpload ? 'Hide Upload' : 'Upload CSV'}
        </button>

        <button
          style={{
            ...styles.btnPrimary,
            opacity: refreshing ? 0.7 : 1,
          }}
          onClick={handleRefreshAll}
          disabled={refreshing}
        >
          {refreshing ? 'Refreshing...' : 'Refresh All Balances'}
        </button>

        <button
          style={styles.btnSecondary}
          onClick={handleExportCsv}
          disabled={wallets.length === 0}
        >
          Export CSV
        </button>

        <button
          style={{
            ...styles.btnSecondary,
            background: showMarkAll ? '#dbeafe' : '#f3f4f6',
            borderColor: showMarkAll ? '#93c5fd' : '#d1d5db',
          }}
          onClick={() => setShowMarkAll(!showMarkAll)}
        >
          Mark All as Sent
        </button>

        <label style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '13px',
          color: '#374151',
          marginLeft: 'auto',
          cursor: 'pointer',
        }}>
          <input
            type="checkbox"
            checked={showOnlyNeeding}
            onChange={e => setShowOnlyNeeding(e.target.checked)}
          />
          Show Only Needing
        </label>
      </div>

      {/* Mark All as Sent Dialog */}
      {showMarkAll && (
        <div style={{
          ...styles.card,
          background: '#fffbeb',
          border: '1px solid #fde68a',
        }}>
          <h3 style={{ ...styles.cardTitle, fontSize: '14px' }}>Mark All Pending as Sent</h3>
          <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
            <input
              type="text"
              style={{ ...styles.input, flex: 1 }}
              placeholder="Tx hash (optional)"
              value={markAllTxHash}
              onChange={e => setMarkAllTxHash(e.target.value)}
            />
            <input
              type="text"
              style={{ ...styles.input, flex: 1 }}
              placeholder="Note (optional)"
              value={markAllNote}
              onChange={e => setMarkAllNote(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button style={styles.btnPrimary} onClick={handleMarkAllSent}>
              Confirm Mark All
            </button>
            <button style={styles.btnSecondary} onClick={() => setShowMarkAll(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Selection Bar */}
      {selectedIds.size > 0 && airdropStep === 'idle' && (
        <div style={{
          ...styles.card,
          background: '#eef2ff',
          border: '1px solid #c7d2fe',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          padding: '14px 24px',
        }}>
          <span style={{ fontSize: '14px', fontWeight: 600, color: '#4338ca' }}>
            {selectedWallets.length} wallet{selectedWallets.length !== 1 ? 's' : ''} selected
          </span>
          <span style={{ fontSize: '13px', color: '#6366f1' }}>
            {formatCompact(selectedTotal)} $WORD total
          </span>
          <button
            style={{
              padding: '10px 24px',
              background: '#4f46e5',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              marginLeft: 'auto',
            }}
            onClick={() => setAirdropStep('confirming')}
          >
            Send Airdrop
          </button>
          <button
            style={{ ...styles.btnSecondary, padding: '10px 16px' }}
            onClick={() => setSelectedIds(new Set())}
          >
            Clear
          </button>
        </div>
      )}

      {/* Airdrop Execution Panel */}
      {airdropStep !== 'idle' && (
        <div style={{
          ...styles.card,
          background: airdropStep === 'error' ? '#fef2f2' : airdropStep === 'done' ? '#f0fdf4' : '#f5f3ff',
          border: `1px solid ${airdropStep === 'error' ? '#fecaca' : airdropStep === 'done' ? '#bbf7d0' : '#c7d2fe'}`,
          padding: '24px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
            <h3 style={{ ...styles.cardTitle, margin: 0, color: airdropStep === 'error' ? '#dc2626' : '#111827' }}>
              {airdropStep === 'confirming' && 'Confirm Airdrop'}
              {airdropStep === 'approving' && 'Approving $WORD...'}
              {airdropStep === 'sending' && 'Sending Airdrop...'}
              {airdropStep === 'done' && 'Airdrop Complete'}
              {airdropStep === 'error' && 'Airdrop Failed'}
            </h3>
            {(airdropStep === 'done' || airdropStep === 'error' || airdropStep === 'confirming') && (
              <button
                onClick={dismissAirdropPanel}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: '#6b7280' }}
              >
                &times;
              </button>
            )}
          </div>

          {airdropStep === 'confirming' && (
            <div>
              <div style={{
                background: 'white',
                borderRadius: '8px',
                padding: '16px',
                marginBottom: '16px',
                border: '1px solid #e5e7eb',
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>RECIPIENTS</div>
                    <div style={{ fontSize: '20px', fontWeight: 700 }}>{selectedWallets.length} wallets</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>TOTAL $WORD</div>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: '#d97706' }}>{formatCompact(selectedTotal)}</div>
                  </div>
                </div>
              </div>
              <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '16px' }}>
                This will approve and send $WORD via Disperse.app in one batch transaction on Base.
                You will be prompted to confirm in your wallet.
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  style={{
                    padding: '12px 28px',
                    background: '#4f46e5',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '15px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                  onClick={handleExecuteAirdrop}
                >
                  Approve & Send
                </button>
                <button style={styles.btnSecondary} onClick={dismissAirdropPanel}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {(airdropStep === 'approving' || airdropStep === 'sending') && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{
                width: '20px',
                height: '20px',
                border: '3px solid #c7d2fe',
                borderTopColor: '#4f46e5',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
              }} />
              <span style={{ fontSize: '14px', color: '#374151' }}>
                {airdropStep === 'approving'
                  ? 'Confirm the approval transaction in your wallet...'
                  : airdropTxHash
                    ? 'Transaction submitted, waiting for confirmation...'
                    : 'Confirm the airdrop transaction in your wallet...'}
              </span>
              {airdropTxHash && (
                <a
                  href={`https://basescan.org/tx/${airdropTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: '13px', color: '#4f46e5' }}
                >
                  View on Basescan
                </a>
              )}
              <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
            </div>
          )}

          {airdropStep === 'done' && airdropTxHash && (
            <div>
              <p style={{ fontSize: '14px', color: '#166534', marginBottom: '8px' }}>
                Successfully sent $WORD to {selectedWallets.length || 'all selected'} wallets.
              </p>
              <a
                href={`https://basescan.org/tx/${airdropTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: '13px', color: '#4f46e5' }}
              >
                View transaction on Basescan
              </a>
            </div>
          )}

          {airdropStep === 'error' && (
            <div>
              <p style={{ fontSize: '14px', color: '#dc2626' }}>{airdropError}</p>
            </div>
          )}
        </div>
      )}

      {/* C. CSV Upload Area */}
      {showUpload && (
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Import CSV</h3>
          <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '12px' }}>
            Format: <code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: '4px' }}>wallet_address,balance</code> (one per line)
          </p>

          <div style={{ marginBottom: '12px' }}>
            <input
              type="file"
              accept=".csv,.txt"
              onChange={handleFileUpload}
              style={{ fontSize: '13px', marginBottom: '8px' }}
            />
          </div>

          <textarea
            style={styles.textarea}
            placeholder={`0x1234...abcd,150000000\n0x5678...efgh,120000000`}
            value={csvText}
            onChange={e => setCsvText(e.target.value)}
          />

          {csvText && (
            <div style={{ fontSize: '13px', color: '#6b7280', margin: '8px 0' }}>
              {csvText.split('\n').filter(l => l.trim()).length} lines detected
            </div>
          )}

          <button
            style={{
              ...styles.btnPrimary,
              marginTop: '8px',
              opacity: importing || !csvText.trim() ? 0.6 : 1,
            }}
            onClick={handleImportCsv}
            disabled={importing || !csvText.trim()}
          >
            {importing ? 'Importing...' : 'Import'}
          </button>
        </div>
      )}

      {/* D. Data Table */}
      <div style={{ ...styles.card, padding: '0', overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...styles.th, cursor: 'default', width: '40px', textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={eligibleWallets.length > 0 && selectedIds.size >= eligibleWallets.length}
                  onChange={toggleSelectAll}
                  style={{ cursor: 'pointer' }}
                  title="Select all eligible wallets"
                />
              </th>
              <th style={styles.th} onClick={() => handleSort('walletAddress')}>
                Wallet{sortArrow('walletAddress')}
              </th>
              <th style={{ ...styles.th, textAlign: 'right' }} onClick={() => handleSort('snapshotBalance')}>
                CLANKTON Snapshot{sortArrow('snapshotBalance')}
              </th>
              <th style={{ ...styles.th, textAlign: 'right' }} onClick={() => handleSort('currentWordBalance')}>
                Current $WORD{sortArrow('currentWordBalance')}
              </th>
              <th style={{ ...styles.th, textAlign: 'right' }} onClick={() => handleSort('airdropNeeded')}>
                Airdrop Needed{sortArrow('airdropNeeded')}
              </th>
              <th style={styles.th} onClick={() => handleSort('balanceLastCheckedAt')}>
                Last Checked{sortArrow('balanceLastCheckedAt')}
              </th>
              <th style={styles.th} onClick={() => handleSort('status')}>
                Status{sortArrow('status')}
              </th>
              <th style={{ ...styles.th, cursor: 'default' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedWallets.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ ...styles.td, textAlign: 'center', padding: '32px', color: '#9ca3af' }}>
                  {wallets.length === 0 ? 'No wallets imported yet. Upload a CSV to get started.' : 'No wallets match the current filter.'}
                </td>
              </tr>
            ) : (
              sortedWallets.map(w => {
                const needed = parseFloat(w.airdropNeeded || '0')
                const currentBal = w.currentWordBalance ? parseFloat(w.currentWordBalance) : null
                const status = getWalletStatus(w)
                const isMarkSentOpen = markSentWalletId === w.id

                return (
                  <React.Fragment key={w.id}>
                    <tr style={{ background: isMarkSentOpen ? '#f0f9ff' : selectedIds.has(w.id) ? '#eef2ff' : undefined }}>
                      {/* Checkbox */}
                      <td style={{ ...styles.td, textAlign: 'center', width: '40px' }}>
                        {isEligibleForAirdrop(w) ? (
                          <input
                            type="checkbox"
                            checked={selectedIds.has(w.id)}
                            onChange={() => toggleSelect(w.id)}
                            style={{ cursor: 'pointer' }}
                          />
                        ) : (
                          <span style={{ color: '#d1d5db' }}>-</span>
                        )}
                      </td>
                      {/* Wallet Address */}
                      <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: '12px' }}>
                        <span
                          style={{ cursor: 'pointer', borderBottom: '1px dashed #9ca3af' }}
                          onClick={() => copyAddress(w.walletAddress)}
                          title={w.walletAddress}
                        >
                          {copiedAddr === w.walletAddress ? 'Copied!' : truncateAddress(w.walletAddress)}
                        </span>
                      </td>

                      {/* CLANKTON Snapshot */}
                      <td style={{ ...styles.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {formatNumber(parseFloat(w.snapshotBalance || '0'))}
                      </td>

                      {/* Current $WORD */}
                      <td style={{ ...styles.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {currentBal !== null ? formatNumber(Math.round(currentBal)) : '-'}
                      </td>

                      {/* Airdrop Needed */}
                      <td style={{
                        ...styles.td,
                        textAlign: 'right',
                        fontWeight: needed > 0 ? 700 : 400,
                        color: needed > 0 ? '#d97706' : '#16a34a',
                        fontVariantNumeric: 'tabular-nums',
                      }}>
                        {w.airdropNeeded !== null ? formatNumber(Math.round(needed)) : '-'}
                      </td>

                      {/* Last Checked */}
                      <td style={{ ...styles.td, fontSize: '12px', color: '#6b7280' }}>
                        {relativeTime(w.balanceLastCheckedAt)}
                      </td>

                      {/* Status */}
                      <td style={styles.td}>
                        {status === 'sent' && (
                          <span style={{
                            display: 'inline-block',
                            padding: '2px 10px',
                            borderRadius: '9999px',
                            fontSize: '12px',
                            fontWeight: 500,
                            background: '#dcfce7',
                            color: '#166534',
                          }}>
                            Sent
                          </span>
                        )}
                        {status === 'pending' && (
                          <span style={{
                            display: 'inline-block',
                            padding: '2px 10px',
                            borderRadius: '9999px',
                            fontSize: '12px',
                            fontWeight: 500,
                            background: '#fef9c3',
                            color: '#854d0e',
                          }}>
                            Pending
                          </span>
                        )}
                        {status === 'error' && (
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '2px 10px',
                              borderRadius: '9999px',
                              fontSize: '12px',
                              fontWeight: 500,
                              background: '#fef2f2',
                              color: '#dc2626',
                            }}
                            title={w.balanceCheckError || ''}
                          >
                            Error
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          {status !== 'sent' && needed > 0 && (
                            <button
                              style={{ ...styles.btnSmall, background: '#dbeafe', color: '#1d4ed8', borderColor: '#93c5fd' }}
                              onClick={() => {
                                setMarkSentWalletId(isMarkSentOpen ? null : w.id)
                                setMarkSentTxHash("")
                                setMarkSentNote("")
                              }}
                            >
                              {isMarkSentOpen ? 'Cancel' : 'Mark Sent'}
                            </button>
                          )}
                          {status === 'sent' && w.distributions.length > 0 && (
                            <button
                              style={{ ...styles.btnSmall, background: '#fef2f2', color: '#dc2626', borderColor: '#fecaca' }}
                              onClick={() => handleUnmarkSent(w.distributions[w.distributions.length - 1].id)}
                            >
                              Undo
                            </button>
                          )}
                          <button
                            style={styles.btnSmall}
                            onClick={() => handleRefreshSingle(w.id)}
                          >
                            Refresh
                          </button>
                          <button
                            style={{ ...styles.btnSmall, color: '#dc2626', borderColor: '#fecaca' }}
                            onClick={() => handleDeleteWallet(w.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* F. Inline Mark Sent Dialog */}
                    {isMarkSentOpen && (
                      <tr>
                        <td colSpan={8} style={{
                          padding: '12px 16px',
                          background: '#f0f9ff',
                          borderBottom: '1px solid #bae6fd',
                        }}>
                          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                            <input
                              type="text"
                              style={{ ...styles.input, flex: 1, fontSize: '13px' }}
                              placeholder="Tx hash (optional)"
                              value={markSentTxHash}
                              onChange={e => setMarkSentTxHash(e.target.value)}
                            />
                            <input
                              type="text"
                              style={{ ...styles.input, flex: 1, fontSize: '13px' }}
                              placeholder="Note (optional)"
                              value={markSentNote}
                              onChange={e => setMarkSentNote(e.target.value)}
                            />
                            <button
                              style={{ ...styles.btnPrimary, padding: '8px 16px', fontSize: '13px' }}
                              onClick={() => handleMarkSent(w.id)}
                            >
                              Confirm
                            </button>
                            <button
                              style={{ ...styles.btnSecondary, padding: '8px 16px', fontSize: '13px' }}
                              onClick={() => setMarkSentWalletId(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Table footer info */}
      <div style={{ fontSize: '12px', color: '#9ca3af', textAlign: 'right', marginTop: '8px' }}>
        Showing {sortedWallets.length} of {wallets.length} wallets
      </div>
    </div>
  )
}

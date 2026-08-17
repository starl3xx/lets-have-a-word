/**
 * Archive Maintenance — the write half of the old Archive tab, moved to
 * Operations (Phase D): destructive sync/repair actions do not belong in a
 * browse surface. The Archive tab is read-only now; it refetches on visit,
 * so these actions do not need to refresh its list from here.
 */

import React, { useState } from 'react'
import { AlertBanner, Module } from './ui'

const fontFamily = "'Söhne', 'SF Pro Display', system-ui, -apple-system, sans-serif"

const styles = {
  btn: {
    padding: "8px 16px",
    background: "#6366f1",
    color: "white",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 500,
    fontFamily,
  },
}

export default function ArchiveMaintenanceCard({ fid }: { fid: number }) {
  const [syncing, setSyncing] = useState(false)
  const [forceSyncing, setForceSyncing] = useState(false)
  const [fixingRound, setFixingRound] = useState(false)
  const [syncResult, setSyncResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  const syncArchive = async (force = false) => {
    if (!fid) return

    if (force) {
      setForceSyncing(true)
    } else {
      setSyncing(true)
    }
    setSyncResult(null)

    try {
      const response = await fetch(`/api/admin/archive/sync?devFid=${fid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      })
      if (!response.ok) throw new Error('Failed to sync archive')
      const result = await response.json()
      setSyncResult(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncing(false)
      setForceSyncing(false)
    }
  }

  const fixAndArchiveRound = async (roundNumber?: number) => {
    if (!fid) return

    setFixingRound(true)
    setSyncResult(null)
    setError(null)

    try {
      // If no roundNumber specified, let the endpoint find the unarchived round
      const url = roundNumber
        ? `/api/admin/operational/fix-and-archive-round?devFid=${fid}&roundId=${roundNumber}`
        : `/api/admin/operational/fix-and-archive-round?devFid=${fid}`
      const response = await fetch(url, { method: 'GET' })
      const result = await response.json()

      if (result.success) {
        setSyncResult({
          archived: 1,
          alreadyArchived: 0,
          failed: 0,
          errors: [],
          fixResult: result,
        })
      } else {
        // Build a detailed error message with diagnostic info
        let errorMsg = result.error || result.details || 'Fix failed'
        if (result.diagnostic) {
          const diag = result.diagnostic
          errorMsg += `\n\nDiagnostic Info:\n`
          errorMsg += `All rounds: ${JSON.stringify(diag.allRounds, null, 2)}\n`
          errorMsg += `Archived round numbers: ${JSON.stringify(diag.archivedRoundNumbers)}\n`
          errorMsg += `Resolved round IDs: ${JSON.stringify(diag.resolvedRoundIds)}\n`
          errorMsg += `Message: ${diag.message}`
        }
        setError(errorMsg)
        setSyncResult({
          archived: 0,
          alreadyArchived: 0,
          failed: 1,
          errors: [result.error || result.details],
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fix failed')
    } finally {
      setFixingRound(false)
    }
  }

  return (
    <Module title="Archive Maintenance">
      {error && <AlertBanner kind="error">{error}</AlertBanner>}
      {/* Sync Result */}
      {syncResult && (
        <div style={{
          background: syncResult.failed > 0 ? "#fef3c7" : "#d1fae5",
          border: `1px solid ${syncResult.failed > 0 ? "#fbbf24" : "#34d399"}`,
          borderRadius: "8px",
          padding: "16px",
          marginBottom: "20px",
          fontFamily,
        }}>
          <strong>Sync Complete:</strong> {syncResult.archived || syncResult.synced || 0} new, {syncResult.alreadyArchived || 0} existing, {syncResult.failed || 0} failed
          {syncResult.errors?.length > 0 && (
            <ul style={{ margin: "8px 0 0 0", paddingLeft: "20px" }}>
              {syncResult.errors.map((err: string, idx: number) => (
                <li key={idx}>{err}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <button
            onClick={() => syncArchive(false)}
            style={styles.btn}
            disabled={syncing || forceSyncing}
          >
            {syncing ? 'Syncing...' : 'Sync New'}
          </button>
          <button
            onClick={() => syncArchive(true)}
            style={{
              ...styles.btn,
              background: "#dc2626",
            }}
            disabled={syncing || forceSyncing}
            title="Delete and re-archive all rounds (fixes ranking issues)"
          >
            {forceSyncing ? 'Re-syncing...' : 'Force Re-sync All'}
          </button>
          <button
            onClick={() => fixAndArchiveRound()}
            style={{
              ...styles.btn,
              background: "#f59e0b",
            }}
            disabled={fixingRound || syncing || forceSyncing}
            title="Emergency fix - finds and archives any unarchived resolved round"
          >
            {fixingRound ? 'Fixing...' : '🔧 Fix Unarchived'}
          </button>
      </div>
    </Module>
  )
}

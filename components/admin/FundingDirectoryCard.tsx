/**
 * Funding directory — Treasury tab.
 *
 * One card that answers "where do I send this?" without hunting: the two
 * $WORD game-funding destinations up top (jackpot pool, bonus/burn +
 * staking), everything else below. Full addresses, one-tap copy, Basescan
 * links, and an explicit "not configured" state for contracts that are not
 * deployed yet.
 */

import React, { useEffect, useState } from 'react'
import { Module, adminMono } from './ui'
import type { AddressBookEntry } from '../../pages/api/admin/operational/contract-state'

export default function FundingDirectoryCard({ fid }: { fid: number }) {
  const [book, setBook] = useState<AddressBookEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(`/api/admin/operational/contract-state?book=1&devFid=${fid}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!cancelled) setBook(data.addressBook ?? [])
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load')
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [fid])

  const copy = async (key: string, address: string) => {
    try {
      await navigator.clipboard.writeText(address)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500)
    } catch {
      // Clipboard can be unavailable (non-secure context); the address is
      // selectable text either way.
    }
  }

  const renderEntry = (entry: AddressBookEntry, prominent: boolean) => (
    <div
      key={entry.key}
      style={{
        padding: prominent ? '14px 16px' : '10px 16px',
        background: prominent ? '#f0fdf4' : '#f9fafb',
        border: `1px solid ${prominent ? '#bbf7d0' : '#e5e7eb'}`,
        borderRadius: '10px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <span
          style={{
            fontSize: prominent ? '14px' : '13px',
            fontWeight: 600,
            color: '#111827',
          }}
        >
          {entry.label}
        </span>
        {entry.sends && (
          <span
            style={{
              fontSize: '11px',
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: '999px',
              background: entry.sends === '$WORD' ? '#d1fae5' : '#dbeafe',
              color: entry.sends === '$WORD' ? '#065f46' : '#1e40af',
            }}
          >
            send {entry.sends}
          </span>
        )}
      </div>

      {entry.address ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
            margin: '6px 0 4px 0',
          }}
        >
          <code
            style={{
              fontFamily: adminMono,
              fontSize: prominent ? '13px' : '12px',
              color: '#111827',
              wordBreak: 'break-all',
              background: 'white',
              border: '1px solid #e5e7eb',
              borderRadius: '6px',
              padding: '4px 8px',
            }}
          >
            {entry.address}
          </code>
          <button
            onClick={() => copy(entry.key, entry.address!)}
            style={{
              fontSize: '12px',
              fontWeight: 600,
              padding: '4px 10px',
              borderRadius: '6px',
              border: '1px solid #d1d5db',
              background: copiedKey === entry.key ? '#dcfce7' : 'white',
              color: copiedKey === entry.key ? '#166534' : '#374151',
              cursor: 'pointer',
            }}
          >
            {copiedKey === entry.key ? 'Copied ✓' : 'Copy'}
          </button>
          <a
            href={`https://basescan.org/address/${entry.address}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: '12px', color: '#2563eb', textDecoration: 'none' }}
          >
            Basescan ↗
          </a>
        </div>
      ) : (
        <div
          style={{
            fontSize: '12px',
            color: '#92400e',
            background: '#fef3c7',
            border: '1px solid #fde68a',
            borderRadius: '6px',
            padding: '4px 8px',
            margin: '6px 0 4px 0',
            display: 'inline-block',
          }}
        >
          Not configured yet{entry.envVar ? ` — set ${entry.envVar} in Vercel, then redeploy` : ''}
        </div>
      )}

      <div style={{ fontSize: '12px', color: '#6b7280', lineHeight: 1.5 }}>{entry.how}</div>
    </div>
  )

  const primaries = (book ?? []).filter((e) => e.primary)
  const secondaries = (book ?? []).filter((e) => !e.primary)

  return (
    <Module title="Funding directory">
      <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 14px 0' }}>
        Where to send funds, and what each address does. Green rows are the $WORD
        game-funding destinations.
      </p>

      {error && (
        <div style={{ fontSize: '13px', color: '#dc2626' }}>
          Failed to load addresses: {error}
        </div>
      )}
      {!book && !error && (
        <div style={{ fontSize: '13px', color: '#6b7280' }}>Loading…</div>
      )}

      {book && (
        <div style={{ display: 'grid', gap: '10px' }}>
          {primaries.map((e) => renderEntry(e, true))}
          <div
            style={{
              fontSize: '11px',
              fontWeight: 600,
              color: '#9ca3af',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              margin: '6px 0 0 2px',
            }}
          >
            Other addresses
          </div>
          {secondaries.map((e) => renderEntry(e, false))}
        </div>
      )}
    </Module>
  )
}

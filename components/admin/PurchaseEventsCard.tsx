/**
 * Onchain Purchase Events — moved from Analytics to Treasury (Phase D):
 * a contract-log explorer belongs with the money views.
 */

import React, { useState } from 'react'
import { Module } from './ui'
import { adminFont as fontFamily } from "./ui"
import { formatCentral } from './format'


const localStyles = {
  grid: {
    display: 'grid' as const,
    gap: '12px',
  },
}

interface PurchaseEvent {
  txHash: string
  blockNumber: number
  timestamp: string
  player: string
  fid: number | null
  username: string | null
  quantity: number
  ethAmount: string
  roundNumber: number
  isSmartWallet: boolean
  product?: 'guesses' | 'packs' | 'superguess'
  toJackpot?: string
  toCreator?: string
}

interface PurchaseEventsResponse {
  events: PurchaseEvent[]
  totalEvents: number
  fromBlock: number
  toBlock: number
  contractAddress: string
}

export default function PurchaseEventsCard({
  fid,
  currentRoundId,
}: {
  fid: number
  currentRoundId?: number
}) {
  const [purchaseEvents, setPurchaseEvents] = useState<PurchaseEventsResponse | null>(null)
  const [purchaseEventsLoading, setPurchaseEventsLoading] = useState(false)

  // Fetch purchase events from contract (on-demand, can be slow)
  const fetchPurchaseEvents = async (roundNumber?: number) => {
    if (!fid) return
    setPurchaseEventsLoading(true)
    try {
      const params = new URLSearchParams({ devFid: fid.toString() })
      if (roundNumber) params.set('roundNumber', roundNumber.toString())
      const res = await fetch(`/api/admin/analytics/purchase-events?${params}`)
      if (res.ok) {
        setPurchaseEvents(await res.json())
      }
    } catch (err) {
      console.error('Failed to fetch purchase events:', err)
    } finally {
      setPurchaseEventsLoading(false)
    }
  }

  return (
    <>
      <Module title="Onchain Purchase Events">
        <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "16px", fontFamily }}>
          Query purchase events directly from the contracts — WordPackSales (packs + Superguesses, round 34+) and the legacy JackpotManager (rounds 1–33). This captures ALL purchases including smart wallet transactions that don't appear in Basescan's external tx filter.
        </div>
        <div style={{ display: "flex", gap: "12px", marginBottom: "16px", alignItems: "center" }}>
          <button
            onClick={() => fetchPurchaseEvents(currentRoundId)}
            disabled={purchaseEventsLoading}
            style={{
              padding: "8px 16px",
              background: purchaseEventsLoading ? "#d1d5db" : "#059669",
              color: "white",
              border: "none",
              borderRadius: "6px",
              fontSize: "13px",
              fontWeight: 500,
              cursor: purchaseEventsLoading ? "not-allowed" : "pointer",
              fontFamily,
            }}
          >
            {purchaseEventsLoading ? "Loading events..." : currentRoundId ? `Load Round ${currentRoundId} Events` : "Load Recent Events"}
          </button>
          <button
            onClick={() => fetchPurchaseEvents()}
            disabled={purchaseEventsLoading}
            style={{
              padding: "8px 16px",
              background: purchaseEventsLoading ? "#d1d5db" : "#6366f1",
              color: "white",
              border: "none",
              borderRadius: "6px",
              fontSize: "13px",
              fontWeight: 500,
              cursor: purchaseEventsLoading ? "not-allowed" : "pointer",
              fontFamily,
            }}
          >
            Load All Recent
          </button>
          {purchaseEvents && (
            <span style={{ fontSize: "12px", color: "#6b7280" }}>
              {purchaseEvents.totalEvents} events (blocks {purchaseEvents.fromBlock.toLocaleString()} - {purchaseEvents.toBlock.toLocaleString()})
            </span>
          )}
        </div>
        {purchaseEvents && purchaseEvents.events.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "12px",
              fontFamily,
            }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "8px", borderBottom: "2px solid #e5e7eb", color: "#374151", fontWeight: 600 }}>Time</th>
                  <th style={{ textAlign: "left", padding: "8px", borderBottom: "2px solid #e5e7eb", color: "#374151", fontWeight: 600 }}>User</th>
                  <th style={{ textAlign: "center", padding: "8px", borderBottom: "2px solid #e5e7eb", color: "#374151", fontWeight: 600 }}>Qty</th>
                  <th style={{ textAlign: "right", padding: "8px", borderBottom: "2px solid #e5e7eb", color: "#374151", fontWeight: 600 }}>ETH</th>
                  <th style={{ textAlign: "center", padding: "8px", borderBottom: "2px solid #e5e7eb", color: "#374151", fontWeight: 600 }}>Round</th>
                  <th style={{ textAlign: "center", padding: "8px", borderBottom: "2px solid #e5e7eb", color: "#374151", fontWeight: 600 }}>Product</th>
                  <th style={{ textAlign: "center", padding: "8px", borderBottom: "2px solid #e5e7eb", color: "#374151", fontWeight: 600 }}>Type</th>
                  <th style={{ textAlign: "left", padding: "8px", borderBottom: "2px solid #e5e7eb", color: "#374151", fontWeight: 600 }}>Tx</th>
                </tr>
              </thead>
              <tbody>
                {purchaseEvents.events.slice(0, 50).map((event) => (
                  <tr key={event.txHash}>
                    <td style={{ padding: "8px", borderBottom: "1px solid #f3f4f6", color: "#6b7280" }}>
                      {event.timestamp ? formatCentral(event.timestamp) : `Block ${event.blockNumber}`}
                    </td>
                    <td style={{ padding: "8px", borderBottom: "1px solid #f3f4f6", color: "#374151" }}>
                      {event.fid ? (
                        <span>@{event.username || event.fid}</span>
                      ) : (
                        <span style={{ fontFamily: "monospace", fontSize: "11px" }}>{event.player.slice(0, 6)}...{event.player.slice(-4)}</span>
                      )}
                    </td>
                    <td style={{ textAlign: "center", padding: "8px", borderBottom: "1px solid #f3f4f6", color: "#374151", fontWeight: 600 }}>
                      {event.quantity}
                    </td>
                    <td style={{ textAlign: "right", padding: "8px", borderBottom: "1px solid #f3f4f6", color: "#059669", fontWeight: 500, fontFamily: "monospace" }}>
                      {parseFloat(event.ethAmount).toFixed(4)}
                    </td>
                    <td style={{ textAlign: "center", padding: "8px", borderBottom: "1px solid #f3f4f6", color: "#6b7280" }}>
                      #{event.roundNumber}
                    </td>
                    <td style={{ textAlign: "center", padding: "8px", borderBottom: "1px solid #f3f4f6" }}>
                      {event.product === 'superguess' ? (
                        <span style={{ padding: "2px 6px", background: "#fee2e2", color: "#dc2626", borderRadius: "4px", fontSize: "10px", fontWeight: 600 }}>SUPER</span>
                      ) : event.product === 'packs' ? (
                        <span style={{ padding: "2px 6px", background: "#d1fae5", color: "#065f46", borderRadius: "4px", fontSize: "10px", fontWeight: 600 }}>PACKS</span>
                      ) : (
                        <span style={{ padding: "2px 6px", background: "#f3f4f6", color: "#6b7280", borderRadius: "4px", fontSize: "10px", fontWeight: 600 }}>GUESSES</span>
                      )}
                    </td>
                    <td style={{ textAlign: "center", padding: "8px", borderBottom: "1px solid #f3f4f6" }}>
                      {event.isSmartWallet ? (
                        <span style={{ padding: "2px 6px", background: "#ddd6fe", color: "#7c3aed", borderRadius: "4px", fontSize: "10px", fontWeight: 600 }}>SMART</span>
                      ) : (
                        <span style={{ padding: "2px 6px", background: "#dbeafe", color: "#2563eb", borderRadius: "4px", fontSize: "10px", fontWeight: 600 }}>DIRECT</span>
                      )}
                    </td>
                    <td style={{ padding: "8px", borderBottom: "1px solid #f3f4f6" }}>
                      <a
                        href={`https://basescan.org/tx/${event.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "#6366f1", textDecoration: "none", fontFamily: "monospace", fontSize: "11px" }}
                      >
                        {event.txHash.slice(0, 8)}...
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {purchaseEvents.events.length > 50 && (
              <div style={{ marginTop: "8px", fontSize: "11px", color: "#9ca3af" }}>
                Showing first 50 of {purchaseEvents.events.length} events
              </div>
            )}
          </div>
        )}
        {purchaseEvents && purchaseEvents.events.length === 0 && (
          <div style={{ padding: "24px", textAlign: "center", color: "#9ca3af", fontSize: "13px" }}>
            No purchase events found in the queried block range.
          </div>
        )}
      </Module>
    </>
  )
}

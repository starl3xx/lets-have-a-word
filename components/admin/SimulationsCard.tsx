/**
 * Adversarial Simulations — moved from Analytics to Operations (Phase D):
 * these POST buttons run anti-abuse checks, which is operations work.
 */

import React, { useState } from 'react'
import { Module } from './ui'

const fontFamily = "'Söhne', 'SF Pro Display', system-ui, -apple-system, sans-serif"

const localStyles = {
  grid: {
    display: 'grid' as const,
    gap: '12px',
  },
}

interface SimulationResult {
  simulationId: string
  type: string
  status: 'success' | 'warning' | 'critical' | 'error'
  summary: string
  executionTimeMs?: number
  result?: { status: string; summary: string }
}

export default function SimulationsCard({ fid }: { fid: number }) {
  const [simulationResults, setSimulationResults] = useState<SimulationResult[]>([])
  const [runningSimulation, setRunningSimulation] = useState<string | null>(null)

  // Run simulation function
  const runSimulation = async (type: string) => {
    if (!fid) return
    setRunningSimulation(type)

    try {
      const response = await fetch(`/api/admin/analytics/simulations?devFid=${fid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      })

      if (response.ok) {
        const result = await response.json()
        setSimulationResults(prev => [result, ...prev.slice(0, 9)])
      }
    } catch (err) {
      console.error('Simulation failed:', err)
    } finally {
      setRunningSimulation(null)
    }
  }

  return (
    <>
      <Module title="Adversarial Simulations">
        <div style={{ ...localStyles.grid, gridTemplateColumns: "repeat(5, 1fr)", marginBottom: "16px" }}>
          <button
            onClick={() => runSimulation('wallet_clustering')}
            disabled={runningSimulation !== null}
            style={{
              padding: "12px 16px",
              background: runningSimulation === 'wallet_clustering' ? "#d1d5db" : "#3b82f6",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: runningSimulation ? "not-allowed" : "pointer",
              fontSize: "13px",
              fontWeight: 500,
              fontFamily,
            }}
          >
            {runningSimulation === 'wallet_clustering' ? 'Running...' : 'Wallet Clustering'}
          </button>
          <button
            onClick={() => runSimulation('rapid_winner')}
            disabled={runningSimulation !== null}
            style={{
              padding: "12px 16px",
              background: runningSimulation === 'rapid_winner' ? "#d1d5db" : "#8b5cf6",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: runningSimulation ? "not-allowed" : "pointer",
              fontSize: "13px",
              fontWeight: 500,
              fontFamily,
            }}
          >
            {runningSimulation === 'rapid_winner' ? 'Running...' : 'Rapid Winner'}
          </button>
          <button
            onClick={() => runSimulation('frontrun_risk')}
            disabled={runningSimulation !== null}
            style={{
              padding: "12px 16px",
              background: runningSimulation === 'frontrun_risk' ? "#d1d5db" : "#f59e0b",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: runningSimulation ? "not-allowed" : "pointer",
              fontSize: "13px",
              fontWeight: 500,
              fontFamily,
            }}
          >
            {runningSimulation === 'frontrun_risk' ? 'Running...' : 'Front-Run Risk'}
          </button>
          <button
            onClick={() => runSimulation('jackpot_runway')}
            disabled={runningSimulation !== null}
            style={{
              padding: "12px 16px",
              background: runningSimulation === 'jackpot_runway' ? "#d1d5db" : "#10b981",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: runningSimulation ? "not-allowed" : "pointer",
              fontSize: "13px",
              fontWeight: 500,
              fontFamily,
            }}
          >
            {runningSimulation === 'jackpot_runway' ? 'Running...' : 'Jackpot Runway'}
          </button>
          <button
            onClick={() => runSimulation('full_suite')}
            disabled={runningSimulation !== null}
            style={{
              padding: "12px 16px",
              background: runningSimulation === 'full_suite' ? "#d1d5db" : "#ef4444",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: runningSimulation ? "not-allowed" : "pointer",
              fontSize: "13px",
              fontWeight: 500,
              fontFamily,
            }}
          >
            {runningSimulation === 'full_suite' ? 'Running...' : 'Full Suite'}
          </button>
        </div>

        {/* Simulation Results */}
        {simulationResults.length > 0 && (
          <div style={{ marginTop: "16px" }}>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "12px", fontFamily }}>Recent Results</div>
            {simulationResults.map((result, idx) => (
              <div key={idx} style={{
                padding: "12px",
                background: result.result?.status === 'critical' ? '#fecaca' :
                  result.result?.status === 'warning' ? '#fef3c7' :
                  result.result?.status === 'error' ? '#fee2e2' : '#d1fae5',
                borderRadius: "8px",
                marginBottom: "8px",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong style={{ fontSize: "13px", fontFamily }}>{result.type}</strong>
                  <span style={{
                    padding: "2px 8px",
                    borderRadius: "4px",
                    fontSize: "11px",
                    fontWeight: 600,
                    background: result.result?.status === 'critical' ? '#ef4444' :
                      result.result?.status === 'warning' ? '#f59e0b' :
                      result.result?.status === 'error' ? '#ef4444' : '#10b981',
                    color: "white",
                  }}>
                    {result.result?.status?.toUpperCase() || 'UNKNOWN'}
                  </span>
                </div>
                <div style={{ fontSize: "12px", marginTop: "8px", color: "#4b5563", fontFamily }}>
                  {result.result?.summary || 'No summary available'}
                </div>
                {result.executionTimeMs && (
                  <div style={{ fontSize: "11px", marginTop: "4px", color: "#9ca3af", fontFamily }}>
                    Completed in {result.executionTimeMs}ms
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Module>
    </>
  )
}

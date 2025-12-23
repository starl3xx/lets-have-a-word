/**
 * Economics Section Component
 * High-level operator-friendly view of game economics health
 *
 * Sections:
 * A) Health Overview Scorecard
 * B) Pack Pricing & Purchase Behavior
 * C) Top-10 Cutoff Diagnostics (750 analysis)
 * D) Pool Split & Referral Analysis
 * E) Guidance Recommendations
 */

import React, { useState, useEffect, useCallback } from "react"

// =============================================================================
// Types
// =============================================================================

interface EconomicsSectionProps {
  user?: {
    fid: number
    username: string
    display_name?: string
    pfp_url?: string
  }
}

interface EconomicsData {
  healthOverview: {
    paidParticipation: {
      rate: number
      trend: 'up' | 'down' | 'stable'
      descriptor: string
    }
    prizePoolVelocity: {
      ethPer100Guesses: number
      descriptor: string
    }
    pricingPhaseEffectiveness: {
      earlyPct: number
      latePct: number
      lateMaxPct: number
      descriptor: string
    }
    top10IncentiveStrength: {
      poolPct: number
      descriptor: string
    }
  }
  packPricing: {
    byPhase: {
      early: { count: number; ethTotal: number; avgGuessIndex: number }
      late: { count: number; ethTotal: number; avgGuessIndex: number }
      lateMax: { count: number; ethTotal: number; avgGuessIndex: number }
    }
    purchasesByInterval: Array<{
      intervalStart: number
      intervalEnd: number
      packCount: number
      ethTotal: number
    }>
  }
  cutoffDiagnostics: {
    roundLengthDistribution: {
      median: number
      p25: number
      p75: number
      min: number
      max: number
    }
    roundsEndingBefore750Pct: number
    packsPurchasedBefore750Pct: number
    avgGuessesAtRank10Lock: number | null
  }
  poolSplit: {
    roundsWithReferrerPct: number
    fallbackFrequencyPct: number
    ethDistribution: {
      toWinner: number
      toTop10: number
      toReferrals: number
      toNextRoundSeed: number
    }
    examplePayout: {
      poolSize: number
      winner: number
      top10Total: number
      referrer: number
    } | null
  }
  guidance: Array<{
    condition: string
    recommendation: string
    severity: 'info' | 'warning' | 'action'
  }>
  dataRange: {
    roundCount: number
    oldestRound: string | null
    newestRound: string | null
  }
  timestamp: string
}

// =============================================================================
// Styling
// =============================================================================

const fontFamily = "'Söhne', 'SF Pro Display', system-ui, -apple-system, sans-serif"

const styles = {
  section: {
    background: "white",
    borderRadius: "12px",
    border: "1px solid #e5e7eb",
    padding: "20px",
    marginBottom: "20px",
  },
  sectionTitle: {
    fontSize: "15px",
    fontWeight: 600,
    color: "#111827",
    marginBottom: "16px",
    fontFamily,
    display: "flex" as const,
    alignItems: "center" as const,
    gap: "8px",
  },
  scorecard: {
    display: "grid" as const,
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "16px",
  },
  scorecardTile: {
    padding: "16px",
    background: "#f9fafb",
    borderRadius: "10px",
    border: "1px solid #e5e7eb",
  },
  tileLabel: {
    fontSize: "11px",
    fontWeight: 600,
    color: "#6b7280",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    marginBottom: "8px",
    fontFamily,
  },
  tileValue: {
    fontSize: "28px",
    fontWeight: 700,
    color: "#111827",
    fontFamily,
    lineHeight: 1,
  },
  tileDescriptor: (type: string) => ({
    display: "inline-block",
    marginTop: "8px",
    padding: "3px 8px",
    borderRadius: "4px",
    fontSize: "11px",
    fontWeight: 600,
    fontFamily,
    background: type === 'Healthy' || type === 'Strong' || type === 'Strong growth' ? "#dcfce7" :
                type === 'Low' || type === 'Weak' || type === 'Slow' ? "#fef3c7" :
                "#f3f4f6",
    color: type === 'Healthy' || type === 'Strong' || type === 'Strong growth' ? "#166534" :
           type === 'Low' || type === 'Weak' || type === 'Slow' ? "#92400e" :
           "#374151",
  }),
  tileSubtext: {
    fontSize: "12px",
    color: "#6b7280",
    marginTop: "6px",
    fontFamily,
  },
  chartContainer: {
    marginTop: "16px",
  },
  barChart: {
    display: "flex" as const,
    alignItems: "flex-end" as const,
    gap: "4px",
    height: "120px",
    padding: "0 4px",
  },
  statRow: {
    display: "flex" as const,
    justifyContent: "space-between" as const,
    padding: "10px 0",
    borderBottom: "1px solid #f3f4f6",
    fontSize: "14px",
    fontFamily,
  },
  statLabel: {
    color: "#6b7280",
  },
  statValue: {
    fontWeight: 600,
    color: "#111827",
  },
  guidanceCard: (severity: string) => ({
    padding: "14px 16px",
    borderRadius: "8px",
    marginBottom: "12px",
    background: severity === 'action' ? "#fef2f2" :
                severity === 'warning' ? "#fffbeb" :
                "#f0fdf4",
    borderLeft: `4px solid ${
      severity === 'action' ? "#dc2626" :
      severity === 'warning' ? "#f59e0b" :
      "#22c55e"
    }`,
  }),
  guidanceCondition: {
    fontSize: "13px",
    fontWeight: 600,
    color: "#111827",
    marginBottom: "4px",
    fontFamily,
  },
  guidanceRecommendation: {
    fontSize: "13px",
    color: "#6b7280",
    fontFamily,
  },
  loading: {
    textAlign: "center" as const,
    padding: "48px",
    color: "#6b7280",
    fontFamily,
  },
  error: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: "8px",
    padding: "16px",
    color: "#dc2626",
    marginBottom: "24px",
    fontFamily,
  },
  legend: {
    display: "flex" as const,
    gap: "16px",
    marginTop: "12px",
    fontSize: "12px",
    color: "#6b7280",
    fontFamily,
  },
  legendItem: {
    display: "flex" as const,
    alignItems: "center" as const,
    gap: "6px",
  },
  legendDot: (color: string) => ({
    width: "10px",
    height: "10px",
    borderRadius: "2px",
    background: color,
  }),
  phaseBar: {
    display: "flex" as const,
    height: "32px",
    borderRadius: "6px",
    overflow: "hidden" as const,
    marginTop: "12px",
  },
  distributionBar: {
    display: "flex" as const,
    height: "24px",
    borderRadius: "4px",
    overflow: "hidden" as const,
    marginTop: "8px",
  },
  infoText: {
    fontSize: "12px",
    color: "#9ca3af",
    marginTop: "8px",
    fontStyle: "italic" as const,
    fontFamily,
  },
  dataRangeText: {
    fontSize: "11px",
    color: "#9ca3af",
    marginBottom: "20px",
    fontFamily,
  },
}

// =============================================================================
// Simple Bar Chart Component (SVG)
// =============================================================================

function SimpleBarChart({
  data,
  maxValue,
  color = "#6366f1",
  cutoffLine,
}: {
  data: Array<{ label: string; value: number }>
  maxValue: number
  color?: string
  cutoffLine?: number
}) {
  const barWidth = 100 / Math.max(data.length, 1)
  const height = 120
  const maxBarHeight = height - 20

  return (
    <svg width="100%" height={height} style={{ display: "block" }}>
      {/* Cutoff line if specified */}
      {cutoffLine !== undefined && maxValue > 0 && (
        <>
          <line
            x1={`${(cutoffLine / (data.length > 0 ? data[data.length - 1].value : 1)) * 100}%`}
            y1="0"
            x2={`${(cutoffLine / (data.length > 0 ? data[data.length - 1].value : 1)) * 100}%`}
            y2={height - 20}
            stroke="#dc2626"
            strokeWidth="2"
            strokeDasharray="4,4"
          />
          <text
            x={`${(cutoffLine / (data.length > 0 ? data[data.length - 1].value : 1)) * 100}%`}
            y="10"
            fill="#dc2626"
            fontSize="10"
            textAnchor="middle"
          >
            750
          </text>
        </>
      )}

      {data.map((item, i) => {
        const barHeight = maxValue > 0 ? (item.value / maxValue) * maxBarHeight : 0
        const x = i * barWidth

        return (
          <g key={i}>
            <rect
              x={`${x + barWidth * 0.1}%`}
              y={height - 20 - barHeight}
              width={`${barWidth * 0.8}%`}
              height={barHeight}
              fill={color}
              rx="2"
            />
            <text
              x={`${x + barWidth * 0.5}%`}
              y={height - 5}
              fill="#6b7280"
              fontSize="9"
              textAnchor="middle"
            >
              {item.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// =============================================================================
// Horizontal Stacked Bar Component
// =============================================================================

function StackedBar({
  segments,
  height = 32,
}: {
  segments: Array<{ value: number; color: string; label: string }>
  height?: number
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  if (total === 0) {
    return (
      <div style={{ ...styles.phaseBar, height, background: "#f3f4f6" }}>
        <div style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af", fontSize: "12px" }}>
          No data
        </div>
      </div>
    )
  }

  return (
    <div style={{ ...styles.phaseBar, height }}>
      {segments.map((seg, i) => {
        const pct = (seg.value / total) * 100
        if (pct < 1) return null
        return (
          <div
            key={i}
            style={{
              width: `${pct}%`,
              background: seg.color,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              fontSize: "11px",
              fontWeight: 600,
              minWidth: pct > 10 ? "auto" : "0",
              overflow: "hidden",
            }}
            title={`${seg.label}: ${Math.round(pct)}%`}
          >
            {pct > 15 && `${Math.round(pct)}%`}
          </div>
        )
      })}
    </div>
  )
}

// =============================================================================
// Main Component
// =============================================================================

export default function EconomicsSection({ user }: EconomicsSectionProps) {
  const [data, setData] = useState<EconomicsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (!user?.fid) return

    try {
      setLoading(true)
      setError(null)

      const res = await fetch(`/api/admin/analytics/economics?devFid=${user.fid}`)
      if (!res.ok) {
        throw new Error('Failed to fetch economics data')
      }

      const result = await res.json()
      setData(result)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [user?.fid])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  if (loading && !data) {
    return <div style={styles.loading}>Loading economics data...</div>
  }

  if (error) {
    return <div style={styles.error}>{error}</div>
  }

  if (!data) {
    return <div style={styles.loading}>No data available</div>
  }

  const { healthOverview, packPricing, cutoffDiagnostics, poolSplit, guidance, dataRange } = data

  // Prepare chart data for purchases by interval
  const intervalData = packPricing.purchasesByInterval.map(p => ({
    label: p.intervalStart >= 1000 ? `${p.intervalStart / 1000}k` : String(p.intervalStart),
    value: p.packCount,
  }))
  const maxInterval = Math.max(...intervalData.map(d => d.value), 1)

  return (
    <div>
      {/* Data Range Info */}
      <div style={styles.dataRangeText}>
        Based on {dataRange.roundCount} rounds
        {dataRange.oldestRound && dataRange.newestRound && (
          <> from {new Date(dataRange.oldestRound).toLocaleDateString()} to {new Date(dataRange.newestRound).toLocaleDateString()}</>
        )}
      </div>

      {/* A) Health Overview Scorecard */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>
          <span>📊</span> Economics Health Overview
        </h3>
        <div style={styles.scorecard}>
          {/* Paid Participation */}
          <div style={styles.scorecardTile}>
            <div style={styles.tileLabel}>Paid Participation</div>
            <div style={styles.tileValue}>{healthOverview.paidParticipation.rate}%</div>
            <div style={styles.tileDescriptor(healthOverview.paidParticipation.descriptor)}>
              {healthOverview.paidParticipation.descriptor}
            </div>
            <div style={styles.tileSubtext}>% of guesses that are paid</div>
          </div>

          {/* Prize Pool Velocity */}
          <div style={styles.scorecardTile}>
            <div style={styles.tileLabel}>Pool Velocity</div>
            <div style={styles.tileValue}>{healthOverview.prizePoolVelocity.ethPer100Guesses.toFixed(4)}</div>
            <div style={styles.tileDescriptor(healthOverview.prizePoolVelocity.descriptor)}>
              {healthOverview.prizePoolVelocity.descriptor}
            </div>
            <div style={styles.tileSubtext}>ETH added per 100 guesses</div>
          </div>

          {/* Pricing Phase Effectiveness */}
          <div style={styles.scorecardTile}>
            <div style={styles.tileLabel}>Pricing Distribution</div>
            <div style={styles.tileValue}>{healthOverview.pricingPhaseEffectiveness.earlyPct}%</div>
            <div style={styles.tileDescriptor(healthOverview.pricingPhaseEffectiveness.descriptor)}>
              {healthOverview.pricingPhaseEffectiveness.descriptor}
            </div>
            <div style={styles.tileSubtext}>purchased at early pricing</div>
          </div>

          {/* Top-10 Incentive Strength */}
          <div style={styles.scorecardTile}>
            <div style={styles.tileLabel}>Top-10 Pool ROI</div>
            <div style={styles.tileValue}>{healthOverview.top10IncentiveStrength.poolPct}%</div>
            <div style={styles.tileDescriptor(healthOverview.top10IncentiveStrength.descriptor)}>
              {healthOverview.top10IncentiveStrength.descriptor}
            </div>
            <div style={styles.tileSubtext}>of paid ETH goes to Top-10</div>
          </div>
        </div>
      </div>

      {/* B) Pack Pricing & Purchase Behavior */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>
          <span>📦</span> Pack Pricing & Purchase Behavior
        </h3>

        {/* Phase breakdown bar */}
        <div style={{ marginBottom: "20px" }}>
          <div style={{ fontSize: "13px", fontWeight: 500, color: "#374151", marginBottom: "8px" }}>
            Packs by Pricing Phase
          </div>
          <StackedBar
            segments={[
              { value: packPricing.byPhase.early.count, color: "#22c55e", label: "Early (0-749)" },
              { value: packPricing.byPhase.late.count, color: "#f59e0b", label: "Late (750-1249)" },
              { value: packPricing.byPhase.lateMax.count, color: "#ef4444", label: "Late Max (1250+)" },
            ]}
          />
          <div style={styles.legend}>
            <div style={styles.legendItem}>
              <div style={styles.legendDot("#22c55e")} />
              <span>Early: {packPricing.byPhase.early.count} packs ({packPricing.byPhase.early.ethTotal.toFixed(4)} ETH)</span>
            </div>
            <div style={styles.legendItem}>
              <div style={styles.legendDot("#f59e0b")} />
              <span>Late: {packPricing.byPhase.late.count} packs ({packPricing.byPhase.late.ethTotal.toFixed(4)} ETH)</span>
            </div>
            <div style={styles.legendItem}>
              <div style={styles.legendDot("#ef4444")} />
              <span>Late Max: {packPricing.byPhase.lateMax.count} packs ({packPricing.byPhase.lateMax.ethTotal.toFixed(4)} ETH)</span>
            </div>
          </div>
        </div>

        {/* Purchases by guess interval */}
        <div>
          <div style={{ fontSize: "13px", fontWeight: 500, color: "#374151", marginBottom: "8px" }}>
            Purchases by Round Progress (guess count intervals)
          </div>
          {intervalData.length > 0 ? (
            <SimpleBarChart
              data={intervalData}
              maxValue={maxInterval}
              color="#6366f1"
            />
          ) : (
            <div style={{ padding: "24px", textAlign: "center", color: "#9ca3af", fontSize: "13px" }}>
              No purchase data available
            </div>
          )}
          <div style={styles.infoText}>
            Shows when users buy packs relative to round progress. Higher bars early = strong early incentives.
          </div>
        </div>
      </div>

      {/* C) Top-10 Cutoff Diagnostics (750 analysis) */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>
          <span>🎯</span> 750 Cutoff Diagnostics
        </h3>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
          {/* Round Length Stats */}
          <div>
            <div style={{ fontSize: "13px", fontWeight: 500, color: "#374151", marginBottom: "12px" }}>
              Round Length Distribution
            </div>
            <div style={styles.statRow}>
              <span style={styles.statLabel}>Median</span>
              <span style={styles.statValue}>{cutoffDiagnostics.roundLengthDistribution.median} guesses</span>
            </div>
            <div style={styles.statRow}>
              <span style={styles.statLabel}>25th percentile</span>
              <span style={styles.statValue}>{cutoffDiagnostics.roundLengthDistribution.p25} guesses</span>
            </div>
            <div style={styles.statRow}>
              <span style={styles.statLabel}>75th percentile</span>
              <span style={styles.statValue}>{cutoffDiagnostics.roundLengthDistribution.p75} guesses</span>
            </div>
            <div style={styles.statRow}>
              <span style={styles.statLabel}>Range</span>
              <span style={styles.statValue}>
                {cutoffDiagnostics.roundLengthDistribution.min} - {cutoffDiagnostics.roundLengthDistribution.max}
              </span>
            </div>
          </div>

          {/* Cutoff Impact */}
          <div>
            <div style={{ fontSize: "13px", fontWeight: 500, color: "#374151", marginBottom: "12px" }}>
              750 Cutoff Impact
            </div>
            <div style={styles.statRow}>
              <span style={styles.statLabel}>Rounds ending before 750</span>
              <span style={{
                ...styles.statValue,
                color: cutoffDiagnostics.roundsEndingBefore750Pct > 70 ? "#dc2626" :
                       cutoffDiagnostics.roundsEndingBefore750Pct > 50 ? "#f59e0b" : "#22c55e"
              }}>
                {cutoffDiagnostics.roundsEndingBefore750Pct}%
              </span>
            </div>
            <div style={styles.statRow}>
              <span style={styles.statLabel}>Packs purchased before 750</span>
              <span style={styles.statValue}>{cutoffDiagnostics.packsPurchasedBefore750Pct}%</span>
            </div>
            <div style={styles.infoText}>
              If most rounds end before 750, the late pricing tiers rarely activate.
              Consider lowering the cutoff if &gt;70% of rounds end early.
            </div>
          </div>
        </div>
      </div>

      {/* D) Pool Split & Referral Analysis */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>
          <span>💰</span> Pool Split & Referral Sanity (80/10/10)
        </h3>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
          {/* Referral Stats */}
          <div>
            <div style={{ fontSize: "13px", fontWeight: 500, color: "#374151", marginBottom: "12px" }}>
              Referral Effectiveness
            </div>
            <div style={styles.statRow}>
              <span style={styles.statLabel}>Winners with referrer</span>
              <span style={{
                ...styles.statValue,
                color: poolSplit.roundsWithReferrerPct < 20 ? "#dc2626" : "#22c55e"
              }}>
                {poolSplit.roundsWithReferrerPct}%
              </span>
            </div>
            <div style={styles.statRow}>
              <span style={styles.statLabel}>Fallback behavior</span>
              <span style={styles.statValue}>{poolSplit.fallbackFrequencyPct}%</span>
            </div>
            <div style={styles.infoText}>
              When no referrer exists, the 10% referral share is redistributed (17.5% to Top-10, 2.5% to seed).
            </div>
          </div>

          {/* ETH Distribution */}
          <div>
            <div style={{ fontSize: "13px", fontWeight: 500, color: "#374151", marginBottom: "12px" }}>
              Total ETH Routed (Last 30 Days)
            </div>
            <div style={styles.statRow}>
              <span style={styles.statLabel}>To winners (80%)</span>
              <span style={styles.statValue}>{poolSplit.ethDistribution.toWinner.toFixed(4)} ETH</span>
            </div>
            <div style={styles.statRow}>
              <span style={styles.statLabel}>To Top-10 (10%)</span>
              <span style={styles.statValue}>{poolSplit.ethDistribution.toTop10.toFixed(4)} ETH</span>
            </div>
            <div style={styles.statRow}>
              <span style={styles.statLabel}>To referrers</span>
              <span style={styles.statValue}>{poolSplit.ethDistribution.toReferrals.toFixed(4)} ETH</span>
            </div>
            <div style={styles.statRow}>
              <span style={styles.statLabel}>To next-round seed</span>
              <span style={styles.statValue}>{poolSplit.ethDistribution.toNextRoundSeed.toFixed(4)} ETH</span>
            </div>
          </div>
        </div>

        {/* Example Payout */}
        {poolSplit.examplePayout && (
          <div style={{
            marginTop: "20px",
            padding: "16px",
            background: "#f0fdf4",
            borderRadius: "8px",
            border: "1px solid #bbf7d0",
          }}>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "#166534", marginBottom: "8px" }}>
              Example Payout at Median Pool ({poolSplit.examplePayout.poolSize.toFixed(4)} ETH)
            </div>
            <div style={{ display: "flex", gap: "24px", fontSize: "13px", color: "#166534" }}>
              <span>Winner: {poolSplit.examplePayout.winner.toFixed(4)} ETH</span>
              <span>Top-10 Total: {poolSplit.examplePayout.top10Total.toFixed(4)} ETH</span>
              <span>Referrer: {poolSplit.examplePayout.referrer.toFixed(4)} ETH</span>
            </div>
          </div>
        )}
      </div>

      {/* E) Guidance Recommendations */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>
          <span>💡</span> What Should I Consider?
        </h3>

        {guidance.length === 0 ? (
          <div style={{ padding: "24px", textAlign: "center", color: "#22c55e", fontSize: "14px" }}>
            All metrics look healthy. No immediate action needed.
          </div>
        ) : (
          guidance.map((item, i) => (
            <div key={i} style={styles.guidanceCard(item.severity)}>
              <div style={styles.guidanceCondition}>{item.condition}</div>
              <div style={styles.guidanceRecommendation}>{item.recommendation}</div>
            </div>
          ))
        )}

        <div style={styles.infoText}>
          These are suggestions based on current metrics. Always consider context before making changes.
        </div>
      </div>
    </div>
  )
}

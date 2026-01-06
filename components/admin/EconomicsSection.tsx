/**
 * Economics Section Component
 * Milestone 9.6: Enhanced with targets, growth curves, and comparison mode
 *
 * Sections:
 * A) Health Overview Scorecard (with vs-target evaluation)
 * B) Prize Pool Growth Curve
 * C) Pack Pricing & Purchase Behavior
 * D) Top-10 Cutoff Diagnostics (750 analysis)
 * E) Pool Split & Referral Analysis
 * F) Comparison Mode
 * G) Guidance Recommendations
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

interface TargetEvaluation {
  value: number
  status: 'below' | 'within' | 'above'
  delta: string | null
  target: { min: number; max: number }
}

interface GrowthCurvePoint {
  guessIndex: number
  median: number
  p25: number
  p75: number
}

interface ComparisonMetrics {
  paidParticipation: number
  ethPer100Guesses: number
  packsBefore750Pct: number
  roundsEndingBefore750Pct: number
  roundCount: number
}

interface EconomicsConfigData {
  top10CutoffGuesses: number
  pricing: {
    basePrice: string
    priceRampStart: number
    priceStepGuesses: number
    priceStepIncrease: string
    maxPrice: string
  }
  poolSplit: {
    winnerPct: number
    top10Pct: number
    referrerPct: number
    seedPct: number
    creatorPct: number
    fallbackTop10Pct: number
    fallbackSeedPct: number
  }
}

interface EconomicsData {
  healthOverview: {
    paidParticipation: {
      rate: number
      trend: 'up' | 'down' | 'stable'
      descriptor: string
      target: TargetEvaluation
    }
    prizePoolVelocity: {
      ethPer100Guesses: number
      descriptor: string
      target: TargetEvaluation
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
    roundsEndingBefore750Target: TargetEvaluation
    packsPurchasedBefore750Pct: number
    packsBefore750Target: TargetEvaluation
    avgGuessesAtRank10Lock: number | null
  }
  poolSplit: {
    roundsWithReferrerPct: number
    referrerTarget: TargetEvaluation
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
  growthCurve: {
    points: GrowthCurvePoint[]
    interpretation: string
  }
  currentConfig: EconomicsConfigData | null
  configChange: {
    detected: boolean
    changeRoundId: number | null
    changeDate: string | null
    previousConfig: EconomicsConfigData | null
  } | null
  comparison: {
    mode: 'recent_vs_previous' | 'since_config_change' | null
    recent: ComparisonMetrics
    baseline: ComparisonMetrics
    recentLabel: string
    baselineLabel: string
  } | null
  guidance: Array<{
    condition: string
    recommendation: string
    severity: 'info' | 'warning' | 'action'
  }>
  targets: {
    paidParticipation: { min: number; max: number; unit: string }
    ethPer100Guesses: { min: number; max: number; unit: string }
    roundsEndingBefore750: { min: number; max: number; unit: string }
    packsBefore750: { min: number; max: number; unit: string }
    referrerAttachRate: { min: number; max: number; unit: string }
    medianRoundLength: { min: number; max: number; unit: string }
  }
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
    position: "relative" as const,
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
  targetBadge: (status: 'below' | 'within' | 'above') => ({
    position: "absolute" as const,
    top: "12px",
    right: "12px",
    padding: "2px 6px",
    borderRadius: "4px",
    fontSize: "10px",
    fontWeight: 600,
    fontFamily,
    background: status === 'within' ? "#dcfce7" :
                status === 'below' ? "#fef3c7" :
                "#dbeafe",
    color: status === 'within' ? "#166534" :
           status === 'below' ? "#92400e" :
           "#1e40af",
  }),
  targetDelta: {
    fontSize: "11px",
    color: "#6b7280",
    marginTop: "4px",
    fontFamily,
  },
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
    flexWrap: "wrap" as const,
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
  compareSelect: {
    padding: "8px 12px",
    borderRadius: "6px",
    border: "1px solid #e5e7eb",
    background: "white",
    fontSize: "13px",
    fontFamily,
    cursor: "pointer",
    marginBottom: "16px",
  },
  comparisonGrid: {
    display: "grid" as const,
    gridTemplateColumns: "1fr auto 1fr",
    gap: "16px",
    alignItems: "start" as const,
  },
  comparisonCard: {
    padding: "16px",
    background: "#f9fafb",
    borderRadius: "8px",
    border: "1px solid #e5e7eb",
  },
  comparisonLabel: {
    fontSize: "12px",
    fontWeight: 600,
    color: "#6b7280",
    marginBottom: "12px",
    fontFamily,
  },
  deltaIndicator: (positive: boolean) => ({
    display: "inline-block",
    padding: "2px 6px",
    borderRadius: "4px",
    fontSize: "11px",
    fontWeight: 600,
    marginLeft: "8px",
    background: positive ? "#dcfce7" : "#fef3c7",
    color: positive ? "#166534" : "#92400e",
  }),
  configCard: {
    padding: "12px 16px",
    background: "#f3f4f6",
    borderRadius: "8px",
    fontSize: "12px",
    fontFamily,
    marginTop: "12px",
  },
}

// =============================================================================
// Target Status Badge Component
// =============================================================================

function TargetBadge({ status }: { status: 'below' | 'within' | 'above' }) {
  const labels = {
    below: 'Below target',
    within: 'Within target',
    above: 'Above target',
  }
  return <span style={styles.targetBadge(status)}>{labels[status]}</span>
}

// =============================================================================
// Simple Bar Chart Component (SVG)
// =============================================================================

function SimpleBarChart({
  data,
  maxValue,
  color = "#6366f1",
}: {
  data: Array<{ label: string; value: number }>
  maxValue: number
  color?: string
}) {
  const barWidth = 100 / Math.max(data.length, 1)
  const height = 120
  const maxBarHeight = height - 20

  return (
    <svg width="100%" height={height} style={{ display: "block" }}>
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
// Growth Curve Chart Component (SVG)
// =============================================================================

function GrowthCurveChart({ points }: { points: GrowthCurvePoint[] }) {
  if (points.length === 0) {
    return (
      <div style={{ padding: "24px", textAlign: "center", color: "#9ca3af", fontSize: "13px" }}>
        No growth curve data available
      </div>
    )
  }

  const width = 100
  const height = 140
  const padding = { top: 10, right: 10, bottom: 25, left: 35 }
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom

  const maxGuess = Math.max(...points.map(p => p.guessIndex))
  const maxPool = Math.max(...points.map(p => p.p75), 0.001)

  const xScale = (val: number) => padding.left + (val / maxGuess) * chartWidth
  const yScale = (val: number) => padding.top + chartHeight - (val / maxPool) * chartHeight

  // Build path strings
  const medianPath = points.map((p, i) =>
    `${i === 0 ? 'M' : 'L'} ${xScale(p.guessIndex)} ${yScale(p.median)}`
  ).join(' ')

  // Area path for p25-p75 envelope
  const areaPath = [
    ...points.map((p, i) =>
      `${i === 0 ? 'M' : 'L'} ${xScale(p.guessIndex)} ${yScale(p.p75)}`
    ),
    ...points.slice().reverse().map((p, i) =>
      `L ${xScale(p.guessIndex)} ${yScale(p.p25)}`
    ),
    'Z'
  ].join(' ')

  // Y-axis labels
  const yLabels = [0, maxPool / 2, maxPool].map(val => ({
    value: val,
    label: val.toFixed(4),
    y: yScale(val),
  }))

  // X-axis labels (every 300 guesses)
  const xLabels = points.filter(p => p.guessIndex % 300 === 0 || p.guessIndex === 750)

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ display: "block" }}
    >
      {/* Grid lines */}
      <line
        x1={padding.left}
        y1={padding.top}
        x2={padding.left}
        y2={padding.top + chartHeight}
        stroke="#e5e7eb"
        strokeWidth="1"
      />
      <line
        x1={padding.left}
        y1={padding.top + chartHeight}
        x2={padding.left + chartWidth}
        y2={padding.top + chartHeight}
        stroke="#e5e7eb"
        strokeWidth="1"
      />

      {/* 750 cutoff line */}
      <line
        x1={xScale(750)}
        y1={padding.top}
        x2={xScale(750)}
        y2={padding.top + chartHeight}
        stroke="#dc2626"
        strokeWidth="1"
        strokeDasharray="2,2"
      />
      <text
        x={xScale(750)}
        y={padding.top - 2}
        fill="#dc2626"
        fontSize="3"
        textAnchor="middle"
      >
        750
      </text>

      {/* P25-P75 envelope area */}
      <path
        d={areaPath}
        fill="#6366f1"
        fillOpacity="0.15"
      />

      {/* Median line */}
      <path
        d={medianPath}
        fill="none"
        stroke="#6366f1"
        strokeWidth="1.5"
      />

      {/* Points on median line */}
      {points.filter((_, i) => i % 2 === 0).map((p, i) => (
        <circle
          key={i}
          cx={xScale(p.guessIndex)}
          cy={yScale(p.median)}
          r="2"
          fill="#6366f1"
        />
      ))}

      {/* Y-axis labels */}
      {yLabels.map((label, i) => (
        <text
          key={i}
          x={padding.left - 2}
          y={label.y + 1}
          fill="#6b7280"
          fontSize="3"
          textAnchor="end"
        >
          {label.label}
        </text>
      ))}

      {/* X-axis labels */}
      {xLabels.map((p, i) => (
        <text
          key={i}
          x={xScale(p.guessIndex)}
          y={padding.top + chartHeight + 8}
          fill="#6b7280"
          fontSize="3"
          textAnchor="middle"
        >
          {p.guessIndex}
        </text>
      ))}

      {/* Axis labels */}
      <text
        x={padding.left + chartWidth / 2}
        y={height - 2}
        fill="#9ca3af"
        fontSize="3"
        textAnchor="middle"
      >
        Guess Index
      </text>
      <text
        x={4}
        y={padding.top + chartHeight / 2}
        fill="#9ca3af"
        fontSize="3"
        textAnchor="middle"
        transform={`rotate(-90, 4, ${padding.top + chartHeight / 2})`}
      >
        ETH
      </text>
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
// Comparison Summary Component
// =============================================================================

function ComparisonSummary({
  comparison,
}: {
  comparison: EconomicsData['comparison']
}) {
  if (!comparison) return null

  const { recent, baseline, recentLabel, baselineLabel } = comparison

  const formatDelta = (current: number, previous: number, invert = false) => {
    const delta = current - previous
    if (Math.abs(delta) < 0.01) return null
    const positive = invert ? delta < 0 : delta > 0
    const sign = delta > 0 ? '+' : ''
    return { value: `${sign}${delta.toFixed(1)}`, positive }
  }

  const metrics = [
    { label: 'Paid Participation', recent: recent.paidParticipation, baseline: baseline.paidParticipation, unit: '%' },
    { label: 'ETH/100 Guesses', recent: recent.ethPer100Guesses, baseline: baseline.ethPer100Guesses, unit: '', decimals: 4 },
    { label: 'Rounds <750', recent: recent.roundsEndingBefore750Pct, baseline: baseline.roundsEndingBefore750Pct, unit: '%', invert: true },
  ]

  return (
    <div style={styles.comparisonGrid}>
      {/* Recent period */}
      <div style={styles.comparisonCard}>
        <div style={styles.comparisonLabel}>{recentLabel}</div>
        {metrics.map((m, i) => (
          <div key={i} style={{ ...styles.statRow, padding: "6px 0" }}>
            <span style={styles.statLabel}>{m.label}</span>
            <span style={styles.statValue}>
              {m.decimals ? m.recent.toFixed(m.decimals) : m.recent}{m.unit}
            </span>
          </div>
        ))}
      </div>

      {/* Arrow */}
      <div style={{ display: "flex", alignItems: "center", color: "#9ca3af", fontSize: "20px" }}>
        →
      </div>

      {/* Baseline period with deltas */}
      <div style={styles.comparisonCard}>
        <div style={styles.comparisonLabel}>{baselineLabel}</div>
        {metrics.map((m, i) => {
          const delta = formatDelta(m.recent, m.baseline, m.invert)
          return (
            <div key={i} style={{ ...styles.statRow, padding: "6px 0" }}>
              <span style={styles.statLabel}>{m.label}</span>
              <span style={styles.statValue}>
                {m.decimals ? m.baseline.toFixed(m.decimals) : m.baseline}{m.unit}
                {delta && (
                  <span style={styles.deltaIndicator(delta.positive)}>
                    {delta.value}
                  </span>
                )}
              </span>
            </div>
          )
        })}
      </div>
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
  const [compareMode, setCompareMode] = useState<string>('')

  const fetchData = useCallback(async () => {
    if (!user?.fid) return

    try {
      setLoading(true)
      setError(null)

      const url = compareMode
        ? `/api/admin/analytics/economics?devFid=${user.fid}&compare=${compareMode}`
        : `/api/admin/analytics/economics?devFid=${user.fid}`

      const res = await fetch(url)
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
  }, [user?.fid, compareMode])

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

  const { healthOverview, packPricing, cutoffDiagnostics, poolSplit, growthCurve, guidance, dataRange, comparison, configChange, currentConfig } = data

  // Prepare chart data for purchases by interval
  const intervalData = packPricing.purchasesByInterval.map(p => ({
    label: p.intervalStart >= 1000 ? `${p.intervalStart / 1000}k` : String(p.intervalStart),
    value: p.packCount,
  }))
  const maxInterval = Math.max(...intervalData.map(d => d.value), 1)

  // Build compare options
  const compareOptions = [
    { value: '', label: 'No comparison' },
    { value: 'recent_vs_previous', label: 'Last 10 vs Previous 10 rounds' },
  ]
  if (configChange?.detected) {
    compareOptions.push({ value: 'since_config_change', label: 'Since config change' })
  }

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
            <TargetBadge status={healthOverview.paidParticipation.target.status} />
            <div style={styles.tileLabel}>Paid Participation</div>
            <div style={styles.tileValue}>{healthOverview.paidParticipation.rate}%</div>
            <div style={styles.tileDescriptor(healthOverview.paidParticipation.descriptor)}>
              {healthOverview.paidParticipation.descriptor}
            </div>
            {healthOverview.paidParticipation.target.delta && (
              <div style={styles.targetDelta}>{healthOverview.paidParticipation.target.delta}</div>
            )}
            <div style={styles.tileSubtext}>
              Target: {healthOverview.paidParticipation.target.target.min}-{healthOverview.paidParticipation.target.target.max}%
            </div>
          </div>

          {/* Prize Pool Velocity */}
          <div style={styles.scorecardTile}>
            <TargetBadge status={healthOverview.prizePoolVelocity.target.status} />
            <div style={styles.tileLabel}>Pool Velocity</div>
            <div style={styles.tileValue}>{healthOverview.prizePoolVelocity.ethPer100Guesses.toFixed(4)}</div>
            <div style={styles.tileDescriptor(healthOverview.prizePoolVelocity.descriptor)}>
              {healthOverview.prizePoolVelocity.descriptor}
            </div>
            {healthOverview.prizePoolVelocity.target.delta && (
              <div style={styles.targetDelta}>{healthOverview.prizePoolVelocity.target.delta}</div>
            )}
            <div style={styles.tileSubtext}>ETH per 100 guesses</div>
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

      {/* B) Prize Pool Growth Curve */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>
          <span>📈</span> Prize Pool Growth Curve
        </h3>
        <GrowthCurveChart points={growthCurve.points} />
        <div style={styles.legend}>
          <div style={styles.legendItem}>
            <div style={{ width: "20px", height: "3px", background: "#6366f1", borderRadius: "1px" }} />
            <span>Median</span>
          </div>
          <div style={styles.legendItem}>
            <div style={{ width: "20px", height: "8px", background: "rgba(99, 102, 241, 0.15)", borderRadius: "2px" }} />
            <span>P25–P75 range</span>
          </div>
          <div style={styles.legendItem}>
            <div style={{ width: "20px", height: "2px", background: "#dc2626", borderRadius: "1px", borderStyle: "dashed" }} />
            <span>750 cutoff</span>
          </div>
        </div>
        <div style={styles.infoText}>{growthCurve.interpretation}</div>
      </div>

      {/* C) Pack Pricing & Purchase Behavior */}
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

      {/* D) Top-10 Cutoff Diagnostics (750 analysis) */}
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

          {/* Cutoff Impact with targets */}
          <div>
            <div style={{ fontSize: "13px", fontWeight: 500, color: "#374151", marginBottom: "12px" }}>
              750 Cutoff Impact
            </div>
            <div style={styles.statRow}>
              <span style={styles.statLabel}>
                Rounds ending before 750
                <span style={{ ...styles.targetBadge(cutoffDiagnostics.roundsEndingBefore750Target.status), position: "static", marginLeft: "8px" }}>
                  {cutoffDiagnostics.roundsEndingBefore750Target.status}
                </span>
              </span>
              <span style={{
                ...styles.statValue,
                color: cutoffDiagnostics.roundsEndingBefore750Pct > 60 ? "#dc2626" :
                       cutoffDiagnostics.roundsEndingBefore750Pct > 40 ? "#f59e0b" : "#22c55e"
              }}>
                {cutoffDiagnostics.roundsEndingBefore750Pct}%
              </span>
            </div>
            <div style={styles.statRow}>
              <span style={styles.statLabel}>
                Packs purchased before 750
                <span style={{ ...styles.targetBadge(cutoffDiagnostics.packsBefore750Target.status), position: "static", marginLeft: "8px" }}>
                  {cutoffDiagnostics.packsBefore750Target.status}
                </span>
              </span>
              <span style={styles.statValue}>{cutoffDiagnostics.packsPurchasedBefore750Pct}%</span>
            </div>
            <div style={styles.infoText}>
              Target: {cutoffDiagnostics.roundsEndingBefore750Target.target.min}-{cutoffDiagnostics.roundsEndingBefore750Target.target.max}% of rounds ending before 750
            </div>
          </div>
        </div>
      </div>

      {/* E) Pool Split & Referral Analysis */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>
          <span>💰</span> Pool Split & Referral Sanity (80/10/5/5)
        </h3>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
          {/* Referral Stats with target */}
          <div>
            <div style={{ fontSize: "13px", fontWeight: 500, color: "#374151", marginBottom: "12px" }}>
              Referral Effectiveness
            </div>
            <div style={styles.statRow}>
              <span style={styles.statLabel}>
                Winners with referrer
                <span style={{ ...styles.targetBadge(poolSplit.referrerTarget.status), position: "static", marginLeft: "8px" }}>
                  {poolSplit.referrerTarget.status}
                </span>
              </span>
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
              Target: {poolSplit.referrerTarget.target.min}-{poolSplit.referrerTarget.target.max}% referrer attach rate
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
              <span style={styles.statLabel}>To referrers (5%)</span>
              <span style={styles.statValue}>{poolSplit.ethDistribution.toReferrals.toFixed(4)} ETH</span>
            </div>
            <div style={styles.statRow}>
              <span style={styles.statLabel}>To next-round seed (5%)</span>
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
            <div style={{ display: "flex", gap: "24px", fontSize: "13px", color: "#166534", flexWrap: "wrap" }}>
              <span>Winner: {poolSplit.examplePayout.winner.toFixed(4)} ETH</span>
              <span>Top-10 Total: {poolSplit.examplePayout.top10Total.toFixed(4)} ETH</span>
              <span>Referrer: {poolSplit.examplePayout.referrer.toFixed(4)} ETH</span>
            </div>
          </div>
        )}

        {/* Current Config Snapshot */}
        {currentConfig && (
          <div style={styles.configCard}>
            <div style={{ fontWeight: 600, marginBottom: "8px", color: "#374151" }}>Current Economics Config</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "8px", color: "#6b7280" }}>
              <span>Top-10 cutoff: {currentConfig.top10CutoffGuesses} guesses</span>
              <span>Base price: {currentConfig.pricing.basePrice} ETH</span>
              <span>Max price: {currentConfig.pricing.maxPrice} ETH</span>
              <span>Winner split: {currentConfig.poolSplit.winnerPct}%</span>
            </div>
          </div>
        )}
      </div>

      {/* F) Comparison Mode */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>
          <span>⚖️</span> Compare Periods
        </h3>

        <select
          style={styles.compareSelect}
          value={compareMode}
          onChange={(e) => setCompareMode(e.target.value)}
        >
          {compareOptions.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        {comparison ? (
          <ComparisonSummary comparison={comparison} />
        ) : (
          <div style={{ padding: "24px", textAlign: "center", color: "#9ca3af", fontSize: "13px" }}>
            {compareMode ? 'Not enough data for comparison (need at least 5 rounds)' : 'Select a comparison mode to view period differences'}
          </div>
        )}

        {configChange?.detected && (
          <div style={{
            marginTop: "16px",
            padding: "12px 16px",
            background: "#dbeafe",
            borderRadius: "8px",
            fontSize: "12px",
            color: "#1e40af",
          }}>
            Config change detected at Round #{configChange.changeRoundId}
            {configChange.changeDate && ` (${new Date(configChange.changeDate).toLocaleDateString()})`}
          </div>
        )}
      </div>

      {/* G) Guidance Recommendations */}
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
          These are suggestions based on current metrics and target ranges. Always consider context before making changes.
        </div>
      </div>
    </div>
  )
}

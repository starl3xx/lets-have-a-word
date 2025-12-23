/**
 * Economics Analytics API
 * Milestone 9.6: Enhanced economics dashboard with targets, growth curves, and comparison
 *
 * Features:
 * - Paid participation rates with target evaluation
 * - Prize pool velocity with target evaluation
 * - Prize pool growth curve (median, p25, p75)
 * - Per-round config snapshots
 * - Compare mode for period comparisons
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../../src/db';
import { rounds, guesses, packPurchases, roundEconomicsConfig } from '../../../../src/db/schema';
import type { RoundEconomicsConfigData } from '../../../../src/db/schema';
import { sql, desc, and, gte, isNotNull, count, sum, avg, lt, lte } from 'drizzle-orm';
import { isAdminFid } from '../me';
import { cacheAside, CacheKeys, CacheTTL } from '../../../../src/lib/redis';
import {
  PRICE_RAMP_START_GUESSES,
  PRICE_STEP_GUESSES,
  BASE_PACK_PRICE_WEI,
  PRICE_STEP_INCREASE_WEI,
  MAX_PACK_PRICE_WEI,
  weiToEthString,
} from '../../../../src/lib/pack-pricing';

// =============================================================================
// Target Configuration (static for now)
// =============================================================================

export const ECONOMICS_TARGETS = {
  paidParticipation: { min: 8, max: 25, unit: '%' as const },
  ethPer100Guesses: { min: 0.005, max: 0.02, unit: 'ETH' as const },
  roundsEndingBefore750: { min: 20, max: 60, unit: '%' as const },
  packsBefore750: { min: 40, max: 80, unit: '%' as const },
  referrerAttachRate: { min: 20, max: 60, unit: '%' as const },
  medianRoundLength: { min: 300, max: 1200, unit: 'guesses' as const },
};

type TargetStatus = 'below' | 'within' | 'above';

function evaluateTarget(value: number, target: { min: number; max: number }): TargetStatus {
  if (value < target.min) return 'below';
  if (value > target.max) return 'above';
  return 'within';
}

function formatDelta(value: number, target: { min: number; max: number }): string | null {
  if (value < target.min) {
    return `${(target.min - value).toFixed(1)} below min`;
  }
  if (value > target.max) {
    return `${(value - target.max).toFixed(1)} above max`;
  }
  return null;
}

// =============================================================================
// Types
// =============================================================================

interface TargetEvaluation {
  value: number;
  status: TargetStatus;
  delta: string | null;
  target: { min: number; max: number };
}

interface GrowthCurvePoint {
  guessIndex: number;
  median: number;
  p25: number;
  p75: number;
}

interface ComparisonMetrics {
  paidParticipation: number;
  ethPer100Guesses: number;
  packsBefore750Pct: number;
  roundsEndingBefore750Pct: number;
  roundCount: number;
}

interface EconomicsData {
  // Health overview metrics with target evaluation
  healthOverview: {
    paidParticipation: {
      rate: number;
      trend: 'up' | 'down' | 'stable';
      descriptor: string;
      target: TargetEvaluation;
    };
    prizePoolVelocity: {
      ethPer100Guesses: number;
      descriptor: string;
      target: TargetEvaluation;
    };
    pricingPhaseEffectiveness: {
      earlyPct: number;
      latePct: number;
      lateMaxPct: number;
      descriptor: string;
    };
    top10IncentiveStrength: {
      poolPct: number;
      descriptor: string;
    };
  };

  // Pack pricing behavior
  packPricing: {
    byPhase: {
      early: { count: number; ethTotal: number; avgGuessIndex: number };
      late: { count: number; ethTotal: number; avgGuessIndex: number };
      lateMax: { count: number; ethTotal: number; avgGuessIndex: number };
    };
    purchasesByInterval: Array<{
      intervalStart: number;
      intervalEnd: number;
      packCount: number;
      ethTotal: number;
    }>;
  };

  // 750-cutoff diagnostics with targets
  cutoffDiagnostics: {
    roundLengthDistribution: {
      median: number;
      p25: number;
      p75: number;
      min: number;
      max: number;
    };
    roundsEndingBefore750Pct: number;
    roundsEndingBefore750Target: TargetEvaluation;
    packsPurchasedBefore750Pct: number;
    packsBefore750Target: TargetEvaluation;
    avgGuessesAtRank10Lock: number | null;
  };

  // Pool split analysis
  poolSplit: {
    roundsWithReferrerPct: number;
    referrerTarget: TargetEvaluation;
    fallbackFrequencyPct: number;
    ethDistribution: {
      toWinner: number;
      toTop10: number;
      toReferrals: number;
      toNextRoundSeed: number;
    };
    examplePayout: {
      poolSize: number;
      winner: number;
      top10Total: number;
      referrer: number;
    } | null;
  };

  // Prize pool growth curve
  growthCurve: {
    points: GrowthCurvePoint[];
    interpretation: string;
  };

  // Current economics config snapshot
  currentConfig: RoundEconomicsConfigData | null;

  // Config change detection
  configChange: {
    detected: boolean;
    changeRoundId: number | null;
    changeDate: string | null;
    previousConfig: RoundEconomicsConfigData | null;
  } | null;

  // Comparison data (if requested)
  comparison: {
    mode: 'recent_vs_previous' | 'since_config_change' | null;
    recent: ComparisonMetrics;
    baseline: ComparisonMetrics;
    recentLabel: string;
    baselineLabel: string;
  } | null;

  // Guidance recommendations
  guidance: Array<{
    condition: string;
    recommendation: string;
    severity: 'info' | 'warning' | 'action';
  }>;

  // Metadata
  targets: typeof ECONOMICS_TARGETS;
  dataRange: {
    roundCount: number;
    oldestRound: string | null;
    newestRound: string | null;
  };
  timestamp: string;
}

// =============================================================================
// API Handler
// =============================================================================

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<EconomicsData | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const devFid = req.query.devFid ? parseInt(req.query.devFid as string, 10) : null;
  const compareMode = req.query.compare as string | undefined;

  if (!isAdminFid(devFid)) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    // Use different cache key if comparison is requested
    const cacheKey = compareMode
      ? CacheKeys.adminAnalytics(`economics:${compareMode}`)
      : CacheKeys.adminAnalytics('economics');

    const data = await cacheAside<EconomicsData>(
      cacheKey,
      CacheTTL.adminAnalytics,
      () => computeEconomicsData(compareMode)
    );

    return res.status(200).json(data);
  } catch (error) {
    console.error('Economics API error:', error);
    return res.status(500).json({ error: 'Failed to compute economics data' });
  }
}

// =============================================================================
// Main Computation
// =============================================================================

async function computeEconomicsData(compareMode?: string): Promise<EconomicsData> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Fetch resolved rounds
  const resolvedRounds = await db
    .select({
      id: rounds.id,
      prizePoolEth: rounds.prizePoolEth,
      winnerFid: rounds.winnerFid,
      referrerFid: rounds.referrerFid,
      startedAt: rounds.startedAt,
      resolvedAt: rounds.resolvedAt,
    })
    .from(rounds)
    .where(and(
      isNotNull(rounds.resolvedAt),
      gte(rounds.startedAt, thirtyDaysAgo)
    ))
    .orderBy(desc(rounds.resolvedAt));

  if (resolvedRounds.length === 0) {
    return getEmptyData();
  }

  const roundIds = resolvedRounds.map(r => r.id);
  const roundIdsStr = roundIds.join(',') || '0';

  // Get guess counts and paid/free breakdown per round
  const guessStats = await db
    .select({
      roundId: guesses.roundId,
      totalGuesses: count(),
      paidGuesses: sql<number>`COUNT(*) FILTER (WHERE ${guesses.isPaid} = true)`,
      freeGuesses: sql<number>`COUNT(*) FILTER (WHERE ${guesses.isPaid} = false)`,
    })
    .from(guesses)
    .where(sql`${guesses.roundId} IN (${sql.raw(roundIdsStr)})`)
    .groupBy(guesses.roundId);

  const guessStatsByRound = new Map(guessStats.map(g => [g.roundId, g]));

  // Get pack purchases with phase breakdown
  const packStats = await db
    .select({
      pricingPhase: packPurchases.pricingPhase,
      packCount: sum(packPurchases.packCount),
      totalEth: sum(packPurchases.totalPriceEth),
      avgGuessIndex: avg(packPurchases.totalGuessesAtPurchase),
      purchaseCount: count(),
    })
    .from(packPurchases)
    .where(sql`${packPurchases.roundId} IN (${sql.raw(roundIdsStr)})`)
    .groupBy(packPurchases.pricingPhase);

  // Get purchases by interval
  const purchasesByInterval = await db
    .select({
      bucket: sql<number>`FLOOR(${packPurchases.totalGuessesAtPurchase} / 100) * 100`,
      packCount: sum(packPurchases.packCount),
      totalEth: sum(packPurchases.totalPriceEth),
    })
    .from(packPurchases)
    .where(sql`${packPurchases.roundId} IN (${sql.raw(roundIdsStr)})`)
    .groupBy(sql`FLOOR(${packPurchases.totalGuessesAtPurchase} / 100) * 100`)
    .orderBy(sql`FLOOR(${packPurchases.totalGuessesAtPurchase} / 100) * 100`);

  // Get prize pool progression for growth curve
  const growthCurve = await computeGrowthCurve(roundIds);

  // Get config snapshots for comparison
  const configSnapshots = await db
    .select()
    .from(roundEconomicsConfig)
    .where(sql`${roundEconomicsConfig.roundId} IN (${sql.raw(roundIdsStr)})`)
    .orderBy(desc(roundEconomicsConfig.roundId));

  // Detect config changes
  const configChange = detectConfigChange(configSnapshots);

  // Calculate metrics
  let totalGuesses = 0;
  let totalPaidGuesses = 0;
  const roundLengths: number[] = [];
  const roundData: Array<{ roundId: number; length: number; paidRate: number; poolEth: number }> = [];

  for (const round of resolvedRounds) {
    const stats = guessStatsByRound.get(round.id);
    if (stats) {
      const length = Number(stats.totalGuesses);
      const paid = Number(stats.paidGuesses);
      totalGuesses += length;
      totalPaidGuesses += paid;
      roundLengths.push(length);
      roundData.push({
        roundId: round.id,
        length,
        paidRate: length > 0 ? (paid / length) * 100 : 0,
        poolEth: parseFloat(round.prizePoolEth || '0'),
      });
    }
  }

  const paidRate = totalGuesses > 0 ? (totalPaidGuesses / totalGuesses) * 100 : 0;
  const totalPoolEth = resolvedRounds.reduce((sum, r) => sum + parseFloat(r.prizePoolEth || '0'), 0);
  const ethPer100Guesses = totalGuesses > 0 ? (totalPoolEth / totalGuesses) * 100 : 0;

  // Parse pack stats by phase
  const phaseStats = {
    early: { count: 0, ethTotal: 0, avgGuessIndex: 0 },
    late: { count: 0, ethTotal: 0, avgGuessIndex: 0 },
    lateMax: { count: 0, ethTotal: 0, avgGuessIndex: 0 },
  };

  let totalPacks = 0;
  for (const stat of packStats) {
    const packCount = Number(stat.packCount) || 0;
    const ethTotal = parseFloat(String(stat.totalEth)) || 0;
    const avgIdx = parseFloat(String(stat.avgGuessIndex)) || 0;
    totalPacks += packCount;

    if (stat.pricingPhase === 'BASE') {
      phaseStats.early = { count: packCount, ethTotal, avgGuessIndex: avgIdx };
    } else if (stat.pricingPhase === 'LATE_1') {
      phaseStats.late = { count: packCount, ethTotal, avgGuessIndex: avgIdx };
    } else if (stat.pricingPhase === 'LATE_2') {
      phaseStats.lateMax = { count: packCount, ethTotal, avgGuessIndex: avgIdx };
    }
  }

  const earlyPct = totalPacks > 0 ? (phaseStats.early.count / totalPacks) * 100 : 0;
  const latePct = totalPacks > 0 ? (phaseStats.late.count / totalPacks) * 100 : 0;
  const lateMaxPct = totalPacks > 0 ? (phaseStats.lateMax.count / totalPacks) * 100 : 0;

  // Round length distribution
  roundLengths.sort((a, b) => a - b);
  const median = roundLengths.length > 0 ? roundLengths[Math.floor(roundLengths.length / 2)] : 0;
  const p25 = roundLengths.length > 0 ? roundLengths[Math.floor(roundLengths.length * 0.25)] : 0;
  const p75 = roundLengths.length > 0 ? roundLengths[Math.floor(roundLengths.length * 0.75)] : 0;

  // % of rounds ending before 750
  const roundsEndingBefore750 = roundLengths.filter(l => l < 750).length;
  const roundsEndingBefore750Pct = roundLengths.length > 0
    ? (roundsEndingBefore750 / roundLengths.length) * 100
    : 0;

  // % of packs purchased before 750
  const packsBefore750Pct = totalPacks > 0 ? (phaseStats.early.count / totalPacks) * 100 : 0;

  // Referrer analysis
  const roundsWithReferrer = resolvedRounds.filter(r => r.referrerFid !== null).length;
  const roundsWithReferrerPct = resolvedRounds.length > 0
    ? (roundsWithReferrer / resolvedRounds.length) * 100
    : 0;

  // Calculate ETH distribution
  const totalDistributedEth = totalPoolEth;
  const ethToWinner = totalDistributedEth * 0.8;
  const ethToTop10 = totalDistributedEth * 0.1;
  const ethToReferrals = totalDistributedEth * 0.1 * (roundsWithReferrerPct / 100);
  const ethToSeed = totalDistributedEth * 0.1 * ((100 - roundsWithReferrerPct) / 100) * 0.25;

  // Top-10 pool as % of total paid ETH
  const totalPaidEth = phaseStats.early.ethTotal + phaseStats.late.ethTotal + phaseStats.lateMax.ethTotal;
  const top10PoolPct = totalPaidEth > 0 ? (ethToTop10 / totalPaidEth) * 100 : 0;

  // Example payout at median pool size
  const medianPool = resolvedRounds.length > 0
    ? parseFloat(resolvedRounds[Math.floor(resolvedRounds.length / 2)].prizePoolEth || '0')
    : null;

  // Build target evaluations
  const paidParticipationTarget: TargetEvaluation = {
    value: paidRate,
    status: evaluateTarget(paidRate, ECONOMICS_TARGETS.paidParticipation),
    delta: formatDelta(paidRate, ECONOMICS_TARGETS.paidParticipation),
    target: ECONOMICS_TARGETS.paidParticipation,
  };

  const ethPer100Target: TargetEvaluation = {
    value: ethPer100Guesses,
    status: evaluateTarget(ethPer100Guesses, ECONOMICS_TARGETS.ethPer100Guesses),
    delta: formatDelta(ethPer100Guesses, ECONOMICS_TARGETS.ethPer100Guesses),
    target: ECONOMICS_TARGETS.ethPer100Guesses,
  };

  const roundsEndingTarget: TargetEvaluation = {
    value: roundsEndingBefore750Pct,
    status: evaluateTarget(roundsEndingBefore750Pct, ECONOMICS_TARGETS.roundsEndingBefore750),
    delta: formatDelta(roundsEndingBefore750Pct, ECONOMICS_TARGETS.roundsEndingBefore750),
    target: ECONOMICS_TARGETS.roundsEndingBefore750,
  };

  const packsBefore750Target: TargetEvaluation = {
    value: packsBefore750Pct,
    status: evaluateTarget(packsBefore750Pct, ECONOMICS_TARGETS.packsBefore750),
    delta: formatDelta(packsBefore750Pct, ECONOMICS_TARGETS.packsBefore750),
    target: ECONOMICS_TARGETS.packsBefore750,
  };

  const referrerTarget: TargetEvaluation = {
    value: roundsWithReferrerPct,
    status: evaluateTarget(roundsWithReferrerPct, ECONOMICS_TARGETS.referrerAttachRate),
    delta: formatDelta(roundsWithReferrerPct, ECONOMICS_TARGETS.referrerAttachRate),
    target: ECONOMICS_TARGETS.referrerAttachRate,
  };

  // Generate guidance with target references
  const guidance = generateGuidance({
    paidRate,
    earlyPct,
    roundsEndingBefore750Pct,
    packsBefore750Pct,
    roundsWithReferrerPct,
    ethPer100Guesses,
    median,
    paidParticipationTarget,
    roundsEndingTarget,
    referrerTarget,
    roundData,
  });

  // Format intervals for chart
  const intervals = purchasesByInterval.map(p => ({
    intervalStart: Number(p.bucket),
    intervalEnd: Number(p.bucket) + 100,
    packCount: Number(p.packCount) || 0,
    ethTotal: parseFloat(String(p.totalEth)) || 0,
  }));

  // Get current config snapshot
  const currentConfig = getCurrentEconomicsConfig();

  // Build comparison data if requested
  const comparison = await buildComparisonData(
    compareMode,
    roundData,
    configChange
  );

  return {
    healthOverview: {
      paidParticipation: {
        rate: Math.round(paidRate * 10) / 10,
        trend: 'stable',
        descriptor: paidRate >= 15 ? 'Healthy' : paidRate >= 8 ? 'Moderate' : 'Low',
        target: paidParticipationTarget,
      },
      prizePoolVelocity: {
        ethPer100Guesses: Math.round(ethPer100Guesses * 10000) / 10000,
        descriptor: ethPer100Guesses >= 0.01 ? 'Strong growth' : ethPer100Guesses >= 0.005 ? 'Moderate' : 'Slow',
        target: ethPer100Target,
      },
      pricingPhaseEffectiveness: {
        earlyPct: Math.round(earlyPct),
        latePct: Math.round(latePct),
        lateMaxPct: Math.round(lateMaxPct),
        descriptor: earlyPct >= 50 ? 'Early-heavy' : latePct + lateMaxPct >= 50 ? 'Late-heavy' : 'Balanced',
      },
      top10IncentiveStrength: {
        poolPct: Math.round(top10PoolPct * 10) / 10,
        descriptor: top10PoolPct >= 8 ? 'Strong' : top10PoolPct >= 4 ? 'Moderate' : 'Weak',
      },
    },
    packPricing: {
      byPhase: phaseStats,
      purchasesByInterval: intervals,
    },
    cutoffDiagnostics: {
      roundLengthDistribution: {
        median,
        p25,
        p75,
        min: roundLengths[0] || 0,
        max: roundLengths[roundLengths.length - 1] || 0,
      },
      roundsEndingBefore750Pct: Math.round(roundsEndingBefore750Pct),
      roundsEndingBefore750Target: roundsEndingTarget,
      packsPurchasedBefore750Pct: Math.round(packsBefore750Pct),
      packsBefore750Target: packsBefore750Target,
      avgGuessesAtRank10Lock: null,
    },
    poolSplit: {
      roundsWithReferrerPct: Math.round(roundsWithReferrerPct),
      referrerTarget: referrerTarget,
      fallbackFrequencyPct: Math.round(100 - roundsWithReferrerPct),
      ethDistribution: {
        toWinner: Math.round(ethToWinner * 10000) / 10000,
        toTop10: Math.round(ethToTop10 * 10000) / 10000,
        toReferrals: Math.round(ethToReferrals * 10000) / 10000,
        toNextRoundSeed: Math.round(ethToSeed * 10000) / 10000,
      },
      examplePayout: medianPool !== null ? {
        poolSize: medianPool,
        winner: Math.round(medianPool * 0.8 * 10000) / 10000,
        top10Total: Math.round(medianPool * 0.1 * 10000) / 10000,
        referrer: Math.round(medianPool * 0.1 * 10000) / 10000,
      } : null,
    },
    growthCurve,
    currentConfig,
    configChange,
    comparison,
    guidance,
    targets: ECONOMICS_TARGETS,
    dataRange: {
      roundCount: resolvedRounds.length,
      oldestRound: resolvedRounds.length > 0
        ? resolvedRounds[resolvedRounds.length - 1].startedAt?.toISOString() || null
        : null,
      newestRound: resolvedRounds.length > 0
        ? resolvedRounds[0].startedAt?.toISOString() || null
        : null,
    },
    timestamp: new Date().toISOString(),
  };
}

// =============================================================================
// Growth Curve Computation
// =============================================================================

async function computeGrowthCurve(roundIds: number[]): Promise<{
  points: GrowthCurvePoint[];
  interpretation: string;
}> {
  if (roundIds.length === 0) {
    return { points: [], interpretation: 'No data available' };
  }

  // Get cumulative pool progression by guess index for each round
  // We'll sample at 50-guess intervals up to 1500
  const intervals = [0, 50, 100, 150, 200, 250, 300, 400, 500, 600, 750, 900, 1000, 1200, 1500];

  // Get pack purchases grouped by round and cumulative progress
  const roundIdsStr = roundIds.join(',') || '0';
  const purchaseData = await db
    .select({
      roundId: packPurchases.roundId,
      guessIndex: packPurchases.totalGuessesAtPurchase,
      priceEth: packPurchases.totalPriceEth,
    })
    .from(packPurchases)
    .where(sql`${packPurchases.roundId} IN (${sql.raw(roundIdsStr)})`)
    .orderBy(packPurchases.roundId, packPurchases.totalGuessesAtPurchase);

  // Build cumulative pool by guess index for each round
  const roundPools: Map<number, Map<number, number>> = new Map();

  for (const purchase of purchaseData) {
    if (!roundPools.has(purchase.roundId)) {
      roundPools.set(purchase.roundId, new Map());
    }
    const poolMap = roundPools.get(purchase.roundId)!;

    // Get current cumulative total for this round
    const entries = Array.from(poolMap.entries()).sort((a, b) => b[0] - a[0]);
    const lastCumulative = entries.length > 0 ? entries[0][1] : 0;
    const newCumulative = lastCumulative + parseFloat(purchase.priceEth);

    poolMap.set(purchase.guessIndex, newCumulative);
  }

  // For each interval, collect the pool values across all rounds
  const points: GrowthCurvePoint[] = [];

  for (const interval of intervals) {
    const values: number[] = [];

    for (const [_roundId, poolMap] of roundPools) {
      // Find the cumulative pool at or before this interval
      const entries = Array.from(poolMap.entries())
        .filter(([idx]) => idx <= interval)
        .sort((a, b) => b[0] - a[0]);

      const poolValue = entries.length > 0 ? entries[0][1] : 0;
      values.push(poolValue);
    }

    if (values.length === 0) {
      points.push({ guessIndex: interval, median: 0, p25: 0, p75: 0 });
      continue;
    }

    values.sort((a, b) => a - b);
    const median = values[Math.floor(values.length / 2)];
    const p25 = values[Math.floor(values.length * 0.25)];
    const p75 = values[Math.floor(values.length * 0.75)];

    points.push({
      guessIndex: interval,
      median: Math.round(median * 10000) / 10000,
      p25: Math.round(p25 * 10000) / 10000,
      p75: Math.round(p75 * 10000) / 10000,
    });
  }

  // Generate interpretation
  const earlyGrowth = points.find(p => p.guessIndex === 300)?.median || 0;
  const midGrowth = points.find(p => p.guessIndex === 750)?.median || 0;
  const lateGrowth = points.find(p => p.guessIndex === 1200)?.median || 0;

  let interpretation = '';
  if (earlyGrowth > 0 && midGrowth > 0) {
    const earlyToMidRatio = (midGrowth - earlyGrowth) / earlyGrowth;
    if (earlyToMidRatio > 1) {
      interpretation = 'Growth accelerates after 750 (late-round pricing activates). Strong late-round buying.';
    } else if (earlyToMidRatio > 0.3) {
      interpretation = 'Steady growth throughout rounds. Good balance of early and late buying.';
    } else {
      interpretation = 'Most growth happens early. Late-round pricing may be too aggressive.';
    }
  } else if (points.some(p => p.median > 0)) {
    interpretation = 'Limited purchase data. Growth curve may not be representative.';
  } else {
    interpretation = 'No purchase data available for growth curve analysis.';
  }

  return { points, interpretation };
}

// =============================================================================
// Config Snapshots
// =============================================================================

function getCurrentEconomicsConfig(): RoundEconomicsConfigData {
  return {
    top10CutoffGuesses: 750,
    pricing: {
      basePrice: weiToEthString(BASE_PACK_PRICE_WEI),
      priceRampStart: PRICE_RAMP_START_GUESSES,
      priceStepGuesses: PRICE_STEP_GUESSES,
      priceStepIncrease: weiToEthString(PRICE_STEP_INCREASE_WEI),
      maxPrice: weiToEthString(MAX_PACK_PRICE_WEI),
    },
    poolSplit: {
      winnerPct: 80,
      top10Pct: 10,
      referrerPct: 10,
      seedPct: 0,
      creatorPct: 0,
      fallbackTop10Pct: 17.5,
      fallbackSeedPct: 2.5,
    },
  };
}

function detectConfigChange(
  snapshots: Array<{ roundId: number; config: RoundEconomicsConfigData; createdAt: Date }>
): EconomicsData['configChange'] {
  if (snapshots.length < 2) {
    return { detected: false, changeRoundId: null, changeDate: null, previousConfig: null };
  }

  // Compare adjacent snapshots to find config changes
  for (let i = 0; i < snapshots.length - 1; i++) {
    const current = snapshots[i];
    const previous = snapshots[i + 1];

    // Simple comparison - check if key values differ
    const currentConfig = current.config;
    const previousConfig = previous.config;

    const hasChange =
      currentConfig.top10CutoffGuesses !== previousConfig.top10CutoffGuesses ||
      currentConfig.pricing.priceRampStart !== previousConfig.pricing.priceRampStart ||
      currentConfig.pricing.basePrice !== previousConfig.pricing.basePrice ||
      currentConfig.poolSplit.winnerPct !== previousConfig.poolSplit.winnerPct;

    if (hasChange) {
      return {
        detected: true,
        changeRoundId: current.roundId,
        changeDate: current.createdAt.toISOString(),
        previousConfig: previousConfig,
      };
    }
  }

  return { detected: false, changeRoundId: null, changeDate: null, previousConfig: null };
}

// =============================================================================
// Comparison Mode
// =============================================================================

async function buildComparisonData(
  compareMode: string | undefined,
  roundData: Array<{ roundId: number; length: number; paidRate: number; poolEth: number }>,
  configChange: EconomicsData['configChange']
): Promise<EconomicsData['comparison']> {
  if (!compareMode || roundData.length < 5) {
    return null;
  }

  // Sort rounds by ID (most recent first)
  const sortedRounds = [...roundData].sort((a, b) => b.roundId - a.roundId);

  if (compareMode === 'recent_vs_previous') {
    // Compare last 10 rounds vs previous 10
    const recentRounds = sortedRounds.slice(0, 10);
    const baselineRounds = sortedRounds.slice(10, 20);

    if (baselineRounds.length < 3) {
      return null;
    }

    return {
      mode: 'recent_vs_previous',
      recent: computeComparisonMetrics(recentRounds),
      baseline: computeComparisonMetrics(baselineRounds),
      recentLabel: `Last ${recentRounds.length} rounds`,
      baselineLabel: `Previous ${baselineRounds.length} rounds`,
    };
  }

  if (compareMode === 'since_config_change' && configChange?.detected && configChange.changeRoundId) {
    // Compare rounds after config change vs before
    const afterChange = sortedRounds.filter(r => r.roundId >= configChange.changeRoundId!);
    const beforeChange = sortedRounds.filter(r => r.roundId < configChange.changeRoundId!);

    if (afterChange.length < 3 || beforeChange.length < 3) {
      return null;
    }

    return {
      mode: 'since_config_change',
      recent: computeComparisonMetrics(afterChange),
      baseline: computeComparisonMetrics(beforeChange),
      recentLabel: `Since config change (${afterChange.length} rounds)`,
      baselineLabel: `Before change (${beforeChange.length} rounds)`,
    };
  }

  return null;
}

function computeComparisonMetrics(
  rounds: Array<{ roundId: number; length: number; paidRate: number; poolEth: number }>
): ComparisonMetrics {
  if (rounds.length === 0) {
    return {
      paidParticipation: 0,
      ethPer100Guesses: 0,
      packsBefore750Pct: 0,
      roundsEndingBefore750Pct: 0,
      roundCount: 0,
    };
  }

  const totalGuesses = rounds.reduce((sum, r) => sum + r.length, 0);
  const avgPaidRate = rounds.reduce((sum, r) => sum + r.paidRate, 0) / rounds.length;
  const totalPoolEth = rounds.reduce((sum, r) => sum + r.poolEth, 0);
  const ethPer100 = totalGuesses > 0 ? (totalPoolEth / totalGuesses) * 100 : 0;
  const roundsEndingBefore750 = rounds.filter(r => r.length < 750).length;

  return {
    paidParticipation: Math.round(avgPaidRate * 10) / 10,
    ethPer100Guesses: Math.round(ethPer100 * 10000) / 10000,
    packsBefore750Pct: 0, // Would need pack data per round
    roundsEndingBefore750Pct: Math.round((roundsEndingBefore750 / rounds.length) * 100),
    roundCount: rounds.length,
  };
}

// =============================================================================
// Guidance Generation
// =============================================================================

function generateGuidance(metrics: {
  paidRate: number;
  earlyPct: number;
  roundsEndingBefore750Pct: number;
  packsBefore750Pct: number;
  roundsWithReferrerPct: number;
  ethPer100Guesses: number;
  median: number;
  paidParticipationTarget: TargetEvaluation;
  roundsEndingTarget: TargetEvaluation;
  referrerTarget: TargetEvaluation;
  roundData: Array<{ roundId: number; length: number; paidRate: number; poolEth: number }>;
}): EconomicsData['guidance'] {
  const guidance: EconomicsData['guidance'] = [];

  // Count rounds below target for recent window
  const recentRounds = metrics.roundData.slice(0, 10);
  const roundsBelowPaidTarget = recentRounds.filter(
    r => r.paidRate < ECONOMICS_TARGETS.paidParticipation.min
  ).length;

  // Target-based guidance
  if (metrics.paidParticipationTarget.status === 'below') {
    guidance.push({
      condition: roundsBelowPaidTarget > 5
        ? `Below target in ${roundsBelowPaidTarget} of last 10 rounds (paid participation: ${metrics.paidRate.toFixed(1)}%)`
        : `Paid participation (${metrics.paidRate.toFixed(1)}%) is below target range (${ECONOMICS_TARGETS.paidParticipation.min}-${ECONOMICS_TARGETS.paidParticipation.max}%)`,
      recommendation: 'Consider improving paid value proposition or limiting free guesses',
      severity: roundsBelowPaidTarget > 7 ? 'action' : 'warning',
    });
  } else if (metrics.paidParticipationTarget.status === 'above') {
    guidance.push({
      condition: `Paid participation (${metrics.paidRate.toFixed(1)}%) is above target range`,
      recommendation: 'Strong monetization. Consider if paid pressure is too high for new users',
      severity: 'info',
    });
  }

  // 750 cutoff analysis with target
  if (metrics.roundsEndingTarget.status === 'above') {
    guidance.push({
      condition: `${Math.round(metrics.roundsEndingBefore750Pct)}% of rounds end before 750 (above ${ECONOMICS_TARGETS.roundsEndingBefore750.max}% target)`,
      recommendation: 'Consider lowering the late-pricing cutoff to capture more late-round purchases',
      severity: 'warning',
    });
  } else if (metrics.roundsEndingTarget.status === 'below') {
    guidance.push({
      condition: `Only ${Math.round(metrics.roundsEndingBefore750Pct)}% of rounds end before 750`,
      recommendation: 'Current cutoff is well-placed; most rounds reach late pricing',
      severity: 'info',
    });
  }

  // Early vs late buying
  if (metrics.earlyPct < 40) {
    guidance.push({
      condition: `Only ${Math.round(metrics.earlyPct)}% of packs purchased at early pricing`,
      recommendation: 'Consider strengthening early-round incentives or lowering base pack price',
      severity: 'warning',
    });
  } else if (metrics.earlyPct > 80) {
    guidance.push({
      condition: `${Math.round(metrics.earlyPct)}% of packs purchased at early pricing`,
      recommendation: 'Late pricing tiers may be too aggressive; consider gentler price increases',
      severity: 'info',
    });
  }

  // Referral attach rate with target
  if (metrics.referrerTarget.status === 'below') {
    guidance.push({
      condition: `Referrer attach rate (${Math.round(metrics.roundsWithReferrerPct)}%) is below target (${ECONOMICS_TARGETS.referrerAttachRate.min}%)`,
      recommendation: 'Low referral attach rate suggests UX friction; consider improving referral visibility before adjusting percentages',
      severity: 'warning',
    });
  }

  // Pool growth
  if (metrics.ethPer100Guesses < ECONOMICS_TARGETS.ethPer100Guesses.min) {
    guidance.push({
      condition: `Pool velocity (${(metrics.ethPer100Guesses).toFixed(4)} ETH/100 guesses) is below target`,
      recommendation: 'Pricing slope may be too shallow; consider increasing pack prices or purchase frequency',
      severity: 'action',
    });
  }

  // Round length
  if (metrics.median < ECONOMICS_TARGETS.medianRoundLength.min) {
    guidance.push({
      condition: `Median round length (${metrics.median} guesses) is below target range`,
      recommendation: 'Rounds may be ending too quickly for prize pool growth; consider harder words',
      severity: 'info',
    });
  }

  // All within target - positive feedback
  const allWithinTarget =
    metrics.paidParticipationTarget.status === 'within' &&
    metrics.roundsEndingTarget.status === 'within' &&
    metrics.referrerTarget.status === 'within';

  if (allWithinTarget && guidance.length === 0) {
    guidance.push({
      condition: 'All key metrics are within target ranges',
      recommendation: 'Economics are healthy. Continue monitoring for trends',
      severity: 'info',
    });
  }

  return guidance;
}

// =============================================================================
// Empty Data Helper
// =============================================================================

function getEmptyData(): EconomicsData {
  const emptyTarget: TargetEvaluation = {
    value: 0,
    status: 'within',
    delta: null,
    target: { min: 0, max: 100 },
  };

  return {
    healthOverview: {
      paidParticipation: { rate: 0, trend: 'stable', descriptor: 'No data', target: emptyTarget },
      prizePoolVelocity: { ethPer100Guesses: 0, descriptor: 'No data', target: emptyTarget },
      pricingPhaseEffectiveness: { earlyPct: 0, latePct: 0, lateMaxPct: 0, descriptor: 'No data' },
      top10IncentiveStrength: { poolPct: 0, descriptor: 'No data' },
    },
    packPricing: {
      byPhase: {
        early: { count: 0, ethTotal: 0, avgGuessIndex: 0 },
        late: { count: 0, ethTotal: 0, avgGuessIndex: 0 },
        lateMax: { count: 0, ethTotal: 0, avgGuessIndex: 0 },
      },
      purchasesByInterval: [],
    },
    cutoffDiagnostics: {
      roundLengthDistribution: { median: 0, p25: 0, p75: 0, min: 0, max: 0 },
      roundsEndingBefore750Pct: 0,
      roundsEndingBefore750Target: emptyTarget,
      packsPurchasedBefore750Pct: 0,
      packsBefore750Target: emptyTarget,
      avgGuessesAtRank10Lock: null,
    },
    poolSplit: {
      roundsWithReferrerPct: 0,
      referrerTarget: emptyTarget,
      fallbackFrequencyPct: 0,
      ethDistribution: { toWinner: 0, toTop10: 0, toReferrals: 0, toNextRoundSeed: 0 },
      examplePayout: null,
    },
    growthCurve: { points: [], interpretation: 'No data available' },
    currentConfig: getCurrentEconomicsConfig(),
    configChange: null,
    comparison: null,
    guidance: [],
    targets: ECONOMICS_TARGETS,
    dataRange: { roundCount: 0, oldestRound: null, newestRound: null },
    timestamp: new Date().toISOString(),
  };
}

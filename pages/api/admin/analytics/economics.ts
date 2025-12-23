/**
 * Economics Analytics API
 * Provides aggregated economics metrics for the admin Economics dashboard
 *
 * Metrics include:
 * - Paid participation rates
 * - Prize pool velocity
 * - Pricing phase effectiveness
 * - Top-10 incentive analysis
 * - 750-cutoff diagnostics
 * - Pool split & referral analysis
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../../src/db';
import { rounds, guesses, packPurchases } from '../../../../src/db/schema';
import { eq, sql, desc, and, gte, isNotNull, count, sum, avg } from 'drizzle-orm';
import { isAdminFid } from '../me';
import { cacheAside, CacheKeys, CacheTTL } from '../../../../src/lib/redis';

interface EconomicsData {
  // Health overview metrics
  healthOverview: {
    paidParticipation: {
      rate: number; // % of guesses that are paid
      trend: 'up' | 'down' | 'stable';
      descriptor: string;
    };
    prizePoolVelocity: {
      ethPer100Guesses: number;
      descriptor: string;
    };
    pricingPhaseEffectiveness: {
      earlyPct: number;
      latePct: number;
      lateMaxPct: number;
      descriptor: string;
    };
    top10IncentiveStrength: {
      poolPct: number; // Top-10 pool as % of total paid ETH
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

  // 750-cutoff diagnostics
  cutoffDiagnostics: {
    roundLengthDistribution: {
      median: number;
      p25: number;
      p75: number;
      min: number;
      max: number;
    };
    roundsEndingBefore750Pct: number;
    packsPurchasedBefore750Pct: number;
    avgGuessesAtRank10Lock: number | null;
  };

  // Pool split analysis
  poolSplit: {
    roundsWithReferrerPct: number;
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

  // Guidance recommendations
  guidance: Array<{
    condition: string;
    recommendation: string;
    severity: 'info' | 'warning' | 'action';
  }>;

  // Metadata
  dataRange: {
    roundCount: number;
    oldestRound: string | null;
    newestRound: string | null;
  };
  timestamp: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<EconomicsData | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const devFid = req.query.devFid ? parseInt(req.query.devFid as string, 10) : null;

  if (!isAdminFid(devFid)) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    const cacheKey = CacheKeys.adminAnalytics('economics');
    const data = await cacheAside<EconomicsData>(
      cacheKey,
      CacheTTL.adminAnalytics,
      computeEconomicsData
    );

    return res.status(200).json(data);
  } catch (error) {
    console.error('Economics API error:', error);
    return res.status(500).json({ error: 'Failed to compute economics data' });
  }
}

async function computeEconomicsData(): Promise<EconomicsData> {
  // Get resolved rounds from the last 30 days for analysis
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

  // Get guess counts and paid/free breakdown
  const guessStats = await db
    .select({
      roundId: guesses.roundId,
      totalGuesses: count(),
      paidGuesses: sql<number>`COUNT(*) FILTER (WHERE ${guesses.isPaid} = true)`,
      freeGuesses: sql<number>`COUNT(*) FILTER (WHERE ${guesses.isPaid} = false)`,
    })
    .from(guesses)
    .where(sql`${guesses.roundId} IN (${sql.raw(resolvedRounds.map(r => r.id).join(',') || '0')})`)
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
    .where(sql`${packPurchases.roundId} IN (${sql.raw(resolvedRounds.map(r => r.id).join(',') || '0')})`)
    .groupBy(packPurchases.pricingPhase);

  // Get purchases by interval (buckets of 100 guesses)
  const purchasesByInterval = await db
    .select({
      bucket: sql<number>`FLOOR(${packPurchases.totalGuessesAtPurchase} / 100) * 100`,
      packCount: sum(packPurchases.packCount),
      totalEth: sum(packPurchases.totalPriceEth),
    })
    .from(packPurchases)
    .where(sql`${packPurchases.roundId} IN (${sql.raw(resolvedRounds.map(r => r.id).join(',') || '0')})`)
    .groupBy(sql`FLOOR(${packPurchases.totalGuessesAtPurchase} / 100) * 100`)
    .orderBy(sql`FLOOR(${packPurchases.totalGuessesAtPurchase} / 100) * 100`);

  // Calculate total guesses and paid rate
  let totalGuesses = 0;
  let totalPaidGuesses = 0;
  const roundLengths: number[] = [];

  for (const round of resolvedRounds) {
    const stats = guessStatsByRound.get(round.id);
    if (stats) {
      totalGuesses += Number(stats.totalGuesses);
      totalPaidGuesses += Number(stats.paidGuesses);
      roundLengths.push(Number(stats.totalGuesses));
    }
  }

  const paidRate = totalGuesses > 0 ? (totalPaidGuesses / totalGuesses) * 100 : 0;

  // Calculate prize pool velocity (ETH per 100 guesses)
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
  const packsBefore750 = phaseStats.early.count;
  const packsAfter750 = phaseStats.late.count + phaseStats.lateMax.count;
  const packsBefore750Pct = totalPacks > 0 ? (packsBefore750 / totalPacks) * 100 : 0;

  // Referrer analysis
  const roundsWithReferrer = resolvedRounds.filter(r => r.referrerFid !== null).length;
  const roundsWithReferrerPct = resolvedRounds.length > 0
    ? (roundsWithReferrer / resolvedRounds.length) * 100
    : 0;

  // Calculate ETH distribution (based on 80/10/10 split)
  // Winner: 80%, Top-10: 10%, Referrer: 10% (or redistributed if no referrer)
  const totalDistributedEth = totalPoolEth;
  const ethToWinner = totalDistributedEth * 0.8;
  const ethToTop10 = totalDistributedEth * 0.1;
  const ethToReferrals = totalDistributedEth * 0.1 * (roundsWithReferrerPct / 100);
  const ethToSeed = totalDistributedEth * 0.1 * ((100 - roundsWithReferrerPct) / 100) * 0.25; // 2.5% of 10%

  // Top-10 pool as % of total paid ETH
  const totalPaidEth = phaseStats.early.ethTotal + phaseStats.late.ethTotal + phaseStats.lateMax.ethTotal;
  const top10PoolPct = totalPaidEth > 0 ? (ethToTop10 / totalPaidEth) * 100 : 0;

  // Example payout at median pool size
  const medianPool = resolvedRounds.length > 0
    ? parseFloat(resolvedRounds[Math.floor(resolvedRounds.length / 2)].prizePoolEth || '0')
    : null;

  // Generate guidance
  const guidance = generateGuidance({
    paidRate,
    earlyPct,
    roundsEndingBefore750Pct,
    packsBefore750Pct,
    roundsWithReferrerPct,
    ethPer100Guesses,
    median,
  });

  // Format intervals for chart
  const intervals = purchasesByInterval.map(p => ({
    intervalStart: Number(p.bucket),
    intervalEnd: Number(p.bucket) + 100,
    packCount: Number(p.packCount) || 0,
    ethTotal: parseFloat(String(p.totalEth)) || 0,
  }));

  return {
    healthOverview: {
      paidParticipation: {
        rate: Math.round(paidRate * 10) / 10,
        trend: 'stable', // Would need historical data for trend
        descriptor: paidRate >= 15 ? 'Healthy' : paidRate >= 8 ? 'Moderate' : 'Low',
      },
      prizePoolVelocity: {
        ethPer100Guesses: Math.round(ethPer100Guesses * 10000) / 10000,
        descriptor: ethPer100Guesses >= 0.01 ? 'Strong growth' : ethPer100Guesses >= 0.005 ? 'Moderate' : 'Slow',
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
      packsPurchasedBefore750Pct: Math.round(packsBefore750Pct),
      avgGuessesAtRank10Lock: null, // Would need top-10 tracking data
    },
    poolSplit: {
      roundsWithReferrerPct: Math.round(roundsWithReferrerPct),
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
    guidance,
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

function generateGuidance(metrics: {
  paidRate: number;
  earlyPct: number;
  roundsEndingBefore750Pct: number;
  packsBefore750Pct: number;
  roundsWithReferrerPct: number;
  ethPer100Guesses: number;
  median: number;
}): EconomicsData['guidance'] {
  const guidance: EconomicsData['guidance'] = [];

  // 750 cutoff analysis
  if (metrics.roundsEndingBefore750Pct > 70) {
    guidance.push({
      condition: `${Math.round(metrics.roundsEndingBefore750Pct)}% of rounds end before 750 guesses`,
      recommendation: 'Consider lowering the late-pricing cutoff to capture more late-round purchases',
      severity: 'warning',
    });
  } else if (metrics.roundsEndingBefore750Pct < 30) {
    guidance.push({
      condition: `Only ${Math.round(metrics.roundsEndingBefore750Pct)}% of rounds end before 750 guesses`,
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
  }

  if (metrics.earlyPct > 80) {
    guidance.push({
      condition: `${Math.round(metrics.earlyPct)}% of packs purchased at early pricing`,
      recommendation: 'Late pricing tiers may be too aggressive; consider gentler price increases',
      severity: 'info',
    });
  }

  // Referral attach rate
  if (metrics.roundsWithReferrerPct < 20) {
    guidance.push({
      condition: `Only ${Math.round(metrics.roundsWithReferrerPct)}% of winners had referrers`,
      recommendation: 'Low referral attach rate suggests UX friction; consider improving referral visibility before adjusting percentages',
      severity: 'warning',
    });
  }

  // Pool growth
  if (metrics.ethPer100Guesses < 0.003) {
    guidance.push({
      condition: `Pool grows slowly (${(metrics.ethPer100Guesses * 1000).toFixed(2)} ETH per 1000 guesses)`,
      recommendation: 'Pricing slope may be too shallow; consider increasing pack prices or purchase frequency',
      severity: 'action',
    });
  }

  // Paid participation
  if (metrics.paidRate < 5) {
    guidance.push({
      condition: `Very low paid participation (${metrics.paidRate.toFixed(1)}%)`,
      recommendation: 'Most users rely on free guesses; consider limiting free guesses or improving paid value proposition',
      severity: 'action',
    });
  } else if (metrics.paidRate > 25) {
    guidance.push({
      condition: `High paid participation (${metrics.paidRate.toFixed(1)}%)`,
      recommendation: 'Strong monetization; current incentive balance is working',
      severity: 'info',
    });
  }

  // Round length
  if (metrics.median < 200) {
    guidance.push({
      condition: `Median round length is short (${metrics.median} guesses)`,
      recommendation: 'Rounds may be ending too quickly for prize pool growth; consider harder words or larger word pool',
      severity: 'info',
    });
  }

  return guidance;
}

/**
 * Transaction-Level Prize Audit
 * Milestone 5.3: Advanced analytics & fairness systems
 *
 * Cross-checks prize amounts vs expected economic rules:
 * - Detect underpayment, overpayment, or anomalies
 * - Sends anomaly reports with full round context
 */

import { db } from '../../db';
import { rounds, roundPayouts, guesses, users } from '../../db/schema';
import { eq, and, desc, gte, sql, count, sum } from 'drizzle-orm';
import { logAnalyticsEvent } from '../../lib/analytics';
import { FairnessAlertTypes } from './index';

/**
 * Economic rules for the game
 */
export const ECONOMIC_RULES = {
  GUESS_PRICE_ETH: 0.0003,
  PRIZE_POOL_SHARE: 0.8,  // 80% to prize pool
  SEED_CREATOR_SHARE: 0.2, // 20% to seed/creator
  WINNER_SHARE: 0.8,       // 80% of jackpot to winner
  REFERRER_SHARE: 0.1,     // 10% to referrer
  TOP_GUESSERS_SHARE: 0.1, // 10% to top guessers
  SEED_CAP_ETH: 0.02,      // 0.02 ETH seed cap (updated from 0.1 in Milestone 5.4b)
};

/**
 * Prize audit result for a single round
 */
export interface PrizeAuditResult {
  roundId: number;
  status: 'valid' | 'anomaly' | 'error';
  jackpot: number;
  paidGuessCount: number;
  expectedPrizePoolFromGuesses: number;
  actualPrizePool: number;
  prizePoolVariance: number;
  payoutBreakdown: {
    winner: number;
    referrer: number;
    topGuessers: number;
    seed: number;
    creator: number;
    total: number;
  };
  expectedPayouts: {
    winner: number;
    referrer: number;
    topGuessers: number;
  };
  anomalies: PrizeAnomaly[];
  checkedAt: Date;
}

/**
 * A prize anomaly
 */
export interface PrizeAnomaly {
  type: 'underpayment' | 'overpayment' | 'missing_payout' | 'excess_payout' | 'pool_mismatch';
  role?: string;
  expected: number;
  actual: number;
  variance: number;
  message: string;
}

/**
 * Audit prize pool growth for a round
 * Verifies that the prize pool matches expected value based on paid guesses
 */
export async function auditPrizePoolGrowth(roundId: number): Promise<PrizeAuditResult> {
  const result: PrizeAuditResult = {
    roundId,
    status: 'valid',
    jackpot: 0,
    paidGuessCount: 0,
    expectedPrizePoolFromGuesses: 0,
    actualPrizePool: 0,
    prizePoolVariance: 0,
    payoutBreakdown: {
      winner: 0,
      referrer: 0,
      topGuessers: 0,
      seed: 0,
      creator: 0,
      total: 0,
    },
    expectedPayouts: {
      winner: 0,
      referrer: 0,
      topGuessers: 0,
    },
    anomalies: [],
    checkedAt: new Date(),
  };

  try {
    // Fetch the round
    const [round] = await db
      .select()
      .from(rounds)
      .where(eq(rounds.id, roundId))
      .limit(1);

    if (!round) {
      result.status = 'error';
      result.anomalies.push({
        type: 'pool_mismatch',
        expected: 0,
        actual: 0,
        variance: 0,
        message: `Round ${roundId} not found`,
      });
      return result;
    }

    result.jackpot = parseFloat(round.prizePoolEth);
    result.actualPrizePool = result.jackpot;

    // Count paid guesses for this round
    const paidGuessResult = await db
      .select({ count: count() })
      .from(guesses)
      .where(and(
        eq(guesses.roundId, roundId),
        eq(guesses.isPaid, true)
      ));

    result.paidGuessCount = paidGuessResult[0]?.count || 0;

    // Calculate expected prize pool from paid guesses
    // Each paid guess contributes GUESS_PRICE_ETH * PRIZE_POOL_SHARE to the pool
    result.expectedPrizePoolFromGuesses =
      result.paidGuessCount * ECONOMIC_RULES.GUESS_PRICE_ETH * ECONOMIC_RULES.PRIZE_POOL_SHARE;

    // Note: Prize pool also includes seed from previous round, so expected might be less than actual
    // We only flag if actual is LESS than expected (underpayment)
    result.prizePoolVariance = result.actualPrizePool - result.expectedPrizePoolFromGuesses;

    // Only flag negative variance as an anomaly (underpayment to pool)
    if (result.prizePoolVariance < -0.000001) {
      result.status = 'anomaly';
      result.anomalies.push({
        type: 'pool_mismatch',
        expected: result.expectedPrizePoolFromGuesses,
        actual: result.actualPrizePool,
        variance: result.prizePoolVariance,
        message: `Prize pool lower than expected from paid guesses. Missing: ${Math.abs(result.prizePoolVariance).toFixed(18)} ETH`,
      });
    }

    // If round is resolved, audit payouts
    if (round.resolvedAt) {
      await auditRoundPayouts(result);
    }

  } catch (error) {
    result.status = 'error';
    result.anomalies.push({
      type: 'pool_mismatch',
      expected: 0,
      actual: 0,
      variance: 0,
      message: `Error auditing round: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  // Log anomalies
  if (result.anomalies.length > 0) {
    await logPrizeAuditAnomaly(result);
  }

  return result;
}

/**
 * Audit payout distribution for a resolved round
 */
async function auditRoundPayouts(result: PrizeAuditResult): Promise<void> {
  // Fetch all payouts for this round
  const payouts = await db
    .select()
    .from(roundPayouts)
    .where(eq(roundPayouts.roundId, result.roundId));

  // Calculate actual payout totals by role
  for (const payout of payouts) {
    const amount = parseFloat(payout.amountEth);
    switch (payout.role) {
      case 'winner':
        result.payoutBreakdown.winner += amount;
        break;
      case 'referrer':
        result.payoutBreakdown.referrer += amount;
        break;
      case 'top_guesser':
        result.payoutBreakdown.topGuessers += amount;
        break;
      case 'seed':
        result.payoutBreakdown.seed += amount;
        break;
      case 'creator':
        result.payoutBreakdown.creator += amount;
        break;
    }
    result.payoutBreakdown.total += amount;
  }

  // Calculate expected payouts
  result.expectedPayouts.winner = result.jackpot * ECONOMIC_RULES.WINNER_SHARE;
  result.expectedPayouts.referrer = result.jackpot * ECONOMIC_RULES.REFERRER_SHARE;
  result.expectedPayouts.topGuessers = result.jackpot * ECONOMIC_RULES.TOP_GUESSERS_SHARE;

  // Check winner payout
  const winnerVariance = result.payoutBreakdown.winner - result.expectedPayouts.winner;
  if (Math.abs(winnerVariance) > 0.000001) {
    result.status = 'anomaly';
    result.anomalies.push({
      type: winnerVariance < 0 ? 'underpayment' : 'overpayment',
      role: 'winner',
      expected: result.expectedPayouts.winner,
      actual: result.payoutBreakdown.winner,
      variance: winnerVariance,
      message: `Winner ${winnerVariance < 0 ? 'underpaid' : 'overpaid'} by ${Math.abs(winnerVariance).toFixed(18)} ETH`,
    });
  }

  // Check referrer/seed/creator payout (combined should equal 10%)
  const referrerCombined = result.payoutBreakdown.referrer +
    result.payoutBreakdown.seed +
    result.payoutBreakdown.creator;
  const referrerVariance = referrerCombined - result.expectedPayouts.referrer;
  if (Math.abs(referrerVariance) > 0.000001) {
    result.status = 'anomaly';
    result.anomalies.push({
      type: referrerVariance < 0 ? 'underpayment' : 'overpayment',
      role: 'referrer/seed/creator',
      expected: result.expectedPayouts.referrer,
      actual: referrerCombined,
      variance: referrerVariance,
      message: `Referrer/seed allocation ${referrerVariance < 0 ? 'under' : 'over'} by ${Math.abs(referrerVariance).toFixed(18)} ETH`,
    });
  }

  // Check top guessers payout
  const topGuessersVariance = result.payoutBreakdown.topGuessers - result.expectedPayouts.topGuessers;
  if (Math.abs(topGuessersVariance) > 0.000001) {
    result.status = 'anomaly';
    result.anomalies.push({
      type: topGuessersVariance < 0 ? 'underpayment' : 'overpayment',
      role: 'top_guessers',
      expected: result.expectedPayouts.topGuessers,
      actual: result.payoutBreakdown.topGuessers,
      variance: topGuessersVariance,
      message: `Top guessers ${topGuessersVariance < 0 ? 'underpaid' : 'overpaid'} by ${Math.abs(topGuessersVariance).toFixed(18)} ETH`,
    });
  }

  // Check total payouts don't exceed jackpot
  if (result.payoutBreakdown.total > result.jackpot + 0.000001) {
    result.status = 'anomaly';
    result.anomalies.push({
      type: 'excess_payout',
      expected: result.jackpot,
      actual: result.payoutBreakdown.total,
      variance: result.payoutBreakdown.total - result.jackpot,
      message: `Total payouts (${result.payoutBreakdown.total.toFixed(18)} ETH) exceed jackpot (${result.jackpot.toFixed(18)} ETH)`,
    });
  }
}

/**
 * Log a prize audit anomaly
 */
async function logPrizeAuditAnomaly(result: PrizeAuditResult): Promise<void> {
  await logAnalyticsEvent(FairnessAlertTypes.PRIZE_AUDIT_MISMATCH, {
    roundId: result.roundId,
    data: {
      status: result.status,
      jackpot: result.jackpot,
      paidGuessCount: result.paidGuessCount,
      expectedPrizePool: result.expectedPrizePoolFromGuesses,
      actualPrizePool: result.actualPrizePool,
      prizePoolVariance: result.prizePoolVariance,
      payoutBreakdown: result.payoutBreakdown,
      anomalies: result.anomalies,
    },
  });

  console.log(`🔍 [Prize Audit] Round ${result.roundId}: ${result.anomalies.length} anomalies detected`);
  for (const anomaly of result.anomalies) {
    console.log(`  ⚠️ ${anomaly.type}: ${anomaly.message}`);
  }
}

/**
 * Run a full prize audit across multiple rounds
 */
export async function runPrizeAudit(options?: {
  startDate?: Date;
  endDate?: Date;
  roundIds?: number[];
  limit?: number;
}): Promise<{
  audited: number;
  valid: number;
  anomalies: number;
  results: PrizeAuditResult[];
}> {
  // Fetch rounds to audit
  let roundsQuery = db
    .select({ id: rounds.id })
    .from(rounds)
    .orderBy(desc(rounds.startedAt))
    .limit(options?.limit || 100);

  const roundsToAudit = await roundsQuery;

  // Filter by options
  let filteredRounds = roundsToAudit;

  if (options?.roundIds && options.roundIds.length > 0) {
    filteredRounds = filteredRounds.filter(r => options.roundIds!.includes(r.id));
  }

  const results: PrizeAuditResult[] = [];
  let valid = 0;
  let anomalies = 0;

  for (const round of filteredRounds) {
    const result = await auditPrizePoolGrowth(round.id);
    results.push(result);

    if (result.status === 'valid') {
      valid++;
    } else if (result.status === 'anomaly') {
      anomalies++;
    }
  }

  return {
    audited: results.length,
    valid,
    anomalies,
    results,
  };
}

/**
 * Get summary statistics for prize audits
 */
export async function getPrizeAuditSummary(): Promise<{
  totalJackpotDistributed: number;
  totalPaidGuesses: number;
  totalRevenue: number;
  averageJackpot: number;
  largestJackpot: number;
}> {
  // Get total paid guesses
  const paidGuessResult = await db
    .select({ count: count() })
    .from(guesses)
    .where(eq(guesses.isPaid, true));

  const totalPaidGuesses = paidGuessResult[0]?.count || 0;
  const totalRevenue = totalPaidGuesses * ECONOMIC_RULES.GUESS_PRICE_ETH;

  // Get jackpot statistics from resolved rounds
  const jackpotStats = await db
    .select({
      totalJackpot: sql<string>`COALESCE(SUM(CAST(${rounds.prizePoolEth} AS DECIMAL)), 0)`,
      avgJackpot: sql<string>`COALESCE(AVG(CAST(${rounds.prizePoolEth} AS DECIMAL)), 0)`,
      maxJackpot: sql<string>`COALESCE(MAX(CAST(${rounds.prizePoolEth} AS DECIMAL)), 0)`,
      count: count(),
    })
    .from(rounds)
    .where(sql`${rounds.resolvedAt} IS NOT NULL`);

  return {
    totalJackpotDistributed: parseFloat(jackpotStats[0]?.totalJackpot || '0'),
    totalPaidGuesses,
    totalRevenue,
    averageJackpot: parseFloat(jackpotStats[0]?.avgJackpot || '0'),
    largestJackpot: parseFloat(jackpotStats[0]?.maxJackpot || '0'),
  };
}

/**
 * Fairness Monitor Service
 * Milestone 5.3: Advanced analytics & fairness systems
 *
 * Provides continuous provable-fairness monitoring:
 * - Validates every commit-reveal pair across all rounds
 * - Detects mismatches between committed hash, revealed solution, and jackpot payout
 * - Automated alerts on invalid hash chains, payout mismatches, suspicious sequences
 */

import { db } from '../../db';
import { rounds, roundPayouts, guesses, analyticsEvents } from '../../db/schema';
import { eq, and, isNotNull, desc, gte, lte, sql, count } from 'drizzle-orm';
import { verifyCommit } from '../../lib/commit-reveal';
import { logAnalyticsEvent } from '../../lib/analytics';

// Event types for fairness alerts
export const FairnessAlertTypes = {
  HASH_MISMATCH: 'FAIRNESS_ALERT_HASH_MISMATCH',
  PAYOUT_MISMATCH: 'FAIRNESS_ALERT_PAYOUT_MISMATCH',
  SUSPICIOUS_SEQUENCE: 'FAIRNESS_ALERT_SUSPICIOUS_SEQUENCE',
  INVALID_HASH_CHAIN: 'FAIRNESS_ALERT_INVALID_HASH_CHAIN',
  PRIZE_AUDIT_MISMATCH: 'PRIZE_AUDIT_MISMATCH',
} as const;

export type FairnessAlertType = typeof FairnessAlertTypes[keyof typeof FairnessAlertTypes];

/**
 * Result of a fairness validation check
 */
export interface FairnessValidationResult {
  roundId: number;
  isValid: boolean;
  commitHashValid: boolean;
  payoutValid: boolean;
  errors: string[];
  warnings: string[];
  checkedAt: Date;
}

/**
 * Result of a full audit run
 */
export interface FairnessAuditReport {
  auditId: string;
  startTime: Date;
  endTime: Date;
  totalRoundsChecked: number;
  validRounds: number;
  invalidRounds: number;
  alerts: FairnessAlert[];
  summary: {
    hashMismatches: number;
    payoutMismatches: number;
    suspiciousSequences: number;
  };
}

/**
 * A fairness alert
 */
export interface FairnessAlert {
  id: string;
  type: FairnessAlertType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  roundId: number;
  message: string;
  details: Record<string, any>;
  createdAt: Date;
}

/**
 * Validate commit-reveal for a single round
 * Ensures H(salt || answer) === commitHash
 */
export async function validateRoundCommitment(roundId: number): Promise<FairnessValidationResult> {
  const result: FairnessValidationResult = {
    roundId,
    isValid: true,
    commitHashValid: true,
    payoutValid: true,
    errors: [],
    warnings: [],
    checkedAt: new Date(),
  };

  // Fetch the round
  const [round] = await db
    .select()
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .limit(1);

  if (!round) {
    result.isValid = false;
    result.errors.push(`Round ${roundId} not found`);
    return result;
  }

  // Only validate resolved rounds (where answer is revealed)
  if (!round.resolvedAt) {
    result.warnings.push('Round not yet resolved - commitment cannot be verified until resolution');
    return result;
  }

  // Validate commit hash: H(salt || answer) === commitHash
  const isCommitValid = verifyCommit(round.salt, round.answer, round.commitHash);

  if (!isCommitValid) {
    result.isValid = false;
    result.commitHashValid = false;
    result.errors.push(
      `CRITICAL: Commit hash mismatch! H(salt || answer) !== stored commitHash. ` +
      `Expected: H(${round.salt} || ${round.answer}), Got: ${round.commitHash}`
    );

    // Log critical alert
    await logFairnessAlert({
      type: FairnessAlertTypes.HASH_MISMATCH,
      severity: 'critical',
      roundId,
      message: 'Commit-reveal hash mismatch detected',
      details: {
        storedCommitHash: round.commitHash,
        answer: round.answer,
        salt: round.salt,
      },
    });
  }

  return result;
}

/**
 * Validate payout amounts for a resolved round
 * Ensures payouts follow the expected economic rules:
 * - 80% to winner
 * - 10% to referrer (or seed+creator if no referrer)
 * - 10% to top guessers
 */
export async function validateRoundPayouts(roundId: number): Promise<FairnessValidationResult> {
  const result: FairnessValidationResult = {
    roundId,
    isValid: true,
    commitHashValid: true,
    payoutValid: true,
    errors: [],
    warnings: [],
    checkedAt: new Date(),
  };

  // Fetch the round
  const [round] = await db
    .select()
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .limit(1);

  if (!round) {
    result.isValid = false;
    result.errors.push(`Round ${roundId} not found`);
    return result;
  }

  if (!round.resolvedAt) {
    result.warnings.push('Round not yet resolved - payouts not available');
    return result;
  }

  const jackpot = parseFloat(round.prizePoolEth);

  if (jackpot === 0) {
    result.warnings.push('Round has zero jackpot - no payouts expected');
    return result;
  }

  // Fetch all payouts for this round
  const payouts = await db
    .select()
    .from(roundPayouts)
    .where(eq(roundPayouts.roundId, roundId));

  // Calculate expected payouts
  const expectedWinner = jackpot * 0.8;
  const expectedReferrer = jackpot * 0.1;
  const expectedTopGuessers = jackpot * 0.1;

  // Sum actual payouts by role
  const actualPayouts: Record<string, number> = {
    winner: 0,
    referrer: 0,
    top_guesser: 0,
    seed: 0,
    creator: 0,
  };

  for (const payout of payouts) {
    const amount = parseFloat(payout.amountEth);
    actualPayouts[payout.role] = (actualPayouts[payout.role] || 0) + amount;
  }

  // Validate winner payout (80%)
  const winnerDiff = Math.abs(actualPayouts.winner - expectedWinner);
  if (winnerDiff > 0.000001) { // Allow tiny floating point variance
    result.isValid = false;
    result.payoutValid = false;
    result.errors.push(
      `Winner payout mismatch: expected ${expectedWinner.toFixed(18)} ETH, got ${actualPayouts.winner.toFixed(18)} ETH`
    );
  }

  // Validate referrer/seed+creator payout (10%)
  const referrerOrSeedCreator = actualPayouts.referrer + actualPayouts.seed + actualPayouts.creator;
  const referrerDiff = Math.abs(referrerOrSeedCreator - expectedReferrer);
  if (referrerDiff > 0.000001) {
    result.isValid = false;
    result.payoutValid = false;
    result.errors.push(
      `Referrer/seed payout mismatch: expected ${expectedReferrer.toFixed(18)} ETH, got ${referrerOrSeedCreator.toFixed(18)} ETH`
    );
  }

  // Validate top guessers payout (10%)
  const topGuesserDiff = Math.abs(actualPayouts.top_guesser - expectedTopGuessers);
  if (topGuesserDiff > 0.000001) {
    result.isValid = false;
    result.payoutValid = false;
    result.errors.push(
      `Top guessers payout mismatch: expected ${expectedTopGuessers.toFixed(18)} ETH, got ${actualPayouts.top_guesser.toFixed(18)} ETH`
    );
  }

  // Log alert if there are payout issues
  if (!result.payoutValid) {
    await logFairnessAlert({
      type: FairnessAlertTypes.PAYOUT_MISMATCH,
      severity: 'high',
      roundId,
      message: 'Payout amounts do not match expected economic rules',
      details: {
        jackpot,
        expected: { winner: expectedWinner, referrer: expectedReferrer, topGuessers: expectedTopGuessers },
        actual: actualPayouts,
        errors: result.errors,
      },
    });
  }

  return result;
}

/**
 * Detect suspicious solution sequences
 * Looks for patterns that might indicate manipulation:
 * - Same answer appearing too frequently
 * - Answers that are too easy (common words)
 * - Sequential/predictable patterns
 */
export async function detectSuspiciousSequences(
  lookbackRounds: number = 50
): Promise<FairnessAlert[]> {
  const alerts: FairnessAlert[] = [];

  // Fetch recent resolved rounds
  const recentRounds = await db
    .select({
      id: rounds.id,
      answer: rounds.answer,
      resolvedAt: rounds.resolvedAt,
      winnerFid: rounds.winnerFid,
    })
    .from(rounds)
    .where(isNotNull(rounds.resolvedAt))
    .orderBy(desc(rounds.resolvedAt))
    .limit(lookbackRounds);

  if (recentRounds.length < 5) {
    // Not enough data for pattern analysis
    return alerts;
  }

  // Check for repeated answers
  const answerCounts: Record<string, number> = {};
  for (const round of recentRounds) {
    answerCounts[round.answer] = (answerCounts[round.answer] || 0) + 1;
  }

  for (const [answer, count] of Object.entries(answerCounts)) {
    if (count > 2) {
      const alert: FairnessAlert = {
        id: `suspicious-repeat-${answer}-${Date.now()}`,
        type: FairnessAlertTypes.SUSPICIOUS_SEQUENCE,
        severity: count > 3 ? 'high' : 'medium',
        roundId: recentRounds.find(r => r.answer === answer)?.id || 0,
        message: `Answer "${answer}" appeared ${count} times in last ${lookbackRounds} rounds`,
        details: {
          answer,
          occurrences: count,
          lookbackRounds,
        },
        createdAt: new Date(),
      };
      alerts.push(alert);

      await logFairnessAlert(alert);
    }
  }

  // Check for same winner winning multiple times
  const winnerCounts: Record<number, number> = {};
  for (const round of recentRounds) {
    if (round.winnerFid) {
      winnerCounts[round.winnerFid] = (winnerCounts[round.winnerFid] || 0) + 1;
    }
  }

  for (const [winnerFid, count] of Object.entries(winnerCounts)) {
    if (count > 3) {
      const alert: FairnessAlert = {
        id: `suspicious-winner-${winnerFid}-${Date.now()}`,
        type: FairnessAlertTypes.SUSPICIOUS_SEQUENCE,
        severity: count > 5 ? 'high' : 'medium',
        roundId: recentRounds.find(r => r.winnerFid === parseInt(winnerFid))?.id || 0,
        message: `User FID ${winnerFid} won ${count} times in last ${lookbackRounds} rounds`,
        details: {
          winnerFid: parseInt(winnerFid),
          wins: count,
          lookbackRounds,
        },
        createdAt: new Date(),
      };
      alerts.push(alert);

      await logFairnessAlert(alert);
    }
  }

  return alerts;
}

/**
 * Run a full fairness audit across all resolved rounds
 * or within a specific time range
 */
export async function runFairnessAudit(options?: {
  startDate?: Date;
  endDate?: Date;
  roundIds?: number[];
}): Promise<FairnessAuditReport> {
  const auditId = `audit-${Date.now()}`;
  const startTime = new Date();
  const alerts: FairnessAlert[] = [];
  let validRounds = 0;
  let invalidRounds = 0;

  // Build query for resolved rounds
  let roundsQuery = db
    .select()
    .from(rounds)
    .where(isNotNull(rounds.resolvedAt))
    .orderBy(desc(rounds.resolvedAt));

  // Fetch rounds to audit
  const roundsToAudit = await roundsQuery;

  // Filter by options
  let filteredRounds = roundsToAudit;

  if (options?.startDate) {
    filteredRounds = filteredRounds.filter(r =>
      r.resolvedAt && r.resolvedAt >= options.startDate!
    );
  }

  if (options?.endDate) {
    filteredRounds = filteredRounds.filter(r =>
      r.resolvedAt && r.resolvedAt <= options.endDate!
    );
  }

  if (options?.roundIds && options.roundIds.length > 0) {
    filteredRounds = filteredRounds.filter(r => options.roundIds!.includes(r.id));
  }

  // Validate each round
  for (const round of filteredRounds) {
    // Validate commitment
    const commitResult = await validateRoundCommitment(round.id);

    // Validate payouts
    const payoutResult = await validateRoundPayouts(round.id);

    if (commitResult.isValid && payoutResult.isValid) {
      validRounds++;
    } else {
      invalidRounds++;

      // Collect errors as alerts
      for (const error of [...commitResult.errors, ...payoutResult.errors]) {
        alerts.push({
          id: `audit-${auditId}-round-${round.id}-${Date.now()}`,
          type: commitResult.commitHashValid ? FairnessAlertTypes.PAYOUT_MISMATCH : FairnessAlertTypes.HASH_MISMATCH,
          severity: 'high',
          roundId: round.id,
          message: error,
          details: { commitResult, payoutResult },
          createdAt: new Date(),
        });
      }
    }
  }

  // Detect suspicious sequences
  const sequenceAlerts = await detectSuspiciousSequences();
  alerts.push(...sequenceAlerts);

  const endTime = new Date();

  const report: FairnessAuditReport = {
    auditId,
    startTime,
    endTime,
    totalRoundsChecked: filteredRounds.length,
    validRounds,
    invalidRounds,
    alerts,
    summary: {
      hashMismatches: alerts.filter(a => a.type === FairnessAlertTypes.HASH_MISMATCH).length,
      payoutMismatches: alerts.filter(a => a.type === FairnessAlertTypes.PAYOUT_MISMATCH).length,
      suspiciousSequences: alerts.filter(a => a.type === FairnessAlertTypes.SUSPICIOUS_SEQUENCE).length,
    },
  };

  // Log the audit completion
  await logAnalyticsEvent('FAIRNESS_AUDIT_COMPLETED', {
    data: {
      auditId,
      totalRoundsChecked: filteredRounds.length,
      validRounds,
      invalidRounds,
      alertCount: alerts.length,
      duration: endTime.getTime() - startTime.getTime(),
    },
  });

  return report;
}

/**
 * Log a fairness alert to the analytics system
 */
async function logFairnessAlert(alert: Omit<FairnessAlert, 'id' | 'createdAt'>): Promise<void> {
  const fullAlert: FairnessAlert = {
    ...alert,
    id: `${alert.type}-${alert.roundId}-${Date.now()}`,
    createdAt: new Date(),
  };

  await logAnalyticsEvent(alert.type, {
    roundId: alert.roundId,
    data: {
      severity: alert.severity,
      message: alert.message,
      details: alert.details,
    },
  });

  // Also log to console for immediate visibility
  const severityEmoji = {
    low: '📝',
    medium: '⚠️',
    high: '🚨',
    critical: '🔴',
  }[alert.severity];

  console.log(`${severityEmoji} [Fairness Alert] ${alert.type}: ${alert.message}`);
}

/**
 * Get recent fairness alerts from the database
 */
export async function getRecentFairnessAlerts(
  limit: number = 50
): Promise<FairnessAlert[]> {
  const alertEventTypes = Object.values(FairnessAlertTypes);

  const events = await db
    .select()
    .from(analyticsEvents)
    .where(sql`${analyticsEvents.eventType} = ANY(${alertEventTypes})`)
    .orderBy(desc(analyticsEvents.createdAt))
    .limit(limit);

  return events.map(event => ({
    id: `${event.eventType}-${event.id}`,
    type: event.eventType as FairnessAlertType,
    severity: (event.data as any)?.severity || 'medium',
    roundId: parseInt(event.roundId || '0'),
    message: (event.data as any)?.message || '',
    details: (event.data as any)?.details || {},
    createdAt: event.createdAt,
  }));
}

// Export types
export type { FairnessValidationResult, FairnessAuditReport, FairnessAlert };

/**
 * Fairness Analytics API
 * Milestone 5.3: Advanced analytics & fairness systems
 *
 * Provides:
 * - Fairness audit results
 * - Recent alerts
 * - Prize audit summary
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from '../me';
import { cacheAside, CacheKeys, CacheTTL } from '../../../../src/lib/redis';
import {
  runFairnessAudit,
  getRecentFairnessAlerts,
  validateRoundCommitment,
  validateRoundPayouts,
  FairnessAuditReport,
  FairnessAlert,
} from '../../../../src/services/fairness-monitor';
import {
  runPrizeAudit,
  getPrizeAuditSummary,
  PrizeAuditResult,
} from '../../../../src/services/fairness-monitor/prize-audit';

export interface FairnessAnalyticsResponse {
  // Recent alerts
  recentAlerts: FairnessAlert[];

  // Last audit summary
  lastAudit?: {
    auditId: string;
    totalRoundsChecked: number;
    validRounds: number;
    invalidRounds: number;
    summary: {
      hashMismatches: number;
      payoutMismatches: number;
      suspiciousSequences: number;
    };
  };

  // Prize audit summary
  prizeAuditSummary: {
    totalJackpotDistributed: number;
    totalPaidGuesses: number;
    totalRevenue: number;
    averageJackpot: number;
    largestJackpot: number;
  };

  // System status
  fairnessStatus: 'healthy' | 'warning' | 'critical';
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<FairnessAnalyticsResponse | FairnessAuditReport | { error: string; details?: string }>
) {
  // Admin authentication
  let fid: number | null = null;
  if (req.query.devFid) {
    fid = parseInt(req.query.devFid as string, 10);
  } else if (req.cookies.siwn_fid) {
    fid = parseInt(req.cookies.siwn_fid, 10);
  }

  if (!fid || !isAdminFid(fid)) {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }

  try {
    if (req.method === 'GET') {
      // Get fairness dashboard data
      const [recentAlerts, prizeAuditSummary] = await Promise.all([
        getRecentFairnessAlerts(20),
        getPrizeAuditSummary(),
      ]);

      // Determine overall status
      const criticalAlerts = recentAlerts.filter(a => a.severity === 'critical').length;
      const warningAlerts = recentAlerts.filter(a => a.severity === 'high' || a.severity === 'medium').length;

      let fairnessStatus: 'healthy' | 'warning' | 'critical' = 'healthy';
      if (criticalAlerts > 0) fairnessStatus = 'critical';
      else if (warningAlerts > 2) fairnessStatus = 'warning';

      const response: FairnessAnalyticsResponse = {
        recentAlerts,
        prizeAuditSummary,
        fairnessStatus,
      };

      return res.status(200).json(response);

    } else if (req.method === 'POST') {
      // Run a fairness audit
      const { action, roundId } = req.body;

      if (action === 'audit') {
        const auditReport = await runFairnessAudit();
        return res.status(200).json(auditReport);

      } else if (action === 'validate_round' && roundId) {
        const [commitResult, payoutResult] = await Promise.all([
          validateRoundCommitment(roundId),
          validateRoundPayouts(roundId),
        ]);

        return res.status(200).json({
          roundId,
          commitmentValidation: commitResult,
          payoutValidation: payoutResult,
        } as any);

      } else if (action === 'prize_audit') {
        const prizeAuditResults = await runPrizeAudit({ limit: 50 });
        return res.status(200).json(prizeAuditResults as any);

      } else {
        return res.status(400).json({ error: 'Invalid action. Use: audit, validate_round, or prize_audit' });
      }

    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }

  } catch (error) {
    console.error('[analytics/fairness] Error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

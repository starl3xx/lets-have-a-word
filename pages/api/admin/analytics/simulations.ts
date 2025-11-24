/**
 * Simulations API
 * Milestone 5.3: Advanced analytics & fairness systems
 *
 * Provides:
 * - Run adversarial simulations
 * - View simulation results
 * - Get simulation reports
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from '../me';
import {
  runWalletClusteringSimulation,
  runRapidWinnerSimulation,
  runFrontRunRiskSimulation,
  runJackpotRunwaySimulation,
  runFullSimulationSuite,
  WalletClusterResult,
  RapidWinnerResult,
  FrontRunRiskResult,
  RunwayResult,
} from '../../../../src/services/simulation-engine';

export type SimulationType = 'wallet_clustering' | 'rapid_winner' | 'frontrun_risk' | 'jackpot_runway' | 'full_suite';

export interface SimulationRequest {
  type: SimulationType;
  options?: {
    lookbackRounds?: number;
    minWinsToFlag?: number;
    projectRounds?: number;
    scenarios?: Array<'optimistic' | 'baseline' | 'pessimistic' | 'stress'>;
  };
}

export interface SimulationResponse {
  success: boolean;
  type: SimulationType;
  result: WalletClusterResult | RapidWinnerResult | FrontRunRiskResult | RunwayResult | {
    walletClustering: WalletClusterResult;
    rapidWinner: RapidWinnerResult;
    frontRunRisk: FrontRunRiskResult;
    jackpotRunway: RunwayResult;
    overallStatus: string;
    summary: string;
  };
  executionTimeMs: number;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SimulationResponse | { error: string; details?: string }>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST to run simulations.' });
  }

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
    const { type, options } = req.body as SimulationRequest;

    if (!type) {
      return res.status(400).json({
        error: 'Missing simulation type. Use: wallet_clustering, rapid_winner, frontrun_risk, jackpot_runway, or full_suite',
      });
    }

    const startTime = Date.now();
    let result: any;

    switch (type) {
      case 'wallet_clustering':
        result = await runWalletClusteringSimulation();
        break;

      case 'rapid_winner':
        result = await runRapidWinnerSimulation({
          lookbackRounds: options?.lookbackRounds,
          minWinsToFlag: options?.minWinsToFlag,
        });
        break;

      case 'frontrun_risk':
        result = await runFrontRunRiskSimulation();
        break;

      case 'jackpot_runway':
        result = await runJackpotRunwaySimulation({
          projectRounds: options?.projectRounds,
          scenarios: options?.scenarios,
        });
        break;

      case 'full_suite':
        result = await runFullSimulationSuite();
        break;

      default:
        return res.status(400).json({
          error: `Unknown simulation type: ${type}. Use: wallet_clustering, rapid_winner, frontrun_risk, jackpot_runway, or full_suite`,
        });
    }

    const executionTimeMs = Date.now() - startTime;

    const response: SimulationResponse = {
      success: true,
      type,
      result,
      executionTimeMs,
    };

    return res.status(200).json(response);

  } catch (error) {
    console.error('[analytics/simulations] Error:', error);
    return res.status(500).json({
      error: 'Simulation failed',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

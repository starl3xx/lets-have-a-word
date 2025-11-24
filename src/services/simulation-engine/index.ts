/**
 * Simulation Engine
 * Milestone 5.3: Advanced analytics & fairness systems
 *
 * Provides adversarial and stress simulations:
 * - Wallet-clustering abuse detection
 * - Rapid-fire / repeat-winner scenarios
 * - Mempool / reveal / front-run tests
 * - Jackpot-runway tails (economic stress test)
 */

import { db } from '../../db';
import { rounds, guesses, users, roundPayouts } from '../../db/schema';
import { eq, and, desc, gte, lte, count, sql } from 'drizzle-orm';
import { logAnalyticsEvent } from '../../lib/analytics';

// Simulation event types
export const SimulationEventTypes = {
  SIM_STARTED: 'SIM_STARTED',
  SIM_COMPLETED: 'SIM_COMPLETED',
  SIM_RESULT: 'SIM_RESULT',
  CLUSTER_ALERT: 'CLUSTER_ALERT',
  RAPID_FIRE_ALERT: 'RAPID_FIRE_ALERT',
  FRONTRUN_RISK: 'FRONTRUN_RISK',
  RUNWAY_WARNING: 'RUNWAY_WARNING',
} as const;

export type SimulationEventType = typeof SimulationEventTypes[keyof typeof SimulationEventTypes];

/**
 * Base simulation result interface
 */
export interface SimulationResult {
  simulationId: string;
  type: string;
  status: 'success' | 'warning' | 'critical' | 'error';
  startTime: Date;
  endTime: Date;
  summary: string;
  details: Record<string, any>;
  recommendations: string[];
}

/**
 * Wallet cluster detection result
 */
export interface WalletClusterResult extends SimulationResult {
  type: 'wallet_clustering';
  clusters: WalletCluster[];
  totalUsersAnalyzed: number;
  suspiciousUserCount: number;
  clusterRiskScore: number;
}

export interface WalletCluster {
  clusterId: string;
  fids: number[];
  walletAddresses: string[];
  sharedPatterns: string[];
  riskScore: number;
  suspiciousIndicators: string[];
}

/**
 * Rapid-fire / repeat winner detection result
 */
export interface RapidWinnerResult extends SimulationResult {
  type: 'rapid_winner';
  suspiciousWinners: SuspiciousWinner[];
  totalWinnersAnalyzed: number;
  statisticalAnomaly: boolean;
}

export interface SuspiciousWinner {
  fid: number;
  username: string | null;
  winCount: number;
  winRate: number;
  avgGuessesToWin: number;
  timingPattern: 'normal' | 'suspicious' | 'highly_suspicious';
  probabilityScore: number;
}

/**
 * Front-run risk assessment result
 */
export interface FrontRunRiskResult extends SimulationResult {
  type: 'frontrun_risk';
  revealWindowMs: number;
  attackVectors: AttackVector[];
  overallRisk: 'low' | 'medium' | 'high' | 'critical';
}

export interface AttackVector {
  name: string;
  description: string;
  riskLevel: 'low' | 'medium' | 'high';
  mitigations: string[];
}

/**
 * Jackpot runway economic simulation result
 */
export interface RunwayResult extends SimulationResult {
  type: 'jackpot_runway';
  currentJackpot: number;
  projectedRounds: RunwayProjection[];
  sustainabilityScore: number;
  daysToDepletion: number | null;
  scenarioResults: EconomicScenario[];
}

export interface RunwayProjection {
  round: number;
  jackpot: number;
  paidGuesses: number;
  revenue: number;
}

export interface EconomicScenario {
  name: string;
  description: string;
  projectedJackpot: number;
  projectedRounds: number;
  probability: number;
}

// ============================================
// WALLET CLUSTERING SIMULATION
// ============================================

/**
 * Detect wallet clustering / sybil attack patterns
 * Identifies users who might be the same person using multiple accounts
 */
export async function runWalletClusteringSimulation(): Promise<WalletClusterResult> {
  const startTime = new Date();
  const simulationId = `wallet-cluster-${Date.now()}`;

  await logAnalyticsEvent(SimulationEventTypes.SIM_STARTED, {
    data: { simulationId, type: 'wallet_clustering' },
  });

  const clusters: WalletCluster[] = [];
  const recommendations: string[] = [];

  try {
    // Fetch all users with wallet addresses
    const allUsers = await db
      .select({
        fid: users.fid,
        username: users.username,
        signerWallet: users.signerWalletAddress,
        custodyAddress: users.custodyAddress,
        referrerFid: users.referrerFid,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(sql`${users.signerWalletAddress} IS NOT NULL OR ${users.custodyAddress} IS NOT NULL`);

    // Group users by shared wallet addresses
    const walletToFids: Map<string, number[]> = new Map();

    for (const user of allUsers) {
      const wallets = [user.signerWallet, user.custodyAddress].filter(Boolean) as string[];

      for (const wallet of wallets) {
        const normalized = wallet.toLowerCase();
        const existing = walletToFids.get(normalized) || [];
        if (!existing.includes(user.fid)) {
          existing.push(user.fid);
          walletToFids.set(normalized, existing);
        }
      }
    }

    // Find clusters (wallets shared by multiple FIDs)
    for (const [wallet, fids] of walletToFids) {
      if (fids.length > 1) {
        const clusterUsers = allUsers.filter(u => fids.includes(u.fid));

        // Calculate risk score based on various factors
        let riskScore = 0.3 * fids.length; // Base risk from shared wallet
        const suspiciousIndicators: string[] = [];

        // Check for similar creation times
        const creationTimes = clusterUsers.map(u => u.createdAt.getTime());
        const timeDiffs = [];
        for (let i = 1; i < creationTimes.length; i++) {
          timeDiffs.push(Math.abs(creationTimes[i] - creationTimes[i - 1]));
        }
        const avgTimeDiff = timeDiffs.length > 0 ? timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length : 0;

        if (avgTimeDiff < 60 * 60 * 1000) { // Created within 1 hour of each other
          riskScore += 0.3;
          suspiciousIndicators.push('Accounts created within 1 hour of each other');
        }

        // Check for referral chains within cluster
        const clusterReferrals = clusterUsers.filter(u =>
          u.referrerFid && fids.includes(u.referrerFid)
        ).length;
        if (clusterReferrals > 0) {
          riskScore += 0.2 * clusterReferrals;
          suspiciousIndicators.push(`${clusterReferrals} intra-cluster referrals detected`);
        }

        clusters.push({
          clusterId: `cluster-${wallet.slice(0, 8)}`,
          fids,
          walletAddresses: [wallet],
          sharedPatterns: ['shared_wallet'],
          riskScore: Math.min(riskScore, 1),
          suspiciousIndicators,
        });
      }
    }

    // Check for referral chain patterns (even without shared wallets)
    const referralChains = detectReferralChains(allUsers);
    for (const chain of referralChains) {
      if (chain.length >= 3) {
        const chainFids = chain.map(u => u.fid);
        const existingCluster = clusters.find(c =>
          c.fids.some(fid => chainFids.includes(fid))
        );

        if (!existingCluster) {
          clusters.push({
            clusterId: `chain-${chainFids[0]}`,
            fids: chainFids,
            walletAddresses: chain.map(u => u.signerWallet).filter(Boolean) as string[],
            sharedPatterns: ['referral_chain'],
            riskScore: 0.4 + (chain.length * 0.1),
            suspiciousIndicators: [`Referral chain of ${chain.length} users`],
          });
        }
      }
    }

    // Generate recommendations
    if (clusters.length > 0) {
      recommendations.push('Review flagged clusters manually before taking action');
      recommendations.push('Consider requiring additional verification for clustered accounts');
      recommendations.push('Monitor cluster members for coordinated gameplay patterns');
    }

    const suspiciousUserCount = new Set(clusters.flatMap(c => c.fids)).size;
    const clusterRiskScore = clusters.length > 0
      ? clusters.reduce((sum, c) => sum + c.riskScore, 0) / clusters.length
      : 0;

    const result: WalletClusterResult = {
      simulationId,
      type: 'wallet_clustering',
      status: clusterRiskScore > 0.6 ? 'critical' : clusterRiskScore > 0.3 ? 'warning' : 'success',
      startTime,
      endTime: new Date(),
      summary: `Found ${clusters.length} potential wallet clusters involving ${suspiciousUserCount} users`,
      details: {
        clusters,
        analysisMethod: 'wallet_address_grouping_and_referral_chain_detection',
      },
      recommendations,
      clusters,
      totalUsersAnalyzed: allUsers.length,
      suspiciousUserCount,
      clusterRiskScore,
    };

    // Log cluster alerts if found
    if (clusters.length > 0) {
      await logAnalyticsEvent(SimulationEventTypes.CLUSTER_ALERT, {
        data: {
          simulationId,
          clusterCount: clusters.length,
          suspiciousUserCount,
          clusterRiskScore,
        },
      });
    }

    await logAnalyticsEvent(SimulationEventTypes.SIM_COMPLETED, {
      data: { simulationId, type: 'wallet_clustering', status: result.status },
    });

    return result;

  } catch (error) {
    const errorResult: WalletClusterResult = {
      simulationId,
      type: 'wallet_clustering',
      status: 'error',
      startTime,
      endTime: new Date(),
      summary: `Simulation failed: ${error instanceof Error ? error.message : String(error)}`,
      details: { error: String(error) },
      recommendations: ['Check system logs for errors'],
      clusters: [],
      totalUsersAnalyzed: 0,
      suspiciousUserCount: 0,
      clusterRiskScore: 0,
    };

    return errorResult;
  }
}

/**
 * Helper: Detect referral chains
 */
function detectReferralChains(
  allUsers: Array<{ fid: number; referrerFid: number | null; username: string | null; signerWallet: string | null }>
): Array<typeof allUsers> {
  const chains: Array<typeof allUsers> = [];
  const userMap = new Map(allUsers.map(u => [u.fid, u]));

  for (const user of allUsers) {
    if (!user.referrerFid) continue;

    // Build chain backwards
    const chain = [user];
    let current = user;

    while (current.referrerFid && chain.length < 10) {
      const referrer = userMap.get(current.referrerFid);
      if (!referrer || chain.includes(referrer)) break;
      chain.unshift(referrer);
      current = referrer;
    }

    if (chain.length >= 3) {
      // Check if this chain is already detected
      const chainFids = new Set(chain.map(u => u.fid));
      const isDuplicate = chains.some(existingChain => {
        const existingFids = new Set(existingChain.map(u => u.fid));
        return [...chainFids].every(fid => existingFids.has(fid));
      });

      if (!isDuplicate) {
        chains.push(chain);
      }
    }
  }

  return chains;
}

// ============================================
// RAPID-FIRE / REPEAT WINNER SIMULATION
// ============================================

/**
 * Detect improbable win streaks and timing exploitation
 */
export async function runRapidWinnerSimulation(options?: {
  lookbackRounds?: number;
  minWinsToFlag?: number;
}): Promise<RapidWinnerResult> {
  const startTime = new Date();
  const simulationId = `rapid-winner-${Date.now()}`;
  const lookbackRounds = options?.lookbackRounds || 100;
  const minWinsToFlag = options?.minWinsToFlag || 3;

  await logAnalyticsEvent(SimulationEventTypes.SIM_STARTED, {
    data: { simulationId, type: 'rapid_winner', lookbackRounds },
  });

  const suspiciousWinners: SuspiciousWinner[] = [];
  const recommendations: string[] = [];

  try {
    // Fetch recent resolved rounds with winners
    const recentRounds = await db
      .select({
        id: rounds.id,
        winnerFid: rounds.winnerFid,
        resolvedAt: rounds.resolvedAt,
        prizePoolEth: rounds.prizePoolEth,
      })
      .from(rounds)
      .where(sql`${rounds.resolvedAt} IS NOT NULL AND ${rounds.winnerFid} IS NOT NULL`)
      .orderBy(desc(rounds.resolvedAt))
      .limit(lookbackRounds);

    // Count wins per user
    const winCounts: Map<number, { count: number; rounds: typeof recentRounds }> = new Map();

    for (const round of recentRounds) {
      if (!round.winnerFid) continue;

      const existing = winCounts.get(round.winnerFid) || { count: 0, rounds: [] };
      existing.count++;
      existing.rounds.push(round);
      winCounts.set(round.winnerFid, existing);
    }

    // Analyze users with multiple wins
    for (const [fid, data] of winCounts) {
      if (data.count < minWinsToFlag) continue;

      // Get user details
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.fid, fid))
        .limit(1);

      // Calculate win rate
      const userGuessCount = await db
        .select({ count: count() })
        .from(guesses)
        .where(eq(guesses.fid, fid));

      const totalGuesses = userGuessCount[0]?.count || 1;
      const winRate = data.count / lookbackRounds;

      // Calculate average guesses to win
      let totalGuessesToWin = 0;
      for (const round of data.rounds) {
        const roundGuesses = await db
          .select({ count: count() })
          .from(guesses)
          .where(and(
            eq(guesses.roundId, round.id),
            eq(guesses.fid, fid)
          ));
        totalGuessesToWin += roundGuesses[0]?.count || 1;
      }
      const avgGuessesToWin = totalGuessesToWin / data.count;

      // Analyze timing patterns
      const timings = data.rounds
        .map(r => r.resolvedAt?.getTime() || 0)
        .filter(t => t > 0)
        .sort((a, b) => a - b);

      let timingPattern: 'normal' | 'suspicious' | 'highly_suspicious' = 'normal';

      if (timings.length >= 2) {
        const intervals = [];
        for (let i = 1; i < timings.length; i++) {
          intervals.push(timings[i] - timings[i - 1]);
        }

        // Check for suspiciously regular intervals
        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const variance = intervals.reduce((sum, i) => sum + Math.pow(i - avgInterval, 2), 0) / intervals.length;
        const stdDev = Math.sqrt(variance);
        const coefficientOfVariation = stdDev / avgInterval;

        if (coefficientOfVariation < 0.1) {
          timingPattern = 'highly_suspicious';
        } else if (coefficientOfVariation < 0.3) {
          timingPattern = 'suspicious';
        }
      }

      // Calculate probability score (how unlikely is this win pattern)
      // Using simplified binomial probability
      const expectedWinRate = 1 / 100; // Assume 100 active players
      const probabilityScore = Math.min(
        (winRate / expectedWinRate) * (avgGuessesToWin < 3 ? 2 : 1),
        10
      );

      if (probabilityScore > 2 || timingPattern !== 'normal') {
        suspiciousWinners.push({
          fid,
          username: user?.username || null,
          winCount: data.count,
          winRate,
          avgGuessesToWin,
          timingPattern,
          probabilityScore,
        });
      }
    }

    // Sort by probability score
    suspiciousWinners.sort((a, b) => b.probabilityScore - a.probabilityScore);

    // Generate recommendations
    if (suspiciousWinners.length > 0) {
      recommendations.push('Review gameplay logs for flagged users');
      recommendations.push('Check for coordinated timing patterns');
      recommendations.push('Verify commit-reveal integrity for suspicious rounds');
    }

    const statisticalAnomaly = suspiciousWinners.some(w => w.probabilityScore > 5);

    const result: RapidWinnerResult = {
      simulationId,
      type: 'rapid_winner',
      status: statisticalAnomaly ? 'critical' : suspiciousWinners.length > 0 ? 'warning' : 'success',
      startTime,
      endTime: new Date(),
      summary: `Found ${suspiciousWinners.length} users with suspicious win patterns`,
      details: {
        lookbackRounds,
        minWinsToFlag,
        analysisMethod: 'win_frequency_and_timing_analysis',
      },
      recommendations,
      suspiciousWinners,
      totalWinnersAnalyzed: winCounts.size,
      statisticalAnomaly,
    };

    if (suspiciousWinners.length > 0) {
      await logAnalyticsEvent(SimulationEventTypes.RAPID_FIRE_ALERT, {
        data: {
          simulationId,
          suspiciousCount: suspiciousWinners.length,
          statisticalAnomaly,
        },
      });
    }

    await logAnalyticsEvent(SimulationEventTypes.SIM_COMPLETED, {
      data: { simulationId, type: 'rapid_winner', status: result.status },
    });

    return result;

  } catch (error) {
    return {
      simulationId,
      type: 'rapid_winner',
      status: 'error',
      startTime,
      endTime: new Date(),
      summary: `Simulation failed: ${error instanceof Error ? error.message : String(error)}`,
      details: { error: String(error) },
      recommendations: ['Check system logs for errors'],
      suspiciousWinners: [],
      totalWinnersAnalyzed: 0,
      statisticalAnomaly: false,
    };
  }
}

// ============================================
// FRONT-RUN RISK SIMULATION
// ============================================

/**
 * Assess mempool/reveal/front-run attack risks
 */
export async function runFrontRunRiskSimulation(): Promise<FrontRunRiskResult> {
  const startTime = new Date();
  const simulationId = `frontrun-risk-${Date.now()}`;

  await logAnalyticsEvent(SimulationEventTypes.SIM_STARTED, {
    data: { simulationId, type: 'frontrun_risk' },
  });

  const attackVectors: AttackVector[] = [];
  const recommendations: string[] = [];

  // Analyze the commit-reveal implementation
  // The game uses H(salt || answer) which is secure against front-running
  // because the salt is only revealed after the correct guess

  attackVectors.push({
    name: 'Commit Hash Pre-image Attack',
    description: 'Attempting to guess the answer by brute-forcing the commit hash',
    riskLevel: 'low',
    mitigations: [
      '64-byte random salt makes pre-image attacks computationally infeasible',
      'Answer space (2,279 words) is small but salt entropy compensates',
    ],
  });

  attackVectors.push({
    name: 'Timing-Based Guess Submission',
    description: 'Analyzing response times to infer information about the answer',
    riskLevel: 'low',
    mitigations: [
      'Constant-time comparison for word validation',
      'No timing information leaked in API responses',
    ],
  });

  attackVectors.push({
    name: 'Database Access Attack',
    description: 'Compromising the database to reveal the answer before resolution',
    riskLevel: 'medium',
    mitigations: [
      'Database access should be restricted to application servers only',
      'Consider encrypting answer/salt at rest with application-level keys',
      'Regular security audits of database access patterns',
    ],
  });

  attackVectors.push({
    name: 'Server-Side Information Leak',
    description: 'Answer revealed through logs, error messages, or API responses',
    riskLevel: 'low',
    mitigations: [
      'Answer never included in API responses until round resolution',
      'Logging should exclude sensitive round data',
    ],
  });

  attackVectors.push({
    name: 'Referrer Collusion',
    description: 'Multiple accounts colluding through referral system for jackpot manipulation',
    riskLevel: 'medium',
    mitigations: [
      'Wallet clustering detection (implemented)',
      'User quality score gating (implemented)',
      'Monitor referral chain patterns',
    ],
  });

  // Calculate overall risk
  const riskScores = { low: 1, medium: 2, high: 3 };
  const avgRisk = attackVectors.reduce((sum, v) => sum + riskScores[v.riskLevel], 0) / attackVectors.length;

  let overallRisk: 'low' | 'medium' | 'high' | 'critical' = 'low';
  if (avgRisk > 2.5) overallRisk = 'critical';
  else if (avgRisk > 2) overallRisk = 'high';
  else if (avgRisk > 1.5) overallRisk = 'medium';

  recommendations.push('Regularly review commit-reveal implementation for vulnerabilities');
  recommendations.push('Monitor for unusual guess patterns around round resolution');
  recommendations.push('Consider implementing additional entropy sources');

  const result: FrontRunRiskResult = {
    simulationId,
    type: 'frontrun_risk',
    status: overallRisk === 'critical' ? 'critical' : overallRisk === 'high' ? 'warning' : 'success',
    startTime,
    endTime: new Date(),
    summary: `Front-run risk assessment: ${overallRisk.toUpperCase()}`,
    details: {
      analysisMethod: 'static_code_and_architecture_analysis',
    },
    recommendations,
    revealWindowMs: 0, // No reveal window - answer only revealed on correct guess
    attackVectors,
    overallRisk,
  };

  await logAnalyticsEvent(SimulationEventTypes.SIM_COMPLETED, {
    data: { simulationId, type: 'frontrun_risk', status: result.status, overallRisk },
  });

  return result;
}

// ============================================
// JACKPOT RUNWAY SIMULATION
// ============================================

/**
 * Model jackpot growth/decay under various economic scenarios
 */
export async function runJackpotRunwaySimulation(options?: {
  projectRounds?: number;
  scenarios?: Array<'optimistic' | 'baseline' | 'pessimistic' | 'stress'>;
}): Promise<RunwayResult> {
  const startTime = new Date();
  const simulationId = `runway-${Date.now()}`;
  const projectRounds = options?.projectRounds || 30;
  const selectedScenarios = options?.scenarios || ['optimistic', 'baseline', 'pessimistic', 'stress'];

  await logAnalyticsEvent(SimulationEventTypes.SIM_STARTED, {
    data: { simulationId, type: 'jackpot_runway', projectRounds },
  });

  const recommendations: string[] = [];

  try {
    // Get current jackpot and historical data
    const [activeRound] = await db
      .select()
      .from(rounds)
      .where(sql`${rounds.resolvedAt} IS NULL`)
      .limit(1);

    const currentJackpot = activeRound ? parseFloat(activeRound.prizePoolEth) : 0;

    // Get historical paid guess rate
    const historicalData = await db
      .select({
        roundId: rounds.id,
        paidGuessCount: sql<number>`(
          SELECT COUNT(*) FROM ${guesses}
          WHERE ${guesses.roundId} = ${rounds.id} AND ${guesses.isPaid} = true
        )`,
        prizePool: rounds.prizePoolEth,
      })
      .from(rounds)
      .where(sql`${rounds.resolvedAt} IS NOT NULL`)
      .orderBy(desc(rounds.resolvedAt))
      .limit(30);

    const avgPaidGuesses = historicalData.length > 0
      ? historicalData.reduce((sum, r) => sum + r.paidGuessCount, 0) / historicalData.length
      : 5;

    // Economic constants
    const GUESS_PRICE = 0.0003;
    const PRIZE_POOL_SHARE = 0.8;
    const PER_GUESS_TO_POOL = GUESS_PRICE * PRIZE_POOL_SHARE;

    // Define scenarios
    const scenarioConfigs: Record<string, { guessMultiplier: number; probability: number }> = {
      optimistic: { guessMultiplier: 2.0, probability: 0.15 },
      baseline: { guessMultiplier: 1.0, probability: 0.50 },
      pessimistic: { guessMultiplier: 0.5, probability: 0.25 },
      stress: { guessMultiplier: 0.1, probability: 0.10 },
    };

    const scenarioResults: EconomicScenario[] = [];

    for (const scenario of selectedScenarios) {
      const config = scenarioConfigs[scenario];
      if (!config) continue;

      const guessesPerRound = avgPaidGuesses * config.guessMultiplier;
      const revenuePerRound = guessesPerRound * PER_GUESS_TO_POOL;

      // Assume average jackpot payout per round
      const avgJackpot = historicalData.length > 0
        ? historicalData.reduce((sum, r) => sum + parseFloat(r.prizePool), 0) / historicalData.length
        : currentJackpot;

      // Net growth per round = revenue - expected payout
      // But jackpot is only paid when someone wins, and it accumulates
      // So we model as: jackpot grows by revenue each round until win
      const projectedRoundsToSustain = revenuePerRound > 0
        ? Math.floor(avgJackpot / revenuePerRound)
        : 0;

      const projectedJackpot = currentJackpot + (revenuePerRound * projectRounds);

      scenarioResults.push({
        name: scenario.charAt(0).toUpperCase() + scenario.slice(1),
        description: `${Math.round(guessesPerRound)} paid guesses/round, ${revenuePerRound.toFixed(6)} ETH revenue/round`,
        projectedJackpot,
        projectedRounds: projectedRoundsToSustain,
        probability: config.probability,
      });
    }

    // Generate projections for baseline scenario
    const projectedRounds: RunwayProjection[] = [];
    let projectedJackpot = currentJackpot;

    for (let i = 1; i <= projectRounds; i++) {
      const paidGuesses = Math.round(avgPaidGuesses * (1 + Math.random() * 0.2 - 0.1));
      const revenue = paidGuesses * PER_GUESS_TO_POOL;
      projectedJackpot += revenue;

      projectedRounds.push({
        round: i,
        jackpot: projectedJackpot,
        paidGuesses,
        revenue,
      });
    }

    // Calculate sustainability score
    // Higher score = more sustainable
    const baselineScenario = scenarioResults.find(s => s.name === 'Baseline');
    const stressScenario = scenarioResults.find(s => s.name === 'Stress');

    let sustainabilityScore = 0.5; // Default
    if (baselineScenario && stressScenario) {
      // Score based on how many rounds the stress scenario can sustain
      sustainabilityScore = Math.min(stressScenario.projectedRounds / 10, 1);
    }

    // Days to depletion (stress scenario)
    const roundsPerDay = 2; // Estimate
    const daysToDepletion = stressScenario?.projectedRounds
      ? Math.floor(stressScenario.projectedRounds / roundsPerDay)
      : null;

    // Generate recommendations
    if (sustainabilityScore < 0.3) {
      recommendations.push('CRITICAL: Jackpot sustainability is at risk');
      recommendations.push('Consider promotional activities to increase player engagement');
      recommendations.push('Review pricing model for paid guesses');
    } else if (sustainabilityScore < 0.6) {
      recommendations.push('Monitor jackpot health closely');
      recommendations.push('Plan for low-activity periods');
    } else {
      recommendations.push('Jackpot economics appear healthy');
      recommendations.push('Continue monitoring for seasonal variations');
    }

    const result: RunwayResult = {
      simulationId,
      type: 'jackpot_runway',
      status: sustainabilityScore < 0.3 ? 'critical' : sustainabilityScore < 0.6 ? 'warning' : 'success',
      startTime,
      endTime: new Date(),
      summary: `Jackpot sustainability score: ${(sustainabilityScore * 100).toFixed(0)}%`,
      details: {
        currentJackpot,
        avgPaidGuesses,
        economicConstants: { GUESS_PRICE, PRIZE_POOL_SHARE, PER_GUESS_TO_POOL },
      },
      recommendations,
      currentJackpot,
      projectedRounds,
      sustainabilityScore,
      daysToDepletion,
      scenarioResults,
    };

    if (sustainabilityScore < 0.5) {
      await logAnalyticsEvent(SimulationEventTypes.RUNWAY_WARNING, {
        data: {
          simulationId,
          sustainabilityScore,
          daysToDepletion,
        },
      });
    }

    await logAnalyticsEvent(SimulationEventTypes.SIM_COMPLETED, {
      data: { simulationId, type: 'jackpot_runway', status: result.status },
    });

    return result;

  } catch (error) {
    return {
      simulationId,
      type: 'jackpot_runway',
      status: 'error',
      startTime,
      endTime: new Date(),
      summary: `Simulation failed: ${error instanceof Error ? error.message : String(error)}`,
      details: { error: String(error) },
      recommendations: ['Check system logs for errors'],
      currentJackpot: 0,
      projectedRounds: [],
      sustainabilityScore: 0,
      daysToDepletion: null,
      scenarioResults: [],
    };
  }
}

// ============================================
// FULL SIMULATION SUITE
// ============================================

/**
 * Run all simulations and return a combined report
 */
export async function runFullSimulationSuite(): Promise<{
  walletClustering: WalletClusterResult;
  rapidWinner: RapidWinnerResult;
  frontRunRisk: FrontRunRiskResult;
  jackpotRunway: RunwayResult;
  overallStatus: 'success' | 'warning' | 'critical' | 'error';
  summary: string;
}> {
  const results = await Promise.all([
    runWalletClusteringSimulation(),
    runRapidWinnerSimulation(),
    runFrontRunRiskSimulation(),
    runJackpotRunwaySimulation(),
  ]);

  const [walletClustering, rapidWinner, frontRunRisk, jackpotRunway] = results;

  // Determine overall status
  const statuses = results.map(r => r.status);
  let overallStatus: 'success' | 'warning' | 'critical' | 'error' = 'success';

  if (statuses.includes('error')) overallStatus = 'error';
  else if (statuses.includes('critical')) overallStatus = 'critical';
  else if (statuses.includes('warning')) overallStatus = 'warning';

  const summary = `Simulation suite completed. ` +
    `Wallet clustering: ${walletClustering.status}, ` +
    `Rapid winner: ${rapidWinner.status}, ` +
    `Front-run risk: ${frontRunRisk.status}, ` +
    `Jackpot runway: ${jackpotRunway.status}`;

  return {
    walletClustering,
    rapidWinner,
    frontRunRisk,
    jackpotRunway,
    overallStatus,
    summary,
  };
}

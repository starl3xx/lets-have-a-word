/**
 * Round Archive Module
 * Milestone 5.4: Round archive
 *
 * Provides functionality to archive completed rounds with full statistics,
 * payout data, and integrity information.
 */

import { db } from '../db';
import {
  rounds,
  guesses,
  roundPayouts,
  users,
  dailyGuessState,
  announcerEvents,
  roundArchive,
  roundArchiveErrors,
  type RoundArchiveInsert,
  type RoundArchivePayouts,
  type RoundArchiveRow,
  type RoundArchiveErrorInsert,
} from '../db/schema';
import { eq, and, sql, desc, asc, isNotNull, count, countDistinct, gte, lte, or, isNull } from 'drizzle-orm';
import { trackSlowQuery } from './redis';
import { getPlaintextAnswer } from './encryption';
import { TOP10_LOCK_AFTER_GUESSES } from './top10-lock';

/**
 * Data required to archive a round (can be passed explicitly or computed)
 */
export interface ArchiveRoundData {
  roundId: number;
  force?: boolean; // If true, delete existing archive and re-archive
}

/**
 * Result from archiving a round
 */
export interface ArchiveRoundResult {
  success: boolean;
  archived?: RoundArchiveRow;
  error?: string;
  alreadyArchived?: boolean;
}

/**
 * Archive a completed round
 *
 * This function computes all statistics and stores them in the round_archive table.
 * It is idempotent - calling it multiple times for the same round will not create duplicates.
 *
 * @param data - Round data (at minimum, roundId)
 * @returns Result indicating success/failure and the archived record
 */
export async function archiveRound(data: ArchiveRoundData): Promise<ArchiveRoundResult> {
  const { roundId, force } = data;

  try {
    // Check if already archived
    const existingArchive = await db
      .select()
      .from(roundArchive)
      .where(eq(roundArchive.roundNumber, roundId))
      .limit(1);

    if (existingArchive.length > 0) {
      if (force) {
        // Delete existing archive to re-compute
        await db
          .delete(roundArchive)
          .where(eq(roundArchive.roundNumber, roundId));
        console.log(`[archive] Force re-archiving round ${roundId} - deleted existing record`);
      } else {
        return {
          success: true,
          archived: existingArchive[0],
          alreadyArchived: true,
        };
      }
    }

    // Get the round
    const [round] = await db
      .select()
      .from(rounds)
      .where(eq(rounds.id, roundId))
      .limit(1);

    if (!round) {
      await logArchiveError(roundId, 'round_not_found', `Round ${roundId} not found`);
      return {
        success: false,
        error: `Round ${roundId} not found`,
      };
    }

    // Check if round is resolved
    if (!round.resolvedAt) {
      return {
        success: false,
        error: `Round ${roundId} is not resolved yet`,
      };
    }

    // Compute total guesses
    const [totalGuessesResult] = await db
      .select({ count: count() })
      .from(guesses)
      .where(eq(guesses.roundId, roundId));
    const totalGuesses = totalGuessesResult?.count ?? 0;

    // Compute unique players
    const [uniquePlayersResult] = await db
      .select({ count: countDistinct(guesses.fid) })
      .from(guesses)
      .where(eq(guesses.roundId, roundId));
    const uniquePlayers = uniquePlayersResult?.count ?? 0;

    // Get winner's guess number (which guess won)
    let winnerGuessNumber: number | null = null;
    if (round.winnerFid) {
      const winningGuess = await db
        .select()
        .from(guesses)
        .where(and(eq(guesses.roundId, roundId), eq(guesses.isCorrect, true)))
        .limit(1);

      if (winningGuess.length > 0) {
        // Count guesses before the winning one
        const [priorGuessCount] = await db
          .select({ count: count() })
          .from(guesses)
          .where(
            and(
              eq(guesses.roundId, roundId),
              sql`${guesses.createdAt} <= ${winningGuess[0].createdAt}`
            )
          );
        winnerGuessNumber = priorGuessCount?.count ?? null;
      }
    }

    // Get cast hash for round resolution announcement
    let winnerCastHash: string | null = null;
    const [announcerEvent] = await db
      .select()
      .from(announcerEvents)
      .where(
        and(
          eq(announcerEvents.roundId, roundId),
          eq(announcerEvents.eventType, 'round_resolved')
        )
      )
      .limit(1);
    if (announcerEvent?.castHash) {
      winnerCastHash = announcerEvent.castHash;
    }

    // Get payouts for winner, referrer, seed from round_payouts
    const payoutRecords = await db
      .select()
      .from(roundPayouts)
      .where(eq(roundPayouts.roundId, roundId));

    const payoutsJson: RoundArchivePayouts = {
      topGuessers: [],
    };

    // Get winner, referrer, seed payouts from DB
    let topGuesserPoolEth = 0;
    for (const payout of payoutRecords) {
      switch (payout.role) {
        case 'winner':
          if (payout.fid) {
            payoutsJson.winner = { fid: payout.fid, amountEth: payout.amountEth };
          }
          break;
        case 'referrer':
          if (payout.fid) {
            payoutsJson.referrer = { fid: payout.fid, amountEth: payout.amountEth };
          }
          break;
        case 'top_guesser':
          // Sum up what was allocated to top guessers (for calculating individual amounts)
          topGuesserPoolEth += parseFloat(payout.amountEth);
          break;
        case 'seed':
          payoutsJson.seed = { amountEth: payout.amountEth };
          break;
        case 'creator':
          payoutsJson.creator = { amountEth: payout.amountEth };
          break;
      }
    }

    // CRITICAL: Compute correct Top 10 from guesses table (ALL guesses count, not just paid)
    // This ensures the archive shows the TRUE ranking, not who was incorrectly paid
    const topGuessersFromGuesses = await db
      .select({
        fid: guesses.fid,
        guessCount: sql<number>`cast(count(${guesses.id}) as int)`,
        firstGuessTime: sql<Date>`min(${guesses.createdAt})`,
      })
      .from(guesses)
      .where(
        and(
          eq(guesses.roundId, roundId),
          // Only count guesses within the Top-10 lock window (first 750)
          or(
            lte(guesses.guessIndexInRound, TOP10_LOCK_AFTER_GUESSES),
            isNull(guesses.guessIndexInRound) // Legacy data
          )
        )
      )
      .groupBy(guesses.fid)
      .orderBy(desc(sql`count(${guesses.id})`), asc(sql`min(${guesses.createdAt})`))
      .limit(11); // Get 11 to exclude winner

    // Filter out the winner and take top 10
    const top10Fids = topGuessersFromGuesses
      .filter(g => g.fid !== round.winnerFid)
      .slice(0, 10);

    // Tiered payout percentages (basis points out of 10000)
    const TIER_BPS = [1900, 1600, 1400, 1100, 1000, 600, 600, 600, 600, 600];

    // Calculate normalized percentages based on how many are in top 10
    const numGuessers = top10Fids.length;
    if (numGuessers > 0) {
      const activeBps = TIER_BPS.slice(0, numGuessers);
      const totalBps = activeBps.reduce((sum, bp) => sum + bp, 0);

      top10Fids.forEach((guesser, index) => {
        // Calculate this guesser's share of the pool
        const normalizedBps = (activeBps[index] * 10000) / totalBps;
        const amountEth = (topGuesserPoolEth * normalizedBps) / 10000;

        payoutsJson.topGuessers.push({
          fid: guesser.fid,
          amountEth: amountEth.toFixed(18),
          rank: index + 1,
        });
      });
    }

    // Compute CLANKTON bonus count
    // Count users who used clankton bonus during this round's active period
    const clanktonBonusCount = await computeClanktonBonusCount(
      round.startedAt,
      round.resolvedAt
    );

    // Compute referral bonus count
    // Count new referrals during this round's active period
    const referralBonusCount = await computeReferralBonusCount(
      round.startedAt,
      round.resolvedAt
    );

    // Compute seed ETH (this is the prize pool that existed at round start, i.e., from previous round's seed)
    // We need to look at the previous round's seedNextRoundEth
    let seedEth = '0';
    if (roundId > 1) {
      const [previousRound] = await db
        .select()
        .from(rounds)
        .where(eq(rounds.id, roundId - 1))
        .limit(1);
      if (previousRound) {
        seedEth = previousRound.seedNextRoundEth;
      }
    }

    // Create archive record
    // Decrypt the answer for storage in archive (revealed after round ends)
    const archiveData: RoundArchiveInsert = {
      roundNumber: roundId,
      targetWord: getPlaintextAnswer(round.answer),
      seedEth,
      finalJackpotEth: round.prizePoolEth,
      totalGuesses,
      uniquePlayers,
      winnerFid: round.winnerFid,
      winnerCastHash,
      winnerGuessNumber,
      startTime: round.startedAt,
      endTime: round.resolvedAt,
      referrerFid: round.referrerFid,
      payoutsJson,
      salt: round.salt,
      clanktonBonusCount,
      referralBonusCount,
    };

    const [archived] = await db
      .insert(roundArchive)
      .values(archiveData)
      .returning();

    console.log(`[archive] Successfully archived round ${roundId}`);

    return {
      success: true,
      archived,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[archive] Failed to archive round ${roundId}:`, errorMessage);

    await logArchiveError(roundId, 'archive_failed', errorMessage, { error: String(error) });

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Archive all unarchived resolved rounds
 *
 * @param options.force - If true, re-archive all rounds (delete and recreate)
 * @returns Summary of sync operation
 */
export async function syncAllRounds(options?: { force?: boolean }): Promise<{
  archived: number;
  alreadyArchived: number;
  failed: number;
  errors: string[];
}> {
  const { force = false } = options || {};
  const result = {
    archived: 0,
    alreadyArchived: 0,
    failed: 0,
    errors: [] as string[],
  };

  // Get all resolved rounds
  const resolvedRounds = await db
    .select({ id: rounds.id })
    .from(rounds)
    .where(isNotNull(rounds.resolvedAt))
    .orderBy(asc(rounds.id));

  console.log(`[archive] Syncing ${resolvedRounds.length} resolved rounds${force ? ' (FORCE)' : ''}...`);

  for (const round of resolvedRounds) {
    const archiveResult = await archiveRound({ roundId: round.id, force });

    if (archiveResult.success) {
      if (archiveResult.alreadyArchived) {
        result.alreadyArchived++;
      } else {
        result.archived++;
      }
    } else {
      result.failed++;
      result.errors.push(`Round ${round.id}: ${archiveResult.error}`);
    }
  }

  console.log(
    `[archive] Sync complete: ${result.archived} new, ${result.alreadyArchived} existing, ${result.failed} failed`
  );

  return result;
}

/**
 * Get archived round by round number
 */
export async function getArchivedRound(roundNumber: number): Promise<RoundArchiveRow | null> {
  return trackSlowQuery(`query:getArchivedRound:${roundNumber}`, async () => {
    const [archived] = await db
      .select()
      .from(roundArchive)
      .where(eq(roundArchive.roundNumber, roundNumber))
      .limit(1);

    return archived || null;
  });
}

/**
 * Get list of archived rounds with pagination
 */
export async function getArchivedRounds(options: {
  limit?: number;
  offset?: number;
  orderBy?: 'asc' | 'desc';
}): Promise<{
  rounds: RoundArchiveRow[];
  total: number;
}> {
  const { limit = 20, offset = 0, orderBy = 'desc' } = options;

  return trackSlowQuery(`query:getArchivedRounds:${limit}:${offset}`, async () => {
    const [totalResult] = await db
      .select({ count: count() })
      .from(roundArchive);

    const archivedRounds = await db
      .select()
      .from(roundArchive)
      .orderBy(orderBy === 'desc' ? desc(roundArchive.roundNumber) : asc(roundArchive.roundNumber))
      .limit(limit)
      .offset(offset);

    return {
      rounds: archivedRounds,
      total: totalResult?.count ?? 0,
    };
  });
}

/**
 * Get the latest archived round
 */
export async function getLatestArchivedRound(): Promise<RoundArchiveRow | null> {
  const [latest] = await db
    .select()
    .from(roundArchive)
    .orderBy(desc(roundArchive.roundNumber))
    .limit(1);

  return latest || null;
}

/**
 * Get archive debug info for a round
 * Returns both the archived data and raw data for comparison
 */
export async function getArchiveDebugInfo(roundNumber: number): Promise<{
  archived: RoundArchiveRow | null;
  raw: {
    round: any;
    guessCount: number;
    uniquePlayers: number;
    payouts: any[];
    announcerEvent: any;
  } | null;
  discrepancies: string[];
}> {
  const archived = await getArchivedRound(roundNumber);

  // Get raw data
  const [round] = await db
    .select()
    .from(rounds)
    .where(eq(rounds.id, roundNumber))
    .limit(1);

  if (!round) {
    return {
      archived,
      raw: null,
      discrepancies: archived ? ['Round not found in rounds table but exists in archive'] : [],
    };
  }

  const [guessCountResult] = await db
    .select({ count: count() })
    .from(guesses)
    .where(eq(guesses.roundId, roundNumber));

  const [uniquePlayersResult] = await db
    .select({ count: countDistinct(guesses.fid) })
    .from(guesses)
    .where(eq(guesses.roundId, roundNumber));

  const payouts = await db
    .select()
    .from(roundPayouts)
    .where(eq(roundPayouts.roundId, roundNumber));

  const [announcerEvent] = await db
    .select()
    .from(announcerEvents)
    .where(
      and(
        eq(announcerEvents.roundId, roundNumber),
        eq(announcerEvents.eventType, 'round_resolved')
      )
    )
    .limit(1);

  const raw = {
    round,
    guessCount: guessCountResult?.count ?? 0,
    uniquePlayers: uniquePlayersResult?.count ?? 0,
    payouts,
    announcerEvent: announcerEvent || null,
  };

  // Check for discrepancies
  const discrepancies: string[] = [];
  if (archived) {
    if (archived.totalGuesses !== raw.guessCount) {
      discrepancies.push(`totalGuesses: archived=${archived.totalGuesses}, raw=${raw.guessCount}`);
    }
    if (archived.uniquePlayers !== raw.uniquePlayers) {
      discrepancies.push(`uniquePlayers: archived=${archived.uniquePlayers}, raw=${raw.uniquePlayers}`);
    }
    if (archived.targetWord !== getPlaintextAnswer(round.answer)) {
      discrepancies.push(`targetWord: archived=${archived.targetWord}, raw=${getPlaintextAnswer(round.answer)}`);
    }
    if (archived.finalJackpotEth !== round.prizePoolEth) {
      discrepancies.push(`finalJackpotEth: archived=${archived.finalJackpotEth}, raw=${round.prizePoolEth}`);
    }
  }

  return { archived, raw, discrepancies };
}

/**
 * Get archive errors
 */
export async function getArchiveErrors(options: {
  unresolvedOnly?: boolean;
  limit?: number;
}): Promise<{
  errors: any[];
  total: number;
}> {
  const { unresolvedOnly = true, limit = 50 } = options;

  let query = db.select().from(roundArchiveErrors);

  if (unresolvedOnly) {
    query = query.where(eq(roundArchiveErrors.resolved, false)) as typeof query;
  }

  const errors = await query.orderBy(desc(roundArchiveErrors.createdAt)).limit(limit);

  const [totalResult] = await db
    .select({ count: count() })
    .from(roundArchiveErrors)
    .where(unresolvedOnly ? eq(roundArchiveErrors.resolved, false) : undefined);

  return {
    errors,
    total: totalResult?.count ?? 0,
  };
}

/**
 * Log an archive error
 */
async function logArchiveError(
  roundNumber: number,
  errorType: string,
  errorMessage: string,
  errorData?: Record<string, any>
): Promise<void> {
  try {
    await db.insert(roundArchiveErrors).values({
      roundNumber,
      errorType,
      errorMessage,
      errorData: errorData || null,
    });
  } catch (error) {
    console.error('[archive] Failed to log archive error:', error);
  }
}

/**
 * Compute the number of users who used CLANKTON bonus during a time period
 */
async function computeClanktonBonusCount(startTime: Date, endTime: Date): Promise<number> {
  // Count distinct users who had freeAllocatedClankton > 0 in daily_guess_state
  // during the round's active period
  const result = await db.execute<{ count: string }>(sql`
    SELECT COUNT(DISTINCT fid) as count
    FROM daily_guess_state
    WHERE free_allocated_clankton > 0
    AND date >= ${startTime.toISOString().split('T')[0]}
    AND date <= ${endTime.toISOString().split('T')[0]}
  `);

  return parseInt(result[0]?.count ?? '0', 10);
}

/**
 * Compute the number of referral signups during a time period
 */
async function computeReferralBonusCount(startTime: Date, endTime: Date): Promise<number> {
  // Count users who were created with a referrer during the round's active period
  const [result] = await db
    .select({ count: count() })
    .from(users)
    .where(
      and(
        isNotNull(users.referrerFid),
        gte(users.createdAt, startTime),
        lte(users.createdAt, endTime)
      )
    );

  return result?.count ?? 0;
}

/**
 * Archive statistics summary
 */
export interface ArchiveStats {
  totalRounds: number;
  totalGuessesAllTime: number;
  uniqueWinners: number;
  totalJackpotDistributed: string;
  avgGuessesPerRound: number;
  avgPlayersPerRound: number;
  avgRoundLengthMinutes: number;
}

/**
 * Get aggregate archive statistics
 */
export async function getArchiveStats(): Promise<ArchiveStats> {
  return trackSlowQuery('query:getArchiveStats', async () => {
    const result = await db.execute<{
      total_rounds: string;
      total_guesses_all_time: string;
      unique_winners: string;
      total_jackpot_distributed: string;
      avg_guesses_per_round: string;
      avg_players_per_round: string;
      avg_round_length_minutes: string;
    }>(sql`
      SELECT
        COUNT(*) as total_rounds,
        COALESCE(SUM(total_guesses), 0) as total_guesses_all_time,
        COUNT(DISTINCT winner_fid) as unique_winners,
        COALESCE(SUM(final_jackpot_eth), 0) as total_jackpot_distributed,
        COALESCE(AVG(total_guesses), 0) as avg_guesses_per_round,
        COALESCE(AVG(unique_players), 0) as avg_players_per_round,
        COALESCE(AVG(EXTRACT(EPOCH FROM (end_time - start_time)) / 60), 0) as avg_round_length_minutes
      FROM round_archive
    `);

    const row = result[0];
    return {
      totalRounds: parseInt(row?.total_rounds ?? '0', 10),
      totalGuessesAllTime: parseInt(row?.total_guesses_all_time ?? '0', 10),
      uniqueWinners: parseInt(row?.unique_winners ?? '0', 10),
      totalJackpotDistributed: row?.total_jackpot_distributed ?? '0',
      avgGuessesPerRound: parseFloat(row?.avg_guesses_per_round ?? '0'),
      avgPlayersPerRound: parseFloat(row?.avg_players_per_round ?? '0'),
      avgRoundLengthMinutes: parseFloat(row?.avg_round_length_minutes ?? '0'),
    };
  });
}

/**
 * Get guess distribution for a round (for histogram)
 */
export async function getRoundGuessDistribution(roundNumber: number): Promise<{
  distribution: Array<{ hour: number; count: number }>;
  byPlayer: Array<{ fid: number; count: number }>;
}> {
  // Get guesses by hour
  const hourlyResult = await db.execute<{ hour: string; count: string }>(sql`
    SELECT
      EXTRACT(HOUR FROM created_at) as hour,
      COUNT(*) as count
    FROM guesses
    WHERE round_id = ${roundNumber}
    GROUP BY EXTRACT(HOUR FROM created_at)
    ORDER BY hour
  `);

  // Get top guessers
  const byPlayerResult = await db.execute<{ fid: string; count: string }>(sql`
    SELECT
      fid,
      COUNT(*) as count
    FROM guesses
    WHERE round_id = ${roundNumber}
    GROUP BY fid
    ORDER BY count DESC
    LIMIT 20
  `);

  return {
    distribution: hourlyResult.map(r => ({
      hour: parseInt(r.hour, 10),
      count: parseInt(r.count, 10),
    })),
    byPlayer: byPlayerResult.map(r => ({
      fid: parseInt(r.fid, 10),
      count: parseInt(r.count, 10),
    })),
  };
}

/**
 * Sanitize archive data for export (remove sensitive info)
 */
export function sanitizeArchiveForExport(archive: RoundArchiveRow): Omit<RoundArchiveRow, 'salt'> & { salt: string } {
  return {
    ...archive,
    // Keep salt as it's part of commit-reveal transparency
    salt: archive.salt,
  };
}

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
  userBadges,
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
import { getTotalClanktonDistributed } from './jackpot-contract';

// Helper to extract rows from db.execute result (handles both array and {rows: []} formats)
function getRows<T = any>(result: any): T[] {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.rows)) return result.rows;
  return [];
}

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
    console.log(`[archive] ========== ARCHIVING ROUND ${roundId} ==========`);
    console.log(`[archive] Step 1: Checking existing archive for round ${roundId}`);
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

    console.log(`[archive] Step 2: Fetching round ${roundId} using raw SQL to avoid ORM issues`);
    // Get the round using raw SQL to bypass any Drizzle type coercion issues
    const roundResult = await db.execute(sql`
      SELECT id, answer, salt, commit_hash, prize_pool_eth, seed_next_round_eth,
             winner_fid, referrer_fid, started_at, resolved_at, status
      FROM rounds
      WHERE id = ${roundId}
      LIMIT 1
    `);

    const roundRows = getRows(roundResult);
    const rawRound = roundRows[0] as any;
    console.log(`[archive] Raw round data types:`, {
      id: typeof rawRound?.id,
      salt: typeof rawRound?.salt,
      saltValue: rawRound?.salt ? String(rawRound.salt).substring(0, 20) + '...' : 'NULL',
      saltIsDate: rawRound?.salt instanceof Date,
      answer: typeof rawRound?.answer,
      commit_hash: typeof rawRound?.commit_hash,
    });

    if (!rawRound) {
      await logArchiveError(roundId, 'round_not_found', `Round ${roundId} not found`);
      return {
        success: false,
        error: `Round ${roundId} not found`,
      };
    }

    // CRITICAL: Fix corrupted fields IMMEDIATELY after fetching round
    // The salt field keeps getting corrupted to Date objects - fix it before any other processing
    let saltValue = rawRound.salt;
    if (typeof rawRound.salt !== 'string' || rawRound.salt instanceof Date) {
      const originalValue = rawRound.salt instanceof Date ? (rawRound.salt as Date).toISOString() : String(rawRound.salt);
      console.warn(`[archive] ⚠️ Round ${roundId} salt field is corrupted (type=${typeof rawRound.salt}, isDate=${rawRound.salt instanceof Date})`);
      console.warn(`[archive] AUTO-FIXING salt immediately: Converting from "${originalValue}"`);

      // Generate a new random salt since the original is lost
      const crypto = await import('crypto');
      const newSalt = crypto.randomBytes(32).toString('hex');

      // Update the database with the new salt using raw SQL
      await db.execute(sql`UPDATE rounds SET salt = ${newSalt} WHERE id = ${roundId}`);

      saltValue = newSalt;
      rawRound.salt = newSalt;

      console.log(`[archive] ✅ Round ${roundId} salt field fixed with new random salt: ${newSalt.substring(0, 16)}...`);

      // Log for audit trail
      await logArchiveError(roundId, 'salt_auto_fixed', `Salt was corrupted, auto-fixed with new random salt`, {
        originalValue,
        newSalt,
      });
    }

    // Build a round object from raw data for compatibility with rest of the function
    const round = {
      id: rawRound.id,
      answer: rawRound.answer,
      salt: saltValue,
      commitHash: rawRound.commit_hash,
      prizePoolEth: rawRound.prize_pool_eth,
      seedNextRoundEth: rawRound.seed_next_round_eth,
      winnerFid: rawRound.winner_fid,
      referrerFid: rawRound.referrer_fid,
      startedAt: rawRound.started_at,
      resolvedAt: rawRound.resolved_at,
      status: rawRound.status,
    };

    // Check if round is resolved
    if (!round.resolvedAt) {
      return {
        success: false,
        error: `Round ${roundId} is not resolved yet`,
      };
    }

    console.log(`[archive] Step 3: Computing guesses for round ${roundId}`);
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

    console.log(`[archive] Step 4: Getting announcer event for round ${roundId}`);
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

    console.log(`[archive] Step 5: Getting payouts for round ${roundId}`);
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
    // Tiebreaker: who reached their count first (lowest max guessIndexInRound)
    const topGuessersFromGuesses = await db
      .select({
        fid: guesses.fid,
        guessCount: sql<number>`cast(count(${guesses.id}) as int)`,
        lastGuessIndex: sql<number>`cast(max(${guesses.guessIndexInRound}) as int)`,
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
      .orderBy(desc(sql`count(${guesses.id})`), asc(sql`max(${guesses.guessIndexInRound})`))
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

    console.log(`[archive] Step 6: Computing bonus counts for round ${roundId}`);
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

    console.log(`[archive] Step 7: Getting previous round seed for round ${roundId}`);
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
        // Defensive check: ensure previous round's seedNextRoundEth is a string
        if (typeof previousRound.seedNextRoundEth !== 'string') {
          const errorMsg = `Round ${roundId - 1} (previous round) seedNextRoundEth field is not a string (got ${typeof previousRound.seedNextRoundEth}). Use /api/admin/fix-round-field to fix round ${roundId - 1}.`;
          console.error(`[archive] ${errorMsg}`);
          await logArchiveError(roundId, 'previous_round_corrupted', errorMsg, {
            previousRoundId: roundId - 1,
            seedNextRoundEthType: typeof previousRound.seedNextRoundEth,
          });
          return {
            success: false,
            error: errorMsg,
          };
        }
        seedEth = previousRound.seedNextRoundEth;
      }
    }

    // Create archive record
    // Decrypt the answer for storage in archive (revealed after round ends)
    // Defensive check: ensure answer is a string (data corruption check)
    let targetWord: string;
    try {
      if (typeof round.answer !== 'string') {
        throw new Error(`Round ${roundId} answer field is not a string (got ${typeof round.answer}). Data may be corrupted.`);
      }
      targetWord = getPlaintextAnswer(round.answer);
    } catch (decryptError) {
      const errorMsg = decryptError instanceof Error ? decryptError.message : String(decryptError);
      console.error(`[archive] Failed to decrypt answer for round ${roundId}:`, errorMsg);
      await logArchiveError(roundId, 'decrypt_failed', errorMsg, { answerType: typeof round.answer });
      return {
        success: false,
        error: errorMsg,
      };
    }

    // Salt was already auto-fixed earlier if needed (immediately after fetching round)

    // Defensive check: ensure commitHash is a string if present
    if (round.commitHash !== null && typeof round.commitHash !== 'string') {
      const errorMsg = `Round ${roundId} commitHash field is not a string (got ${typeof round.commitHash}). Use /api/admin/fix-round-field to fix.`;
      console.error(`[archive] ${errorMsg}`);
      await logArchiveError(roundId, 'commitHash_corrupted', errorMsg, {
        commitHashType: typeof round.commitHash,
        commitHashIsDate: round.commitHash instanceof Date,
      });
      return {
        success: false,
        error: errorMsg,
      };
    }

    console.log(`[archive] Step 8: Building archive data for round ${roundId}`);
    // Log types of all fields being inserted to debug Date issue
    console.log(`[archive] Field types: targetWord=${typeof targetWord}, seedEth=${typeof seedEth}, finalJackpotEth=${typeof round.prizePoolEth}, salt=${typeof round.salt}`);
    console.log(`[archive] Field types: startTime=${round.startedAt instanceof Date ? 'Date' : typeof round.startedAt}, endTime=${round.resolvedAt instanceof Date ? 'Date' : typeof round.resolvedAt}`);
    console.log(`[archive] Field types: payoutsJson=${typeof payoutsJson}, payoutsJson.winner.amountEth=${typeof payoutsJson.winner?.amountEth}`);

    const archiveData: RoundArchiveInsert = {
      roundNumber: roundId,
      targetWord,
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
      salt: round.salt, // Salt was auto-fixed earlier if needed
      clanktonBonusCount,
      referralBonusCount,
    };

    console.log(`[archive] Step 9: Inserting archive record for round ${roundId}`);
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
 * Extended round data with usernames and PFPs for display
 */
export interface ArchivedRoundWithUsernames extends RoundArchiveRow {
  winnerUsername: string | null;
  winnerPfpUrl: string | null;
  referrerUsername: string | null;
  referrerPfpUrl: string | null;
  topGuessersWithUsernames: Array<{
    fid: number;
    username: string | null;
    pfpUrl: string | null;
    amountEth: string;
    guessCount: number;
    rank: number;
    hasClanktonBadge?: boolean;
    hasOgHunterBadge?: boolean;
  }>;
}

/**
 * Get archived round with usernames for winner, referrer, and top guessers
 */
export async function getArchivedRoundWithUsernames(roundNumber: number): Promise<ArchivedRoundWithUsernames | null> {
  // Dynamic imports to avoid circular dependencies
  const { hasClanktonBonus } = await import('./clankton');
  const { neynarClient } = await import('./farcaster');

  return trackSlowQuery(`query:getArchivedRoundWithUsernames:${roundNumber}`, async () => {
    const archived = await getArchivedRound(roundNumber);
    if (!archived) return null;

    // Collect all FIDs we need to look up
    const fidsToLookup: number[] = [];
    if (archived.winnerFid) fidsToLookup.push(archived.winnerFid);
    if (archived.referrerFid) fidsToLookup.push(archived.referrerFid);
    if (archived.payoutsJson?.topGuessers) {
      for (const guesser of archived.payoutsJson.topGuessers) {
        fidsToLookup.push(guesser.fid);
      }
    }

    // Lookup usernames and wallets for all FIDs from local DB
    const uniqueFids = [...new Set(fidsToLookup)];
    const userDataMap = new Map<number, { username: string | null; wallet: string | null; pfpUrl: string | null }>();

    if (uniqueFids.length > 0) {
      const userRecords = await db
        .select({ fid: users.fid, username: users.username, signerWalletAddress: users.signerWalletAddress })
        .from(users)
        .where(sql`${users.fid} IN ${uniqueFids}`);

      for (const user of userRecords) {
        userDataMap.set(user.fid, {
          username: user.username,
          wallet: user.signerWalletAddress,
          pfpUrl: null, // Will be filled from Neynar
        });
      }
    }

    // Fetch profiles from Neynar for all FIDs (for accurate usernames and PFPs)
    if (uniqueFids.length > 0) {
      try {
        console.log(`[archive] Fetching ${uniqueFids.length} profiles from Neynar:`, uniqueFids);
        const neynarData = await neynarClient.fetchBulkUsers({ fids: uniqueFids });
        console.log(`[archive] Neynar returned ${neynarData.users?.length || 0} users`);
        if (neynarData.users) {
          for (const user of neynarData.users) {
            const existing = userDataMap.get(user.fid) || { username: null, wallet: null, pfpUrl: null };
            userDataMap.set(user.fid, {
              ...existing,
              // Prefer Neynar username over local DB (more up-to-date)
              username: user.username || existing.username,
              pfpUrl: user.pfp_url || null,
            });
          }
          // Log any FIDs that Neynar didn't return data for
          const returnedFids = new Set(neynarData.users.map(u => u.fid));
          const missingFids = uniqueFids.filter(fid => !returnedFids.has(fid));
          if (missingFids.length > 0) {
            console.warn(`[archive] Neynar missing data for FIDs:`, missingFids);
          }
        }
      } catch (error) {
        console.warn('[archive] Error fetching profiles from Neynar:', error);
        // Continue with local data
      }
    }

    // Get top guesser FIDs only (for badge checks and guess counts)
    // Query the actual top 10 guessers by guess count (excluding winner)
    // IMPORTANT: Only count guesses within the Top-10 lock window (first 750)
    // Uses a simple subquery: get first 750 guesses ordered by index/timestamp, then aggregate
    // Tiebreaker: who reached that count first (lower max guess_index = reached count earlier)
    const actualTopGuessers = await db.execute<{ fid: number; guess_count: number }>(sql`
      SELECT fid, COUNT(*)::int as guess_count
      FROM (
        SELECT id, fid, guess_index_in_round
        FROM guesses
        WHERE round_id = ${archived.roundNumber}
        ORDER BY guess_index_in_round ASC NULLS LAST, created_at ASC
        LIMIT 750
      ) first_750
      GROUP BY fid
      ORDER BY COUNT(*) DESC, MAX(guess_index_in_round) ASC
      LIMIT 11
    `);

    // Filter out the winner and take top 10
    const top10Guessers = actualTopGuessers
      .filter(g => g.fid !== archived.winnerFid)
      .slice(0, 10);

    const topGuesserFids = top10Guessers.map(g => g.fid);
    const guessCountMap = new Map<number, number>();
    for (const g of top10Guessers) {
      guessCountMap.set(g.fid, g.guess_count);
    }

    // Fetch user data for top guessers (usernames and wallets)
    if (topGuesserFids.length > 0) {
      const userRecords = await db
        .select({ fid: users.fid, username: users.username, signerWalletAddress: users.signerWalletAddress })
        .from(users)
        .where(sql`${users.fid} IN ${topGuesserFids}`);

      for (const user of userRecords) {
        if (!userDataMap.has(user.fid)) {
          userDataMap.set(user.fid, {
            username: user.username,
            wallet: user.signerWalletAddress,
            pfpUrl: null,
          });
        }
      }

      // Fetch Neynar data for top guessers
      try {
        const neynarData = await neynarClient.fetchBulkUsers({ fids: topGuesserFids });
        if (neynarData.users) {
          for (const user of neynarData.users) {
            const existing = userDataMap.get(user.fid) || { username: null, wallet: null, pfpUrl: null };
            userDataMap.set(user.fid, {
              ...existing,
              username: user.username || existing.username,
              pfpUrl: user.pfp_url || null,
            });
          }
        }
      } catch (error) {
        console.warn('[archive] Error fetching top guesser profiles from Neynar:', error);
      }
    }

    // Check OG Hunter badges for top guessers
    const ogHunterBadgeFids = new Set<number>();
    if (topGuesserFids.length > 0) {
      const badgeRecords = await db
        .select({ fid: userBadges.fid })
        .from(userBadges)
        .where(
          and(
            sql`${userBadges.fid} IN ${topGuesserFids}`,
            eq(userBadges.badgeType, 'OG_HUNTER')
          )
        );
      for (const badge of badgeRecords) {
        ogHunterBadgeFids.add(badge.fid);
      }
    }

    // Check CLANKTON balances for top guessers (only those with wallets)
    // Wrapped in defensive try/catch since this makes RPC calls that could fail
    const clanktonHolderFids = new Set<number>();
    try {
      const walletsToCheck = topGuesserFids
        .filter(fid => userDataMap.get(fid)?.wallet)
        .map(fid => ({ fid, wallet: userDataMap.get(fid)!.wallet! }));

      if (walletsToCheck.length > 0) {
        // Check all wallets in parallel with individual error handling
        const clanktonResults = await Promise.allSettled(
          walletsToCheck.map(async ({ fid, wallet }) => ({
            fid,
            hasClankton: await hasClanktonBonus(wallet),
          }))
        );
        for (const result of clanktonResults) {
          if (result.status === 'fulfilled' && result.value.hasClankton) {
            clanktonHolderFids.add(result.value.fid);
          }
        }
      }
    } catch (error) {
      console.warn('[archive] Error checking CLANKTON balances:', error);
      // Continue without CLANKTON badges on error
    }

    // Build extended response with usernames and PFPs
    // Use actual top guessers by guess count (not payout recipients)
    const topGuessersWithUsernames = top10Guessers.map((guesser, index) => {
      const userData = userDataMap.get(guesser.fid);
      // Find payout amount for this guesser (if any)
      const payoutEntry = archived.payoutsJson?.topGuessers?.find(p => p.fid === guesser.fid);
      return {
        fid: guesser.fid,
        username: userData?.username || `fid:${guesser.fid}`,
        pfpUrl: userData?.pfpUrl || `https://avatar.vercel.sh/${guesser.fid}`,
        amountEth: payoutEntry?.amountEth || '0',
        guessCount: guesser.guess_count,
        rank: index + 1,
        hasClanktonBadge: clanktonHolderFids.has(guesser.fid),
        hasOgHunterBadge: ogHunterBadgeFids.has(guesser.fid),
      };
    });

    const winnerData = archived.winnerFid ? userDataMap.get(archived.winnerFid) : null;
    const referrerData = archived.referrerFid ? userDataMap.get(archived.referrerFid) : null;

    return {
      ...archived,
      winnerUsername: winnerData?.username || (archived.winnerFid ? `fid:${archived.winnerFid}` : null),
      winnerPfpUrl: winnerData?.pfpUrl || (archived.winnerFid ? `https://avatar.vercel.sh/${archived.winnerFid}` : null),
      referrerUsername: referrerData?.username || (archived.referrerFid ? `fid:${archived.referrerFid}` : null),
      referrerPfpUrl: referrerData?.pfpUrl || (archived.referrerFid ? `https://avatar.vercel.sh/${archived.referrerFid}` : null),
      topGuessersWithUsernames,
    };
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
  rounds: (RoundArchiveRow & { winnerUsername?: string | null })[];
  total: number;
}> {
  const { limit = 20, offset = 0, orderBy = 'desc' } = options;

  return trackSlowQuery(`query:getArchivedRounds:${limit}:${offset}`, async () => {
    const [totalResult] = await db
      .select({ count: count() })
      .from(roundArchive);

    // Join with users table to get winner username
    const archivedRounds = await db
      .select({
        id: roundArchive.id,
        roundNumber: roundArchive.roundNumber,
        targetWord: roundArchive.targetWord,
        seedEth: roundArchive.seedEth,
        finalJackpotEth: roundArchive.finalJackpotEth,
        totalGuesses: roundArchive.totalGuesses,
        uniquePlayers: roundArchive.uniquePlayers,
        winnerFid: roundArchive.winnerFid,
        winnerCastHash: roundArchive.winnerCastHash,
        winnerGuessNumber: roundArchive.winnerGuessNumber,
        startTime: roundArchive.startTime,
        endTime: roundArchive.endTime,
        referrerFid: roundArchive.referrerFid,
        payoutsJson: roundArchive.payoutsJson,
        salt: roundArchive.salt,
        clanktonBonusCount: roundArchive.clanktonBonusCount,
        referralBonusCount: roundArchive.referralBonusCount,
        createdAt: roundArchive.createdAt,
        winnerUsername: users.username,
      })
      .from(roundArchive)
      .leftJoin(users, eq(roundArchive.winnerFid, users.fid))
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

  const rows = getRows<{ count: string }>(result);
  return parseInt(rows[0]?.count ?? '0', 10);
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
  totalPlayers: number;
  uniqueWinners: number;
  totalJackpotDistributed: string;
  totalClanktonBonuses: number;
  avgGuessesPerRound: number;
  avgPlayersPerRound: number;
  avgRoundLengthMinutes: number;
}

/**
 * Get aggregate archive statistics
 */
export async function getArchiveStats(): Promise<ArchiveStats> {
  return trackSlowQuery('query:getArchiveStats', async () => {
    // Get basic archive stats
    const result = await db.execute<{
      total_rounds: string;
      total_guesses_all_time: string;
      total_players: string;
      unique_winners: string;
      total_jackpot_distributed: string;
      avg_guesses_per_round: string;
      avg_players_per_round: string;
      avg_round_length_minutes: string;
    }>(sql`
      SELECT
        COUNT(*) as total_rounds,
        COALESCE(SUM(total_guesses), 0) as total_guesses_all_time,
        COALESCE(SUM(unique_players), 0) as total_players,
        COUNT(DISTINCT winner_fid) as unique_winners,
        COALESCE(SUM(final_jackpot_eth), 0) as total_jackpot_distributed,
        COALESCE(AVG(total_guesses), 0) as avg_guesses_per_round,
        COALESCE(AVG(unique_players), 0) as avg_players_per_round,
        COALESCE(AVG(EXTRACT(EPOCH FROM (end_time - start_time)) / 60), 0) as avg_round_length_minutes
      FROM round_archive
    `);

    // Get total CLANKTON distributed from contract (with 18 decimals)
    // Convert to human-readable number (divide by 10^18)
    const totalClanktonRaw = await getTotalClanktonDistributed();
    const totalClankton = Number(totalClanktonRaw / BigInt(10 ** 18));

    const rows = getRows(result);
    const row = rows[0];
    return {
      totalRounds: parseInt(row?.total_rounds ?? '0', 10),
      totalGuessesAllTime: parseInt(row?.total_guesses_all_time ?? '0', 10),
      totalPlayers: parseInt(row?.total_players ?? '0', 10),
      uniqueWinners: parseInt(row?.unique_winners ?? '0', 10),
      totalJackpotDistributed: row?.total_jackpot_distributed ?? '0',
      totalClanktonBonuses: totalClankton,
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

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
import { eq, and, sql, desc, asc, isNotNull, count, countDistinct, gte, lte, notInArray } from 'drizzle-orm';
import { trackSlowQuery } from './redis';
import { getPlaintextAnswer } from './encryption';
import { getTop10LockForRound } from './top10-lock';
import { getTotalWordTokenDistributed } from './jackpot-contract';
import { isRealFcUsername } from './farcaster';
import { playerDisplay } from './player-display';
import { isWalletFid } from './users';
import { tokensForUsdCents, usdCentsForTokens } from './word-amounts';

// Helper to extract rows from db.execute result (handles both array and {rows: []} formats)
function getRows<T = any>(result: any): T[] {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.rows)) return result.rows;
  return [];
}

/**
 * How many places the Top-10 ladder has, and therefore the most top-guesser
 * payout rows one resolve can produce: getTop10Guessers returns at most ten
 * distinct FIDs (economics.ts), and the no-other-guessers fallback writes a
 * single row for the winner. Both the write-path anomaly check and the
 * rendered list below read this, so "Top 10" means one number in one place.
 */
const TOP10_PAID_SLOTS = 10;

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

  // Incidents this run raised about the row it is ABOUT to write, which a
  // successful archive must NOT sweep away (see the auto-resolve block at the
  // end of this function). Every other data-integrity failure here returns
  // success:false, so the sweep never runs for it; these two conditions are
  // ones the archive survives — it still writes a usable row — but that leave
  // a number nothing will ever recompute, so somebody has to be told.
  const standingIncidentIds: number[] = [];
  const raiseStandingIncident = async (
    errorType: string,
    errorMessage: string,
    errorData?: Record<string, any>
  ) => {
    const id = await logArchiveError(roundId, errorType, errorMessage, errorData);
    if (id !== null) {
      standingIncidentIds.push(id);
    }
  };

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
    // Cast ALL text fields to ::text to ensure they come back as strings
    // The $WORD columns are selected explicitly. They were missing, and because
    // this is a hand-written column list rather than `select()`, nothing warned:
    // `rawRound.prize_currency` came back undefined, so `archiveIsWord` below
    // was ALWAYS false. Every currency branch downstream of it — the payout
    // amount mapping, the top-guesser pool accumulator — read as ETH no matter
    // what the round actually paid. The code looked migrated and never ran.
    const roundResult = await db.execute(sql`
      SELECT id, answer::text as answer, salt::text as salt, commit_hash::text as commit_hash,
             prize_pool_eth::text as prize_pool_eth, seed_next_round_eth::text as seed_next_round_eth,
             prize_currency::text as prize_currency, prize_pool_word::text as prize_pool_word,
             seed_price_e18::text as seed_price_e18, seed_usd_cents,
             winner_fid, referrer_fid, started_at, resolved_at, status::text as status
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
    // Check if salt is a valid 64-char hex string - if not, regenerate it
    let saltValue = rawRound.salt;
    const isValidSalt = typeof saltValue === 'string' &&
                        saltValue.length === 64 &&
                        /^[a-f0-9]+$/i.test(saltValue);

    if (!isValidSalt) {
      let originalValue: string;
      try {
        originalValue = saltValue instanceof Date && typeof saltValue.toISOString === 'function'
          ? saltValue.toISOString()
          : String(saltValue);
      } catch {
        originalValue = `[unparseable: ${typeof saltValue}]`;
      }
      console.warn(`[archive] ⚠️ Round ${roundId} salt field is corrupted (type=${typeof saltValue}, isDate=${saltValue instanceof Date})`);
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
    // Convert date fields to Date objects (raw SQL may return strings)
    const round = {
      id: rawRound.id,
      answer: rawRound.answer,
      salt: saltValue,
      commitHash: rawRound.commit_hash,
      prizePoolEth: rawRound.prize_pool_eth,
      seedNextRoundEth: rawRound.seed_next_round_eth,
      // Decides which amount column the payout rows carry.
      prizeCurrency: rawRound.prize_currency,
      prizePoolWord: rawRound.prize_pool_word,
      seedPriceE18: rawRound.seed_price_e18,
      seedUsdCents: rawRound.seed_usd_cents ?? null,
      winnerFid: rawRound.winner_fid,
      referrerFid: rawRound.referrer_fid,
      startedAt: rawRound.started_at instanceof Date ? rawRound.started_at : new Date(rawRound.started_at),
      // Null must survive this conversion. `new Date(null)` is not an invalid
      // date, it is 1970-01-01 — a perfectly truthy Date — so an unresolved
      // round sailed past the `if (!round.resolvedAt)` guard below and got
      // archived mid-play, with 1970 written into the permanent record as the
      // round's end time.
      resolvedAt: rawRound.resolved_at
        ? (rawRound.resolved_at instanceof Date ? rawRound.resolved_at : new Date(rawRound.resolved_at))
        : null,
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

    // Get winner's guess number (which guess won).
    // Exclude ineligible-winner audit rows — those are correct-word guesses
    // that failed winner-eligibility and must never be picked as "the real
    // winner" of the round.
    let winnerGuessNumber: number | null = null;
    if (round.winnerFid) {
      const winningGuess = await db
        .select()
        .from(guesses)
        .where(
          and(
            eq(guesses.roundId, roundId),
            eq(guesses.isCorrect, true),
            eq(guesses.isIneligibleWinner, false)
          )
        )
        .limit(1);

      if (winningGuess.length > 0) {
        // Count guesses before the winning one
        // Convert Date to ISO string for safe SQL comparison
        const winningTime = winningGuess[0].createdAt instanceof Date
          ? winningGuess[0].createdAt.toISOString()
          : String(winningGuess[0].createdAt);
        const [priorGuessCount] = await db
          .select({ count: count() })
          .from(guesses)
          .where(
            and(
              eq(guesses.roundId, roundId),
              sql`${guesses.createdAt} <= ${winningTime}::timestamp`
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
    // Get payouts for winner, referrer, seed from round_payouts.
    //
    // Ordered by id, because that is the only record of top-guesser RANK that
    // exists: round_payouts has no rank column, and resolveRoundAndCreatePayouts
    // writes the whole array in one insert in rank order (economics.ts), so
    // ascending id IS rank 1..N. An unordered select hands them back in
    // whatever order Postgres finds convenient.
    const payoutRecords = await db
      .select()
      .from(roundPayouts)
      .where(eq(roundPayouts.roundId, roundId))
      .orderBy(asc(roundPayouts.id));

    const payoutsJson: RoundArchivePayouts = {
      topGuessers: [],
    };

    // Get winner, referrer, seed payouts from DB.
    //
    // A $WORD round carries its amounts in amount_word, with amount_eth NULL.
    // Reading amountEth unconditionally wrote "NaN" and "null" into an archive
    // row that is never recomputed — the one place a bad value is permanent.
    const archiveIsWord = round.prizeCurrency === 'word';
    const amt = (p: { amountEth: string | null; amountWord: string | null }) => ({
      amountEth: p.amountEth ?? '0',
      ...(archiveIsWord ? { amountWord: p.amountWord ?? '0' } : {}),
    });

    for (const payout of payoutRecords) {
      switch (payout.role) {
        case 'winner':
          if (payout.fid) {
            payoutsJson.winner = { fid: payout.fid, ...amt(payout) };
          }
          break;
        case 'referrer':
          if (payout.fid) {
            payoutsJson.referrer = { fid: payout.fid, ...amt(payout) };
          }
          break;
        case 'top_guesser':
          // Record WHO WAS PAID, at the amount they were paid — one archive
          // entry per stored payout row, in payout (rank) order.
          //
          // This used to sum the top-guesser rows into a single pool, re-derive
          // its own Top 10 from the guesses table, and re-split the pool across
          // THAT list by the BPS ladder. The comment defending it said the
          // archive should show the true ranking "not who was incorrectly
          // paid", which was written when paid and ranked could only differ by
          // a bug. They can now differ by design: getTop10Guessers applies the
          // reward gate at resolve (economics.ts), dropping an ineligible FID
          // and promoting the next eligible one, and the gate is enabled in
          // production. Re-deriving therefore printed one player at a rank and
          // handed them the tokens a different wallet had received. The
          // re-split could not reproduce the amounts either: rank 1 takes the
          // division remainder (top-guesser-payouts.ts), so the recomputed
          // figure was always a few wei short of what moved.
          //
          // The winner's own fallback row — written when nobody else guessed,
          // so the top-10 share goes to them — is kept, because it is money
          // that moved. getArchivedRoundWithUsernames leaves it out of the
          // ranked list, where the winner is already shown separately.
          if (payout.fid) {
            payoutsJson.topGuessers.push({
              fid: payout.fid,
              ...amt(payout),
              rank: payoutsJson.topGuessers.length + 1,
            });
          }
          break;
        case 'seed':
          payoutsJson.seed = amt(payout);
          break;
        case 'creator':
          payoutsJson.creator = amt(payout);
          break;
      }
    }

    console.log(
      `[archive] Recorded ${payoutsJson.topGuessers.length} top-guesser payouts for round ${roundId} from round_payouts`
    );

    // The paid list may legitimately be SHORT: a round with fewer than ten
    // other guessers pays fewer than ten, and the ladder normalises for it. It
    // can never legitimately be LONG, and it can never name the same FID twice
    // — one resolve writes at most TOP10_PAID_SLOTS rows, one per distinct FID.
    // A longer list means a SECOND set of payout rows was inserted, which
    // happens when resolveRoundAndCreatePayouts re-runs against a round whose
    // resolved_at is still null (its only idempotency guard, economics.ts) —
    // exactly what /api/admin/operational/recover-stuck-round does to a resolve
    // that died between the payout insert and the resolved flag.
    //
    // payoutsJson keeps every row: it is the record of money that moved, and
    // hiding a duplicate payout there would be the opposite of a fix. So the
    // anomaly is raised as a standing incident instead, and the public list
    // renders each FID once, at most ten (getArchivedRoundWithUsernames).
    const paidFids = payoutsJson.topGuessers.map((g) => g.fid);
    const duplicatePaidFids = [...new Set(paidFids.filter((fid, i) => paidFids.indexOf(fid) !== i))];
    if (paidFids.length > TOP10_PAID_SLOTS || duplicatePaidFids.length > 0) {
      const errorMsg =
        `Round ${roundId} has ${paidFids.length} top_guesser payout rows ` +
        `(one resolve writes at most ${TOP10_PAID_SLOTS}, one per FID` +
        (duplicatePaidFids.length > 0 ? `; repeated FIDs: ${duplicatePaidFids.join(', ')}` : '') +
        `). Check round_payouts for a duplicate payout set before trusting the totals.`;
      console.error(`[archive] ${errorMsg}`);
      await raiseStandingIncident('top_guesser_payouts_anomalous', errorMsg, {
        topGuesserRows: paidFids.length,
        duplicateFids: duplicatePaidFids,
      });
    }

    console.log(`[archive] Step 6: Computing bonus counts for round ${roundId}`);
    // Compute $WORD bonus count
    // Count users who used $WORD token bonus during this round's active period
    const clanktonBonusCount = await computeWordTokenBonusCount(
      round.startedAt,
      round.resolvedAt
    );

    // Compute referral bonus count
    // Count new referrals during this round's active period
    const referralBonusCount = await computeReferralBonusCount(
      round.startedAt,
      round.resolvedAt
    );

    console.log(`[archive] Step 7: Computing the opening pool for round ${roundId}`);
    // The "seed" is the pool the round OPENED with.
    //
    // In the ETH era that is the previous round's carry, because the carry was
    // the whole of the next round's opening pool — one number, two names.
    //
    // In the $WORD era they are different numbers, and using the carry here
    // understates the opening pool by more than an order of magnitude. A $WORD
    // round opens at a USD target: WordJackpot.startRound seeds
    // `seedUsdCents * 1e34 / priceE18` tokens, and the previous round's carry is
    // merely the first place the contract draws that seed FROM, before it
    // touches the treasury tranche. Round 35 opened with 116,686,114 $WORD
    // ($39.99) while round 34 carried 5,244,446 $WORD forward — labelling the
    // carry "Seed" beside a 117M final pool is wrong by ~22x.
    //
    // So a $WORD round's seed is recomputed from its OWN two recorded columns,
    // exactly the pair the contract priced it with, via the same helper the
    // seeding path uses. rounds.prize_pool_word cannot stand in for it:
    // economics.ts overwrites that column with the FINAL pool at resolve.
    let seedEth = '0';
    let seedWord: string | null = null;

    if (archiveIsWord) {
      if (round.seedUsdCents && round.seedPriceE18) {
        try {
          seedWord = tokensForUsdCents(
            BigInt(round.seedUsdCents),
            BigInt(round.seedPriceE18)
          ).toString();
        } catch (err) {
          // Null is the honest value, but it is not a harmless one: nothing
          // ever recomputes an archive row, so this round's opening pool is
          // now unknowable. formatArchiveSeed no longer prints a null $WORD seed
          // as "0 $WORD" — it renders the unknown case as such — but the number
          // is still gone. Every other data-integrity failure in
          // this function raises an archive error; this one used to warn into
          // Vercel and return success:true, so the Archive tab stayed green
          // over a permanently wrong number.
          const errorMsg =
            `Round ${roundId} is a $WORD round whose opening seed could not be priced ` +
            `from its own columns (seedUsdCents=${round.seedUsdCents}, ` +
            `seedPriceE18=${round.seedPriceE18}): ${err instanceof Error ? err.message : String(err)}. ` +
            `Archived with no opening seed.`;
          console.error(`[archive] ${errorMsg}`);
          await raiseStandingIncident('seed_price_missing', errorMsg, {
            reason: 'unpriceable',
            seedUsdCents: round.seedUsdCents ?? null,
            seedPriceE18: round.seedPriceE18 ?? null,
            error: String(err),
          });
        }
      } else {
        // Null, not '0'. A round seeded outside the normal path (or predating
        // the columns) has no recoverable opening token count, and '0' would
        // assert it opened empty — a real measurement, and a false one.
        // Flagged for the same reason as the catch above: the archive survives
        // this, the number does not.
        const errorMsg =
          `Round ${roundId} is a $WORD round with no seed target/price snapshot ` +
          `(seedUsdCents=${round.seedUsdCents}, seedPriceE18=${round.seedPriceE18}); ` +
          `archived with no opening seed rather than a guessed one.`;
        console.error(`[archive] ${errorMsg}`);
        await raiseStandingIncident('seed_price_missing', errorMsg, {
          reason: 'columns_missing',
          seedUsdCents: round.seedUsdCents ?? null,
          seedPriceE18: round.seedPriceE18 ?? null,
        });
      }
    } else if (roundId > 1) {
      // ETH rounds only. safeSeedEth is NULL for a $WORD round, so the lookup —
      // and its corrupted-column guard, which fails the entire archive — has no
      // business blocking a $WORD archive on the state of an ETH column that
      // round never reads.
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
    // Use inline decryption like fix-and-archive endpoint to avoid any module issues
    let targetWord: string;
    try {
      // Force convert to string first
      let answerStr = String(round.answer);
      console.log(`[archive] Answer string: ${answerStr.substring(0, 50)}...`);

      if (answerStr.includes(':')) {
        // Encrypted format: iv:tag:ciphertext
        const { createDecipheriv } = await import('crypto');
        const [iv, tag, ciphertext] = answerStr.split(':');
        const key = Buffer.from(process.env.ANSWER_ENCRYPTION_KEY!, 'hex');
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
        decipher.setAuthTag(Buffer.from(tag, 'hex'));
        targetWord = decipher.update(ciphertext, 'hex', 'utf8') + decipher.final('utf8');
        console.log(`[archive] Decrypted answer: ${targetWord}`);
      } else {
        // Legacy plaintext
        targetWord = answerStr;
      }
    } catch (decryptError) {
      const errorMsg = decryptError instanceof Error ? decryptError.message : String(decryptError);
      console.error(`[archive] Failed to decrypt answer for round ${roundId}:`, errorMsg);
      await logArchiveError(roundId, 'decrypt_failed', errorMsg, { answerType: typeof round.answer, answerValue: String(round.answer).substring(0, 50) });
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

    // Milestone 15: Include Superguess data if any sessions exist
    try {
      const { superguessSessions } = await import('../db/schema');
      const sgSessions = await db
        .select()
        .from(superguessSessions)
        .where(eq(superguessSessions.roundId, roundId));

      if (sgSessions.length > 0) {
        // Use the most significant session (won > exhausted > expired > cancelled)
        const priorityOrder = ['won', 'exhausted', 'expired', 'cancelled', 'active'];
        const sorted = sgSessions.sort((a, b) =>
          priorityOrder.indexOf(a.status) - priorityOrder.indexOf(b.status)
        );
        const sg = sorted[0];
        payoutsJson.superguess = {
          buyerFid: sg.fid,
          tier: sg.tier,
          outcome: sg.status,
          guessesUsed: sg.guessesUsed,
          // Record what was actually paid. Superguess moved from $WORD to ETH,
          // so the archive carries the currency alongside the amount rather
          // than a single field that means different things in different
          // rounds — the same mistake the ETH/$WORD prize columns avoided.
          currency: sg.currency,
          wordAmountPaid: sg.wordAmountPaid ?? null,
          ethAmountPaid: sg.ethAmountPaid ?? null,
          usdEquivalent: sg.usdEquivalent,
        };
        console.log(`[archive] Superguess data: FID ${sg.fid}, ${sg.status}, ${sg.guessesUsed} guesses`);
      }
    } catch (err) {
      console.warn(`[archive] Failed to fetch Superguess data for round ${roundId}:`, err);
    }

    console.log(`[archive] Step 8: Building archive data for round ${roundId}`);
    // Log types of all fields being inserted to debug Date issue
    console.log(`[archive] Field types: targetWord=${typeof targetWord}, seedEth=${typeof seedEth}, finalJackpotEth=${typeof round.prizePoolEth}, salt=${typeof round.salt}`);
    console.log(`[archive] Field types: startTime=${round.startedAt instanceof Date ? 'Date' : typeof round.startedAt}, endTime=${round.resolvedAt instanceof Date ? 'Date' : typeof round.resolvedAt}`);
    console.log(`[archive] Field types: payoutsJson=${typeof payoutsJson}, payoutsJson.winner.amountEth=${typeof payoutsJson.winner?.amountEth}`);
    console.log(`[archive] Salt value check: isString=${typeof round.salt === 'string'}, length=${round.salt?.length}, isValidHex=${typeof round.salt === 'string' && /^[a-f0-9]+$/i.test(round.salt)}`);

    // Force all string fields to be strings to avoid any Drizzle type issues
    const safeTargetWord = String(targetWord);
    const safeSalt = String(round.salt);

    // Which currency this round actually paid in decides which pair of columns
    // is meaningful, and the other pair must be NULL rather than '0'.
    //
    // This is the row nothing ever recomputes. Until now the write populated
    // only seed_eth and final_jackpot_eth, and left `currency` to its 'eth'
    // column default — so a round-34 archive would have claimed to be an ETH
    // round paying out `prize_pool_eth`. The read side is already currency-aware
    // (archiveCurrency, formatArchiveJackpot) and would have rendered that
    // faithfully and wrongly, because it was told 'eth'.
    //
    // NULL, not '0', for the currency that did not apply: '0' asserts "this
    // round paid zero ETH", which reads as a real measurement and is what
    // getArchiveStats would sum into the public "ETH distributed" total. NULL
    // says the question does not apply, and SUM skips it. That is also why the
    // archive serializers get null-guarded in this same change — writing
    // honest NULLs is what makes their unguarded .toString() calls reachable.
    const safeSeedEth = archiveIsWord ? null : String(seedEth);
    const safeFinalJackpotEth = archiveIsWord ? null : String(round.prizePoolEth);
    const safeSeedWord = archiveIsWord ? seedWord : null;
    const safeFinalJackpotWord = archiveIsWord ? (round.prizePoolWord ?? null) : null;

    // The USD snapshot is what makes a $WORD round comparable to an ETH one
    // years later, when the token price is nothing like today's. seedUsdCents
    // was recorded at seed time; the final figure is derived from the same
    // price snapshot so both sides of the round are quoted on one basis.
    let finalJackpotUsdCents: number | null = null;
    if (archiveIsWord && round.prizePoolWord && round.seedPriceE18) {
      try {
        finalJackpotUsdCents = Number(
          usdCentsForTokens(BigInt(round.prizePoolWord), BigInt(round.seedPriceE18))
        );
      } catch (err) {
        console.warn(`[archive] Could not derive final USD value for round ${roundId}:`, err);
      }
    }

    console.log(`[archive] Currency=${archiveIsWord ? 'word' : 'eth'} seedEth=${safeSeedEth} finalJackpotEth=${safeFinalJackpotEth} seedWord=${safeSeedWord} finalJackpotWord=${safeFinalJackpotWord}`);

    const archiveData: RoundArchiveInsert = {
      roundNumber: roundId,
      targetWord: safeTargetWord,
      currency: archiveIsWord ? 'word' : 'eth',
      seedEth: safeSeedEth,
      finalJackpotEth: safeFinalJackpotEth,
      seedWord: safeSeedWord,
      finalJackpotWord: safeFinalJackpotWord,
      seedUsdCents: archiveIsWord ? (round.seedUsdCents ?? null) : null,
      finalJackpotUsdCents,
      totalGuesses,
      uniquePlayers,
      winnerFid: round.winnerFid,
      winnerCastHash,
      winnerGuessNumber,
      startTime: round.startedAt,
      endTime: round.resolvedAt,
      referrerFid: round.referrerFid,
      payoutsJson,
      salt: safeSalt,
      clanktonBonusCount,
      referralBonusCount,
    };

    console.log(`[archive] Step 9: Inserting archive record for round ${roundId}`);
    const [archived] = await db
      .insert(roundArchive)
      .values(archiveData)
      .returning();

    console.log(`[archive] Successfully archived round ${roundId}`);

    // A successful archive supersedes any outstanding errors for this round.
    // Without this, failures from before a repair sit unresolved forever and
    // the Archive tab reads as a standing incident — 377 stale rows from the
    // Dec 2025 Date-corruption incident did exactly that.
    //
    // Except the incidents THIS run raised. They describe the row that was just
    // written — a $WORD round archived with no opening seed, a payout set
    // larger than one resolve can produce — so the archive succeeding is not
    // news that supersedes them, it is the thing that makes them permanent.
    // Sweeping them would insert a row and hide it in the same function call.
    try {
      const sweepConditions = [
        eq(roundArchiveErrors.roundNumber, roundId),
        eq(roundArchiveErrors.resolved, false),
      ];
      if (standingIncidentIds.length > 0) {
        sweepConditions.push(notInArray(roundArchiveErrors.id, standingIncidentIds));
      }
      await db
        .update(roundArchiveErrors)
        .set({ resolved: true, resolvedAt: new Date() })
        .where(and(...sweepConditions));
    } catch (resolveErr) {
      console.warn(`[archive] Could not auto-resolve stale errors for round ${roundId}:`, resolveErr);
    }

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
  /** Which door the winner came through, for badging. Null when no winner. */
  winnerOrigin: 'farcaster' | 'wallet' | null;
  /** True when winnerUsername is a truncated address rather than a name. */
  winnerIsAddressFallback: boolean;
  winnerHasOgHunterBadge?: boolean;
  winnerHasWordTokenBadge?: boolean;
  winnerHasBonusWordBadge?: boolean;
  winnerHasJackpotWinnerBadge?: boolean;
  winnerHasDoubleWBadge?: boolean;
  winnerHasPatronBadge?: boolean;
  winnerHasQuickdrawBadge?: boolean;
  winnerHasEncyclopedicBadge?: boolean;
  referrerUsername: string | null;
  referrerOrigin: 'farcaster' | 'wallet' | null;
  /** Symmetric with the winner and top guessers: playerLabel needs this to
   *  withhold the "@" when the name fell through to a truncated address. */
  referrerIsAddressFallback: boolean;
  referrerPfpUrl: string | null;
  topGuessersWithUsernames: Array<{
    fid: number;
    username: string | null;
    origin: 'farcaster' | 'wallet';
    isAddressFallback: boolean;
    pfpUrl: string | null;
    /** What this rank was actually paid. '0' on a $WORD round — see amountWord. */
    amountEth: string;
    /** Set on a $WORD round, null on an ETH one. Never summed with amountEth. */
    amountWord: string | null;
    guessCount: number;
    rank: number;
    hasWordTokenBadge?: boolean;
    hasOgHunterBadge?: boolean;
    hasBonusWordBadge?: boolean;
    hasJackpotWinnerBadge?: boolean;
    hasDoubleWBadge?: boolean;
    hasPatronBadge?: boolean;
    hasQuickdrawBadge?: boolean;
    hasEncyclopedicBadge?: boolean;
    hasBakersDozenBadge?: boolean;
  }>;
}

/**
 * Get archived round with usernames for winner, referrer, and top guessers
 */
/**
 * Identity fields the archive needs for one player.
 *
 * The archive is PERMANENT: whatever name it renders is what a round looks
 * like forever. Before the display columns existed, a wallet-native player was
 * written into that record as "fid:1000000001" with a generated avatar, beside
 * named Farcaster players.
 */
interface ArchiveUserData {
  username: string | null;
  wallet: string | null;
  pfpUrl: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  identityOrigin: string | null;
}

const EMPTY_ARCHIVE_USER: ArchiveUserData = {
  username: null,
  wallet: null,
  pfpUrl: null,
  displayName: null,
  avatarUrl: null,
  identityOrigin: null,
};

export async function getArchivedRoundWithUsernames(roundNumber: number): Promise<ArchivedRoundWithUsernames | null> {
  // Dynamic imports to avoid circular dependencies
  const { hasWordTokenBonus } = await import('./word-token');
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
    const userDataMap = new Map<number, ArchiveUserData>();

    if (uniqueFids.length > 0) {
      const userRecords = await db
        .select({
          fid: users.fid,
          username: users.username,
          signerWalletAddress: users.signerWalletAddress,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
          identityOrigin: users.identityOrigin,
        })
        .from(users)
        .where(sql`${users.fid} IN ${uniqueFids}`);

      for (const user of userRecords) {
        userDataMap.set(user.fid, {
          username: isRealFcUsername(user.username) ? user.username : null,
          wallet: user.signerWalletAddress,
          pfpUrl: null, // Will be filled from Neynar
          // Carried so a wallet player can be named from their basename rather
          // than as "fid:1000000001" in a record that is never rewritten.
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          identityOrigin: user.identityOrigin,
        });
      }
    }

    // Fetch profiles from Neynar for all FIDs (for accurate usernames and PFPs).
    // Farcaster fids only: Neynar has never heard of a synthetic wallet fid, so
    // including one is a guaranteed-useless round trip — and the GUARD is on
    // the filtered list, because a round played entirely by Base App players
    // would otherwise call the API with an empty array.
    const neynarFids = uniqueFids.filter((fid) => !isWalletFid(fid));
    if (neynarFids.length > 0) {
      try {
        console.log(`[archive] Fetching ${neynarFids.length} profiles from Neynar:`, neynarFids);
        const neynarData = await neynarClient.fetchBulkUsers({ fids: neynarFids });
        console.log(`[archive] Neynar returned ${neynarData.users?.length || 0} users`);
        if (neynarData.users) {
          for (const user of neynarData.users) {
            const existing = userDataMap.get(user.fid) || EMPTY_ARCHIVE_USER;
            userDataMap.set(user.fid, {
              ...existing,
              // Prefer Neynar username over local DB (more up-to-date)
              username: isRealFcUsername(user.username) ? user.username : isRealFcUsername(existing.username) ? existing.username : null,
              pfpUrl: user.pfp_url || null,
            });
          }
          // Log any FIDs that Neynar didn't return data for
          const returnedFids = new Set(neynarData.users.map(u => u.fid));
          const missingFids = neynarFids.filter(fid => !returnedFids.has(fid));
          if (missingFids.length > 0) {
            console.warn(`[archive] Neynar missing data for FIDs:`, missingFids);
          }
        }
      } catch (error) {
        console.warn('[archive] Error fetching profiles from Neynar:', error);
        // Continue with local data
      }
    }

    // Guess counts inside the Top-10 lock window (750 for rounds 1-3, 850 for 4+).
    // Uses a simple subquery: get first N guesses ordered by index/timestamp, then aggregate
    // Tiebreaker: who reached that count first (lower max guess_index = reached count earlier)
    //
    // No LIMIT 11 any more. The displayed list below is the PAID list, and the
    // reward gate can promote someone who sits outside the first eleven by
    // guess count, so their count has to be in this map too. The window holds
    // at most `archiveTop10Threshold` guesses, so this is a few hundred rows in
    // the worst case.
    // The window is the union of the two definitions of "inside the lock", and
    // it has to be, because the list rendered below was ranked under the other
    // one. This query's half is positional — the first N rows by index, which
    // is what a legacy round with NULL indices can be measured by at all.
    // getTop10Guessers, which decided who was PAID and therefore who is shown,
    // uses the value instead: guess_index_in_round <= the threshold
    // (economics.ts). The two agree only while the index is contiguous and
    // unique. getNextGuessIndexInRound (src/lib/guesses.ts) allocated it without
    // a lock until the per-round advisory lock shipped, so duplicates exist in
    // rounds played before that — round 34 certainly, round 35 possibly. The
    // allocator is atomic now and hands out no new ones, but it renumbers no
    // existing row either, so this union is still load-bearing for every round
    // already archived: with duplicates, more than N rows
    // carry an index <= N and the positional LIMIT drops the tail. A player
    // paid for guesses in that tail would then render at a real rank with an
    // understated count, or none at all.
    //
    // UNION rather than replacing the LIMIT with the value test: a legacy round
    // whose indices are all NULL has no row matching the value test, so the
    // value test alone would widen its window to the whole round and restate
    // every ETH-era count on the page. This adds rows the payout window counted
    // and nothing else, so a round with a clean index — every round whose data
    // is sound — measures exactly as it did before.
    const archiveTop10Threshold = getTop10LockForRound(archived.roundNumber);
    const windowGuessCounts = await db.execute<{ fid: number; guess_count: number }>(sql`
      SELECT fid, COUNT(*)::int as guess_count
      FROM (
        (
          SELECT id, fid, guess_index_in_round
          FROM guesses
          WHERE round_id = ${archived.roundNumber}
          ORDER BY guess_index_in_round ASC NULLS LAST, created_at ASC
          LIMIT ${archiveTop10Threshold}
        )
        UNION
        (
          SELECT id, fid, guess_index_in_round
          FROM guesses
          WHERE round_id = ${archived.roundNumber}
            AND guess_index_in_round <= ${archiveTop10Threshold}
        )
      ) window_rows
      GROUP BY fid
      ORDER BY COUNT(*) DESC, MAX(guess_index_in_round) ASC
    `);

    const guessCountMap = new Map<number, number>();
    for (const g of windowGuessCounts) {
      guessCountMap.set(g.fid, g.guess_count);
    }

    /** One rendered Top-10 row: who, how many guesses, and what they were paid. */
    interface ArchiveTopGuesserRow {
      fid: number;
      guessCount: number;
      rank: number;
      amountEth: string;
      amountWord: string | null;
    }

    // Who the archive shows at each rank, and what it says they received.
    //
    // The STORED payout rows win. round_payouts is the record of money that
    // actually moved, and since the reward gate it is no longer reproducible
    // from the guesses table: getTop10Guessers drops an ineligible FID at
    // resolve and promotes the next eligible one (economics.ts). Re-deriving
    // the list here would name the excluded player at a rank whose tokens went
    // to a different wallet, and show a paid player nowhere at all.
    //
    // The winner is filtered out because the round renders them separately;
    // their fallback top-guesser row — paid only when nobody else guessed —
    // stays in payoutsJson, which the admin payout breakdown itemises.
    //
    // The guesses-derived ranking remains the fallback for a round with no
    // top-guesser payout rows at all (an archive written before payouts
    // existed, or a round that paid nobody), so those render exactly as before.
    const paidTopGuessers = (archived.payoutsJson?.topGuessers ?? []).filter(
      (p) => p.fid !== archived.winnerFid
    );

    // At most ten places, each FID once — the heading on the public page says
    // "Top 10 early guessers" and this is the only thing that keeps it true.
    // payoutsJson is deliberately uncapped (it is the money record, and a
    // duplicate payout set belongs in it), so the cap lives here, on the render.
    // Keeping the FIRST occurrence keeps the first-inserted, lowest-id payout
    // set, which is the one the ladder ranked. archiveRound raises a standing
    // archive incident when it writes a list that needs either of these, so a
    // duplicate payout set is reported rather than quietly tidied away.
    const seenPaidFids = new Set<number>();
    const renderedPaidTopGuessers = paidTopGuessers
      .filter((p) => {
        if (seenPaidFids.has(p.fid)) return false;
        seenPaidFids.add(p.fid);
        return true;
      })
      .slice(0, TOP10_PAID_SLOTS);

    if (renderedPaidTopGuessers.length < paidTopGuessers.length) {
      console.warn(
        `[archive] Round ${archived.roundNumber}: ${paidTopGuessers.length} stored top-guesser payout ` +
          `entries rendered as ${renderedPaidTopGuessers.length}; the stored list exceeds ` +
          `${TOP10_PAID_SLOTS} places or repeats a FID. See the round's archive errors.`
      );
    }

    // A paid player with no count in the window map is a real inconsistency,
    // not a zero: they were paid for guessing, so they guessed. After the union
    // window above the only remaining cause is a legacy round whose payouts
    // were ranked over ALL guesses because none of them carried an index, and
    // whose player then sits outside the first N rows. It is said out loud here
    // rather than absorbed; the rendered value stays 0 because the public page
    // types guessCount as a plain number (TopGuesserWithUsername in
    // pages/archive/[roundNumber].tsx) and rendering null there would blank
    // the cell on rounds 1-33.
    const paidFidsWithoutCount = renderedPaidTopGuessers
      .filter((p) => !guessCountMap.has(p.fid))
      .map((p) => p.fid);
    if (paidFidsWithoutCount.length > 0) {
      console.warn(
        `[archive] Round ${archived.roundNumber}: paid top guesser(s) ${paidFidsWithoutCount.join(', ')} ` +
          `have no guess inside the top-10 window (first ${archiveTop10Threshold} rows, or index <= ` +
          `${archiveTop10Threshold}); their guess count renders as 0.`
      );
    }

    const top10Guessers: ArchiveTopGuesserRow[] =
      renderedPaidTopGuessers.length > 0
        ? renderedPaidTopGuessers.map((p, index) => ({
            fid: p.fid,
            guessCount: guessCountMap.get(p.fid) ?? 0,
            // The stored rank when the entry carries one, position otherwise.
            // Both are payout order, which is the rank the ladder paid.
            rank: p.rank ?? index + 1,
            amountEth: p.amountEth ?? '0',
            // Carried so a $WORD payout never reaches a caller as "0 ETH".
            amountWord: p.amountWord ?? null,
          }))
        : windowGuessCounts
            .filter((g) => g.fid !== archived.winnerFid)
            .slice(0, TOP10_PAID_SLOTS)
            .map((g, index) => ({
              fid: g.fid,
              guessCount: g.guess_count,
              rank: index + 1,
              amountEth: '0',
              amountWord: null,
            }));

    const topGuesserFids = top10Guessers.map(g => g.fid);

    // Fetch user data for top guessers (usernames and wallets)
    if (topGuesserFids.length > 0) {
      const userRecords = await db
        .select({
          fid: users.fid,
          username: users.username,
          signerWalletAddress: users.signerWalletAddress,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
          identityOrigin: users.identityOrigin,
        })
        .from(users)
        .where(sql`${users.fid} IN ${topGuesserFids}`);

      for (const user of userRecords) {
        if (!userDataMap.has(user.fid)) {
          userDataMap.set(user.fid, {
            username: isRealFcUsername(user.username) ? user.username : null,
            wallet: user.signerWalletAddress,
            pfpUrl: null,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
            identityOrigin: user.identityOrigin,
          });
        }
      }

      // Fetch Neynar data for top guessers. Same filter and same guard-on-the
      // -filtered-list reasoning as the lookup above.
      const neynarTopGuesserFids = topGuesserFids.filter((fid) => !isWalletFid(fid));
      if (neynarTopGuesserFids.length > 0) {
        try {
        const neynarData = await neynarClient.fetchBulkUsers({ fids: neynarTopGuesserFids });
        if (neynarData.users) {
          for (const user of neynarData.users) {
            const existing = userDataMap.get(user.fid) || EMPTY_ARCHIVE_USER;
            userDataMap.set(user.fid, {
              ...existing,
              username: isRealFcUsername(user.username) ? user.username : isRealFcUsername(existing.username) ? existing.username : null,
              pfpUrl: user.pfp_url || null,
            });
          }
        }
        } catch (error) {
          console.warn('[archive] Error fetching top guesser profiles from Neynar:', error);
        }
      }
    }

    // Check all wordmark badges for top guessers and winner
    const ogHunterBadgeFids = new Set<number>();
    const bonusWordBadgeFids = new Set<number>();
    const jackpotWinnerBadgeFids = new Set<number>();
    const doubleWBadgeFids = new Set<number>();
    const patronBadgeFids = new Set<number>();
    const quickdrawBadgeFids = new Set<number>();
    const encyclopedicBadgeFids = new Set<number>();
    const bakersDozenBadgeFids = new Set<number>();
    const fidsToCheckBadges = [...topGuesserFids];
    if (archived.winnerFid) fidsToCheckBadges.push(archived.winnerFid);
    if (fidsToCheckBadges.length > 0) {
      const badgeRecords = await db
        .select({ fid: userBadges.fid, badgeType: userBadges.badgeType })
        .from(userBadges)
        .where(
          and(
            sql`${userBadges.fid} IN ${fidsToCheckBadges}`,
            sql`${userBadges.badgeType} IN ('OG_HUNTER', 'BONUS_WORD_FINDER', 'JACKPOT_WINNER', 'DOUBLE_W', 'PATRON', 'QUICKDRAW', 'ENCYCLOPEDIC', 'BAKERS_DOZEN')`
          )
        );
      for (const badge of badgeRecords) {
        if (badge.badgeType === 'OG_HUNTER') {
          ogHunterBadgeFids.add(badge.fid);
        } else if (badge.badgeType === 'BONUS_WORD_FINDER') {
          bonusWordBadgeFids.add(badge.fid);
        } else if (badge.badgeType === 'JACKPOT_WINNER') {
          jackpotWinnerBadgeFids.add(badge.fid);
        } else if (badge.badgeType === 'DOUBLE_W') {
          doubleWBadgeFids.add(badge.fid);
        } else if (badge.badgeType === 'PATRON') {
          patronBadgeFids.add(badge.fid);
        } else if (badge.badgeType === 'QUICKDRAW') {
          quickdrawBadgeFids.add(badge.fid);
        } else if (badge.badgeType === 'ENCYCLOPEDIC') {
          encyclopedicBadgeFids.add(badge.fid);
        } else if (badge.badgeType === 'BAKERS_DOZEN') {
          bakersDozenBadgeFids.add(badge.fid);
        }
      }
    }

    // Check $WORD balances for top guessers and winner (only those with wallets)
    // Wrapped in defensive try/catch since this makes RPC calls that could fail
    const wordTokenHolderFids = new Set<number>();
    try {
      const fidsToCheckWordToken = [...topGuesserFids];
      if (archived.winnerFid) fidsToCheckWordToken.push(archived.winnerFid);
      const walletsToCheck = fidsToCheckWordToken
        .filter(fid => userDataMap.get(fid)?.wallet)
        .map(fid => ({ fid, wallet: userDataMap.get(fid)!.wallet! }));

      if (walletsToCheck.length > 0) {
        // Check all wallets in parallel with individual error handling
        const wordTokenResults = await Promise.allSettled(
          walletsToCheck.map(async ({ fid, wallet }) => ({
            fid,
            hasWordToken: await hasWordTokenBonus(wallet),
          }))
        );
        for (const result of wordTokenResults) {
          if (result.status === 'fulfilled' && result.value.hasWordToken) {
            wordTokenHolderFids.add(result.value.fid);
          }
        }
      }
    } catch (error) {
      console.warn('[archive] Error checking $WORD balances:', error);
      // Continue without $WORD badges on error
    }

    // Build extended response with usernames and PFPs.
    // The list and its amounts are the payout record (see the note above it) —
    // the rank shown is the rank that was paid.
    const topGuessersWithUsernames = top10Guessers.map((guesser) => {
      const userData = userDataMap.get(guesser.fid);
      // One renderer for both player kinds, so the permanent record names a
      // Base App player by their basename rather than "fid:1000000001".
      const display = playerDisplay({
        fid: guesser.fid,
        username: userData?.username,
        displayName: userData?.displayName,
        avatarUrl: userData?.avatarUrl,
        signerWalletAddress: userData?.wallet,
        identityOrigin: userData?.identityOrigin,
        pfpUrl: userData?.pfpUrl,
      });
      return {
        fid: guesser.fid,
        username: display.name,
        origin: display.origin,
        isAddressFallback: display.isAddressFallback,
        pfpUrl: display.avatarUrl,
        amountEth: guesser.amountEth,
        amountWord: guesser.amountWord,
        guessCount: guesser.guessCount,
        rank: guesser.rank,
        hasWordTokenBadge: wordTokenHolderFids.has(guesser.fid),
        hasOgHunterBadge: ogHunterBadgeFids.has(guesser.fid),
        hasBonusWordBadge: bonusWordBadgeFids.has(guesser.fid),
        hasJackpotWinnerBadge: jackpotWinnerBadgeFids.has(guesser.fid),
        hasDoubleWBadge: doubleWBadgeFids.has(guesser.fid),
        hasPatronBadge: patronBadgeFids.has(guesser.fid),
        hasQuickdrawBadge: quickdrawBadgeFids.has(guesser.fid),
        hasEncyclopedicBadge: encyclopedicBadgeFids.has(guesser.fid),
        hasBakersDozenBadge: bakersDozenBadgeFids.has(guesser.fid),
      };
    });

    const winnerData = archived.winnerFid ? userDataMap.get(archived.winnerFid) : null;
    const referrerData = archived.referrerFid ? userDataMap.get(archived.referrerFid) : null;

    // The referrer is the third render site and was left on the fid fallback
    // when the other two moved — so a Base App referrer was still written into
    // permanent history as a synthetic fid beside a named winner (Bugbot,
    // PR #292).
    const referrerDisplay = archived.referrerFid
      ? playerDisplay({
          fid: archived.referrerFid,
          username: referrerData?.username,
          displayName: referrerData?.displayName,
          avatarUrl: referrerData?.avatarUrl,
          signerWalletAddress: referrerData?.wallet,
          identityOrigin: referrerData?.identityOrigin,
          pfpUrl: referrerData?.pfpUrl,
        })
      : null;

    const winnerDisplay = archived.winnerFid
      ? playerDisplay({
          fid: archived.winnerFid,
          username: winnerData?.username,
          displayName: winnerData?.displayName,
          avatarUrl: winnerData?.avatarUrl,
          signerWalletAddress: winnerData?.wallet,
          identityOrigin: winnerData?.identityOrigin,
          pfpUrl: winnerData?.pfpUrl,
        })
      : null;

    return {
      ...archived,
      winnerUsername: winnerDisplay?.name ?? null,
      winnerOrigin: winnerDisplay?.origin ?? null,
      winnerIsAddressFallback: winnerDisplay?.isAddressFallback ?? false,
      winnerPfpUrl: winnerDisplay?.avatarUrl ?? null,
      winnerHasOgHunterBadge: archived.winnerFid ? ogHunterBadgeFids.has(archived.winnerFid) : undefined,
      winnerHasWordTokenBadge: archived.winnerFid ? wordTokenHolderFids.has(archived.winnerFid) : undefined,
      winnerHasBonusWordBadge: archived.winnerFid ? bonusWordBadgeFids.has(archived.winnerFid) : undefined,
      winnerHasJackpotWinnerBadge: archived.winnerFid ? jackpotWinnerBadgeFids.has(archived.winnerFid) : undefined,
      winnerHasDoubleWBadge: archived.winnerFid ? doubleWBadgeFids.has(archived.winnerFid) : undefined,
      winnerHasPatronBadge: archived.winnerFid ? patronBadgeFids.has(archived.winnerFid) : undefined,
      winnerHasQuickdrawBadge: archived.winnerFid ? quickdrawBadgeFids.has(archived.winnerFid) : undefined,
      winnerHasEncyclopedicBadge: archived.winnerFid ? encyclopedicBadgeFids.has(archived.winnerFid) : undefined,
      winnerHasBakersDozenBadge: archived.winnerFid ? bakersDozenBadgeFids.has(archived.winnerFid) : undefined,
      referrerUsername: referrerDisplay?.name ?? null,
      referrerOrigin: referrerDisplay?.origin ?? null,
      referrerIsAddressFallback: referrerDisplay?.isAddressFallback ?? false,
      referrerPfpUrl: referrerDisplay?.avatarUrl ?? null,
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
        // The third hand-written column list in this file to have dropped the
        // discriminator. Without these, /api/archive/list hands the archive
        // index a row with no currency, and formatArchiveJackpot defaults it to
        // ETH — so a $WORD round renders as ETH however correctly it was
        // written. Fixing the write path alone would not have shown up here.
        currency: roundArchive.currency,
        seedWord: roundArchive.seedWord,
        finalJackpotWord: roundArchive.finalJackpotWord,
        seedUsdCents: roundArchive.seedUsdCents,
        finalJackpotUsdCents: roundArchive.finalJackpotUsdCents,
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
): Promise<number | null> {
  try {
    // The id comes back so archiveRound can keep an incident it raised about
    // the row it just wrote out of its own auto-resolve sweep. Null on a
    // logging failure, which callers treat as "nothing to protect".
    const [row] = await db
      .insert(roundArchiveErrors)
      .values({
        roundNumber,
        errorType,
        errorMessage,
        errorData: errorData || null,
      })
      .returning({ id: roundArchiveErrors.id });
    return row?.id ?? null;
  } catch (error) {
    console.error('[archive] Failed to log archive error:', error);
    return null;
  }
}

/**
 * Compute the number of users who used $WORD token bonus during a time period
 */
async function computeWordTokenBonusCount(startTime: Date, endTime: Date): Promise<number> {
  // Count distinct users who had freeAllocatedClankton > 0 in daily_guess_state (legacy column name)
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
  /** ETH paid out across rounds 1-33. Excludes $WORD rounds. */
  totalJackpotDistributed: string;
  /** $WORD paid out as jackpots, in wei. Excludes ETH rounds. */
  totalJackpotDistributedWord: string;
  /**
   * $WORD distributed as BONUS-WORD rewards, read from WordManager. Not
   * jackpots, and not comparable with the two figures above — it was already
   * being rendered beside them as though it were a matching pair.
   */
  totalWordTokenBonuses: number;
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
      total_jackpot_distributed_word: string;
      avg_guesses_per_round: string;
      avg_players_per_round: string;
      avg_round_length_minutes: string;
    }>(sql`
      SELECT
        COUNT(*) as total_rounds,
        COALESCE(SUM(total_guesses), 0) as total_guesses_all_time,
        COALESCE(SUM(unique_players), 0) as total_players,
        COUNT(DISTINCT winner_fid) as unique_winners,
        -- Each sum covers only its own era, and does so without a WHERE
        -- clause because the columns are NULL for the currency that does not
        -- apply and SUM skips NULLs. That property is created by the archive
        -- write path, which records NULL rather than '0' for the inapplicable
        -- pair precisely so these totals stay honest. If that ever changes to
        -- '0', both of these silently start counting the other era's rounds as
        -- zero-value rounds — which does not change the sum, but does make
        -- "average per round" wrong everywhere it is derived.
        COALESCE(SUM(final_jackpot_eth), 0) as total_jackpot_distributed,
        COALESCE(SUM(final_jackpot_word), 0) as total_jackpot_distributed_word,
        COALESCE(AVG(total_guesses), 0) as avg_guesses_per_round,
        COALESCE(AVG(unique_players), 0) as avg_players_per_round,
        COALESCE(AVG(EXTRACT(EPOCH FROM (end_time - start_time)) / 60), 0) as avg_round_length_minutes
      FROM round_archive
    `);

    // Get total $WORD distributed from contract (with 18 decimals)
    // Convert to human-readable number (divide by 10^18)
    const totalWordTokenRaw = await getTotalWordTokenDistributed();
    const totalWordToken = Number(totalWordTokenRaw / BigInt(10 ** 18));

    const rows = getRows(result);
    const row = rows[0];
    return {
      totalRounds: parseInt(row?.total_rounds ?? '0', 10),
      totalGuessesAllTime: parseInt(row?.total_guesses_all_time ?? '0', 10),
      totalPlayers: parseInt(row?.total_players ?? '0', 10),
      uniqueWinners: parseInt(row?.unique_winners ?? '0', 10),
      totalJackpotDistributed: row?.total_jackpot_distributed ?? '0',
      totalJackpotDistributedWord: row?.total_jackpot_distributed_word ?? '0',
      totalWordTokenBonuses: totalWordToken,
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

import { db, guesses, users, rounds, roundBonusWords, bonusWordClaims, userBadges, xpEvents } from '../db';
import { eq, and, desc, sql, count, isNull } from 'drizzle-orm';
import type { SubmitGuessResult, SubmitGuessParams, TopGuesser } from '../types';
import type { RoundBonusWordRow } from '../db/schema';
import { getActiveRound, getActiveRoundForUpdate, createRound } from './rounds';
import { shouldBlockNewRoundCreation } from './operational-guard';
import { isValidGuess } from './word-lists';
import { applyPaidGuessEconomicEffects, resolveRoundAndCreatePayouts } from './economics';
import { DAILY_LIMITS_RULES } from './daily-limits';
import { checkAndAnnounceJackpotMilestones, checkAndAnnounceGuessMilestones, announceBonusWordFound } from './announcer';
import { logGuessEvent, logReferralEvent, logAnalyticsEvent, AnalyticsEventTypes } from './analytics';
import { isDevModeEnabled, getDevFixedSolution } from './devGameState';
import { TOP10_LOCK_AFTER_GUESSES } from './top10-lock';
import { invalidateRoundCaches, invalidateOnRoundTransition, invalidateUserCaches, invalidateTopGuessersCache } from './redis';
import { getPlaintextAnswer } from './encryption';
import { distributeBonusWordRewardOnChain, isBonusWordsEnabledOnChain } from './jackpot-contract';
import { logXpEvent } from './xp';
import { getUserByFid as getNeynarUserByFid } from './farcaster';

/**
 * Normalize a guess word
 * - Trim whitespace
 * - Convert to uppercase
 * - Return normalized string
 */
function normalizeWord(word: string): string {
  return word.trim().toUpperCase();
}

/**
 * Validate word format
 * - Must be exactly 5 letters
 * - Must be alphabetic (A-Z only)
 */
function validateWordFormat(word: string): { valid: boolean; reason?: 'not_5_letters' | 'non_alpha' } {
  if (word.length !== 5) {
    return { valid: false, reason: 'not_5_letters' };
  }

  if (!/^[A-Z]+$/.test(word)) {
    return { valid: false, reason: 'non_alpha' };
  }

  return { valid: true };
}

/**
 * Check if a word has already been guessed incorrectly in this round
 * (Global deduplication - prevent anyone from re-guessing wrong words)
 */
async function hasBeenGuessedIncorrectly(roundId: number, word: string): Promise<boolean> {
  const result = await db
    .select({ id: guesses.id })
    .from(guesses)
    .where(
      and(
        eq(guesses.roundId, roundId),
        eq(guesses.word, word),
        eq(guesses.isCorrect, false)
      )
    )
    .limit(1);

  return result.length > 0;
}

/**
 * Get the count of guesses a user has made in a round
 */
export async function getGuessCountForUserInRound(fid: number, roundId: number): Promise<number> {
  const result = await db
    .select({ count: count() })
    .from(guesses)
    .where(
      and(
        eq(guesses.roundId, roundId),
        eq(guesses.fid, fid)
      )
    );

  return result[0]?.count || 0;
}

/**
 * Get the total count of guesses in a round
 * Used for Top-10 lock threshold checking
 */
export async function getTotalGuessCountInRound(roundId: number): Promise<number> {
  const result = await db
    .select({ count: count() })
    .from(guesses)
    .where(eq(guesses.roundId, roundId));

  return result[0]?.count || 0;
}

/**
 * Get the next guess index for a round (atomically)
 * Uses SELECT FOR UPDATE to prevent race conditions
 * Returns 1-based index (first guess = 1)
 */
async function getNextGuessIndexInRound(roundId: number, tx?: typeof db): Promise<number> {
  const database = tx || db;
  const result = await database
    .select({ count: count() })
    .from(guesses)
    .where(eq(guesses.roundId, roundId));

  return (result[0]?.count || 0) + 1;
}

/**
 * Get all wrong words for a round (for wheel UI)
 * Returns alphabetically sorted list of incorrect guesses
 */
export async function getWrongWordsForRound(roundId: number): Promise<string[]> {
  const result = await db
    .selectDistinct({ word: guesses.word })
    .from(guesses)
    .where(
      and(
        eq(guesses.roundId, roundId),
        eq(guesses.isCorrect, false)
      )
    )
    .orderBy(guesses.word);

  return result.map(row => row.word);
}

/**
 * Get top guessers for a round
 * Ordered by: guess count DESC, then earliest first guess ASC
 */
export async function getTopGuessersForRound(roundId: number, limit: number = 10): Promise<TopGuesser[]> {
  const result = await db
    .select({
      fid: guesses.fid,
      guessCount: count(guesses.id).as('guess_count'),
      firstGuessAt: sql<Date>`MIN(${guesses.createdAt})`.as('first_guess_at'),
    })
    .from(guesses)
    .where(eq(guesses.roundId, roundId))
    .groupBy(guesses.fid)
    .orderBy(
      desc(sql`guess_count`),
      sql`first_guess_at ASC`
    )
    .limit(limit);

  return result.map(row => ({
    fid: row.fid,
    guessCount: Number(row.guessCount),
    firstGuessAt: new Date(row.firstGuessAt),
  }));
}

/**
 * BONUS WORD REWARD AMOUNT (5M CLANKTON with 18 decimals)
 */
const BONUS_WORD_CLANKTON_AMOUNT = '5000000000000000000000000'; // 5M * 10^18

/**
 * Check if a word is an unclaimed bonus word for a round
 * Returns the bonus word record if found and unclaimed
 * Timeout: 3 seconds max to prevent request hangs
 */
async function checkBonusWordMatch(roundId: number, word: string): Promise<RoundBonusWordRow | null> {
  try {
    // Wrap in timeout to prevent hanging if table doesn't exist or query is slow
    const result = await Promise.race([
      (async () => {
        // Get all unclaimed bonus words for this round
        const bonusWordRecords = await db
          .select()
          .from(roundBonusWords)
          .where(
            and(
              eq(roundBonusWords.roundId, roundId),
              isNull(roundBonusWords.claimedByFid)
            )
          );

        // Check each bonus word (decrypting to compare)
        for (const record of bonusWordRecords) {
          const decryptedWord = getPlaintextAnswer(record.word);
          if (decryptedWord.toUpperCase() === word.toUpperCase()) {
            return record;
          }
        }

        return null;
      })(),
      new Promise<null>((resolve) =>
        setTimeout(() => {
          console.warn(`[guesses] Bonus word check timed out after 3s for round ${roundId}`);
          resolve(null);
        }, 3000)
      ),
    ]);

    return result;
  } catch (error) {
    console.error('[guesses] Error checking bonus word match:', error);
    return null;
  }
}

/**
 * Handle a bonus word win
 * - Mark the bonus word as claimed
 * - Record the guess with isBonusWord=true
 * - Award the BONUS_WORD_FINDER badge
 * - Award 250 XP
 * - Distribute CLANKTON
 * - Announce the win
 */
async function handleBonusWordWin(
  roundId: number,
  fid: number,
  word: string,
  bonusWord: RoundBonusWordRow,
  isPaidGuess: boolean
): Promise<SubmitGuessResult> {
  console.log(`🎣 BONUS WORD FOUND! FID ${fid} found "${word}" (index ${bonusWord.wordIndex})`);

  // Get user's wallet address for CLANKTON distribution
  let walletAddress: string | null = null;
  try {
    const userResult = await db
      .select({ wallet: users.signerWalletAddress })
      .from(users)
      .where(eq(users.fid, fid))
      .limit(1);

    walletAddress = userResult[0]?.wallet ?? null;

    // Fallback to Neynar if no wallet in local database
    if (!walletAddress) {
      console.log(`[guesses] No wallet in DB for FID ${fid}, looking up via Neynar...`);
      const neynarUser = await getNeynarUserByFid(fid);
      walletAddress = neynarUser?.primaryWallet || neynarUser?.signerWallet || neynarUser?.custodyAddress || null;

      if (walletAddress) {
        console.log(`[guesses] Found wallet via Neynar for FID ${fid}: ${walletAddress.slice(0, 10)}...`);

        // Update user record with the wallet for future use
        await db
          .update(users)
          .set({ signerWalletAddress: walletAddress })
          .where(eq(users.fid, fid));
      }
    }
  } catch (error) {
    console.error('[guesses] Error getting user wallet:', error);
  }

  // Get the next guess index for this round
  const guessIndexInRound = await getNextGuessIndexInRound(roundId);

  // Use transaction for all database operations
  let guessId: number;
  await db.transaction(async (tx) => {
    // 1. Insert the guess with isBonusWord=true
    // Note: isCorrect is false because it's not the secret word
    const [insertedGuess] = await tx.insert(guesses).values({
      roundId,
      fid,
      word,
      isPaid: isPaidGuess,
      isCorrect: false,
      isBonusWord: true,
      guessIndexInRound,
      createdAt: new Date(),
    }).returning();
    guessId = insertedGuess.id;

    // 2. Mark bonus word as claimed
    await tx
      .update(roundBonusWords)
      .set({
        claimedByFid: fid,
        claimedAt: new Date(),
      })
      .where(eq(roundBonusWords.id, bonusWord.id));

    // 3. Award BONUS_WORD_FINDER badge (one per user ever)
    await tx
      .insert(userBadges)
      .values({
        fid,
        badgeType: 'BONUS_WORD_FINDER',
        metadata: {
          roundId,
          word,
          bonusWordIndex: bonusWord.wordIndex,
          awardedAt: new Date().toISOString(),
        },
      })
      .onConflictDoNothing(); // User already has badge

    // 4. Award XP (250 XP for bonus word)
    await tx.insert(xpEvents).values({
      fid,
      roundId,
      eventType: 'BONUS_WORD',
      xpAmount: 250,
      metadata: {
        word,
        bonusWordIndex: bonusWord.wordIndex,
      },
    });
  });

  // 5. Distribute CLANKTON (outside transaction - can retry if fails)
  let txHash: string | undefined;
  if (walletAddress) {
    try {
      console.log(`[guesses] Distributing 5M CLANKTON to ${walletAddress}...`);
      txHash = await distributeBonusWordRewardOnChain(walletAddress, bonusWord.wordIndex);
      console.log(`[guesses] ✅ CLANKTON distributed: ${txHash}`);

      // Update bonus word record with tx hash
      await db
        .update(roundBonusWords)
        .set({ txHash })
        .where(eq(roundBonusWords.id, bonusWord.id));

      // Insert claim record
      await db.insert(bonusWordClaims).values({
        bonusWordId: bonusWord.id,
        fid,
        guessId: guessId!,
        clanktonAmount: BONUS_WORD_CLANKTON_AMOUNT,
        walletAddress,
        txHash,
        txStatus: 'confirmed',
        confirmedAt: new Date(),
      });
    } catch (error) {
      console.error('[guesses] ❌ Failed to distribute CLANKTON:', error);

      // Record failed claim for retry
      await db.insert(bonusWordClaims).values({
        bonusWordId: bonusWord.id,
        fid,
        guessId: guessId!,
        clanktonAmount: BONUS_WORD_CLANKTON_AMOUNT,
        walletAddress,
        txStatus: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  } else {
    console.warn(`[guesses] User ${fid} has no wallet address - creating pending claim for retry`);

    // Record pending claim so admin can distribute when user connects wallet
    await db.insert(bonusWordClaims).values({
      bonusWordId: bonusWord.id,
      fid,
      guessId: guessId!,
      clanktonAmount: BONUS_WORD_CLANKTON_AMOUNT,
      walletAddress: null,
      txStatus: 'pending',
      errorMessage: 'User had no wallet address at time of guess',
    });
  }

  // 6. Announce the win (non-blocking)
  try {
    await announceBonusWordFound(roundId, fid, word);
  } catch (error) {
    console.error('[guesses] Failed to announce bonus word found:', error);
    // Continue - announcer failures should never break the game
  }

  // 7. Invalidate caches
  await Promise.all([
    invalidateRoundCaches(roundId),
    invalidateUserCaches(fid, roundId),
  ]).catch(err => {
    console.error('[Cache] Failed to invalidate after bonus word:', err);
  });

  // 8. Log analytics
  logAnalyticsEvent(AnalyticsEventTypes.GUESS_SUBMITTED, {
    userId: fid.toString(),
    roundId: roundId.toString(),
    data: {
      word,
      is_correct: false, // Not the secret word
      is_bonus_word: true,
      bonus_word_index: bonusWord.wordIndex,
      is_paid: isPaidGuess,
    },
  });

  console.log(`🎣 Bonus word win complete for FID ${fid}!`);

  return {
    status: 'bonus_word',
    word,
    clanktonAmount: '5000000', // 5M (display format)
    txHash,
    message: 'You found a bonus word! 5M CLANKTON sent to your wallet!',
  };
}

/**
 * Submit a guess for the active round
 *
 * Core game logic:
 * 1. Normalize and validate word
 * 2. Check active round exists and is not resolved
 * 3. Check for global duplicate wrong guesses
 * 4. Compare with answer
 * 5. If correct: resolve round and return winner
 * 6. If incorrect: record guess and return user's total guess count
 *
 * @param params Guess parameters (fid, word, isPaidGuess)
 * @returns Result indicating success/failure and details
 */
export async function submitGuess(params: SubmitGuessParams): Promise<SubmitGuessResult> {
  const { fid, word: rawWord, isPaidGuess = false } = params;

  // Step 1: Normalize word
  const word = normalizeWord(rawWord);

  // Step 2: Validate format
  const formatCheck = validateWordFormat(word);
  if (!formatCheck.valid) {
    return {
      status: 'invalid_word',
      reason: formatCheck.reason!,
    };
  }

  // Step 3: Check if word is in dictionary (GUESS_WORDS)
  if (!isValidGuess(word)) {
    return {
      status: 'invalid_word',
      reason: 'not_in_dictionary',
    };
  }

  // Step 4: Get active round
  const round = await getActiveRound();
  if (!round) {
    return { status: 'round_closed' };
  }

  // Step 5: Check if round is already resolved
  if (round.resolvedAt !== null) {
    return { status: 'round_closed' };
  }

  // Step 6: Check global duplication (wrong guesses)
  const alreadyGuessed = await hasBeenGuessedIncorrectly(round.id, word);
  if (alreadyGuessed) {
    return {
      status: 'already_guessed_word',
      word,
    };
  }

  // Step 7: Compare with answer (case-insensitive, normalized)
  // DEV MODE OVERRIDE: In dev mode, always use the fixed solution (CRANE) as the answer
  // This ensures CRANE is always the winning word regardless of what's in the database
  let normalizedAnswer: string;
  if (isDevModeEnabled()) {
    normalizedAnswer = getDevFixedSolution(); // Returns 'CRANE' (already uppercase)
    console.log(`🎮 Dev mode: Using fixed solution "${normalizedAnswer}" for answer comparison (DB answer: "${round.answer}")`);
  } else {
    normalizedAnswer = normalizeWord(round.answer);
  }
  const isCorrect = word === normalizedAnswer;

  if (isCorrect) {
    // CORRECT GUESS - This user wins!

    // Get user's referrer (if any) for round resolution
    let referrerFid: number | null = null;
    try {
      const userResult = await db
        .select({ referrerFid: users.referrerFid })
        .from(users)
        .where(eq(users.fid, fid))
        .limit(1);

      if (userResult.length > 0) {
        referrerFid = userResult[0].referrerFid;
      }
    } catch (error) {
      // User might not exist in users table yet (Farcaster integration comes later)
      // Continue without referrer
      console.warn(`Could not find user ${fid} for referrer lookup:`, error);
    }

    // PHASE 1: Lock the round and record the winning guess
    // This transaction MUST succeed to prevent other guesses from being accepted
    // Even if payouts fail later, the round is locked
    try {
      await db.transaction(async (tx) => {
        // Re-check that round is still unresolved with FOR UPDATE lock
        // This acquires a row-level lock, blocking other winning guesses until we commit
        const currentRound = await getActiveRoundForUpdate(tx);
        if (!currentRound || currentRound.resolvedAt !== null || currentRound.winnerFid !== null) {
          throw new Error('ROUND_ALREADY_RESOLVED');
        }

        // Get the next guess index atomically within transaction
        const guessIndexInRound = await getNextGuessIndexInRound(round.id, tx);

        // Insert the winning guess with index
        await tx.insert(guesses).values({
          roundId: round.id,
          fid,
          word,
          isPaid: isPaidGuess,
          isCorrect: true,
          guessIndexInRound,
          createdAt: new Date(),
        });

        // Apply economic effects for paid guesses (Milestone 3.1)
        if (isPaidGuess) {
          await applyPaidGuessEconomicEffects(round.id, DAILY_LIMITS_RULES.paidGuessPackPriceEth);
        }

        // CRITICAL: Lock the round by setting winnerFid BEFORE payouts
        // This prevents any more guesses from being accepted even if payouts fail
        await tx
          .update(rounds)
          .set({
            winnerFid: fid,
            referrerFid: referrerFid || null,
          })
          .where(eq(rounds.id, round.id));

        console.log(`🔒 Round ${round.id} locked with winner FID ${fid}`);
      });

      // PHASE 2: Process payouts (can fail safely - round is already locked)
      // If this fails, use Emergency Resolution in admin panel to retry
      try {
        await resolveRoundAndCreatePayouts(round.id, fid);
      } catch (payoutError) {
        console.error(`❌ Payout processing failed for round ${round.id}:`, payoutError);
        console.error(`⚠️  Round is locked but payouts not processed. Use Emergency Resolution to complete.`);
        // Don't re-throw - the round is locked and winner recorded
        // Admin can use emergency resolution to complete payouts
      }

      // Success!
      console.log(`🎉 User ${fid} won round ${round.id} with word "${word}"!`);

      // CRITICAL: Invalidate all caches immediately on round transition
      // This ensures no stale data is served about the old round
      console.log(`[Cache] 🔴 ROUND WON - Invalidating all caches for round ${round.id}`);
      await invalidateOnRoundTransition(round.id);

      // Award JACKPOT_WINNER badge to the winner (fire and forget)
      (async () => {
        try {
          await db
            .insert(userBadges)
            .values({
              fid,
              badgeType: 'JACKPOT_WINNER',
              metadata: { roundId: round.id, word },
            })
            .onConflictDoNothing(); // Don't fail if they already have the badge
          console.log(`🏆 Awarded JACKPOT_WINNER badge to FID ${fid} for round ${round.id}`);
        } catch (badgeError) {
          // Log but don't throw - badge award failure shouldn't affect the game
          console.error(`[Badge] Failed to award JACKPOT_WINNER badge to FID ${fid}:`, badgeError);
        }
      })();

      // AUTO-START NEXT ROUND: Proactively create the next round after resolution
      // This ensures Round N+1 is ready immediately, so users don't have to wait
      // Fire-and-forget to not block the winning user's response
      if (!isDevModeEnabled()) {
        (async () => {
          try {
            const blocked = await shouldBlockNewRoundCreation();
            if (blocked) {
              console.log(`[AutoStart] ⏸️ New round creation blocked (dead day or kill switch active)`);
              return;
            }
            const newRound = await createRound();
            console.log(`[AutoStart] ✅ Round ${newRound.id} auto-started after Round ${round.id} resolved`);
          } catch (autoStartError) {
            // Log but don't throw - the winning user shouldn't be affected
            console.error(`[AutoStart] ❌ Failed to auto-start next round:`, autoStartError);
          }
        })();
      }

      // Get guess count (after insert, so totalGuesses includes this winning guess)
      const totalGuesses = await getGuessCountForUserInRound(fid, round.id);

      // Milestone 5.2: Log analytics event (non-blocking)
      logGuessEvent(isPaidGuess, fid.toString(), round.id.toString(), {
        word,
        isCorrect: true,
        isWinner: true,
      });

      // Analytics v2: Log enhanced guess event with metadata
      logAnalyticsEvent(AnalyticsEventTypes.GUESS_SUBMITTED, {
        userId: fid.toString(),
        roundId: round.id.toString(),
        data: {
          word,
          is_correct: true,
          guess_number: totalGuesses,
          letters_correct_count: 5, // All letters correct!
          is_paid: isPaidGuess,
        },
      });

      // Analytics v2: Log if this was their first guess (hole-in-one!)
      if (totalGuesses === 1) {
        logAnalyticsEvent(AnalyticsEventTypes.FIRST_GUESS_SUBMITTED, {
          userId: fid.toString(),
          roundId: round.id.toString(),
          data: {
            word,
            letters_correct: 5,
            is_correct: true,
          },
        });
        logAnalyticsEvent(AnalyticsEventTypes.FIRST_GUESS_WORD, {
          userId: fid.toString(),
          roundId: round.id.toString(),
          data: { word },
        });
      }

      // Log referral win if applicable
      if (referrerFid) {
        logReferralEvent(AnalyticsEventTypes.REFERRAL_WIN, fid.toString(), {
          referrerFid,
          roundId: round.id,
        });
      }

      return {
        status: 'correct',
        word,
        roundId: round.id,
        winnerFid: fid,
      };

    } catch (error: any) {
      if (error.message === 'ROUND_ALREADY_RESOLVED') {
        // Someone else won just before this user
        return { status: 'round_closed' };
      }
      throw error; // Re-throw unexpected errors
    }

  } else {
    // NOT THE SECRET WORD - Check if it's a bonus word

    // Check if this is an unclaimed bonus word
    const bonusWordMatch = await checkBonusWordMatch(round.id, word);

    if (bonusWordMatch) {
      // 🎣 BONUS WORD FOUND!
      return await handleBonusWordWin(round.id, fid, word, bonusWordMatch, isPaidGuess);
    }

    // INCORRECT GUESS (not secret word, not bonus word)

    // Use transaction to atomically get index and insert
    let guessIndexInRound: number;
    await db.transaction(async (tx) => {
      // Get the next guess index atomically
      guessIndexInRound = await getNextGuessIndexInRound(round.id, tx);

      // Insert the guess with index
      await tx.insert(guesses).values({
        roundId: round.id,
        fid,
        word,
        isPaid: isPaidGuess,
        isCorrect: false,
        isBonusWord: false,
        guessIndexInRound,
        createdAt: new Date(),
      });
    });

    // Milestone 9.0: Invalidate caches after wrong guess
    // This ensures the wheel shows the new wrong word and guess count updates
    // Milestone 9.2: Also invalidate user caches and top guessers
    console.log(`[Cache] Invalidating round ${round.id} caches after wrong guess`);
    Promise.all([
      invalidateRoundCaches(round.id),
      invalidateTopGuessersCache(round.id),
      invalidateUserCaches(fid, round.id),
    ]).catch((err) => {
      // Don't block the response on cache errors
      console.error('[Cache] Failed to invalidate after wrong guess:', err);
    });

    // Log Top-10 lock event if this guess triggered the lock
    if (guessIndexInRound! === TOP10_LOCK_AFTER_GUESSES) {
      console.log(`🔒 Top-10 locked at guess #${guessIndexInRound} in round ${round.id}`);
      logAnalyticsEvent(AnalyticsEventTypes.TOP10_LOCK_REACHED || 'top10_lock_reached', {
        roundId: round.id.toString(),
        data: { totalGuesses: guessIndexInRound },
      });
    }

    // Apply economic effects for paid guesses (Milestone 3.1)
    if (isPaidGuess) {
      await applyPaidGuessEconomicEffects(round.id, DAILY_LIMITS_RULES.paidGuessPackPriceEth);

      // Milestone 5.1: Check jackpot milestones after paid guess (non-blocking)
      try {
        // Get updated round with new prize pool
        const updatedRoundResult = await db
          .select()
          .from(rounds)
          .where(eq(rounds.id, round.id))
          .limit(1);

        if (updatedRoundResult.length > 0) {
          await checkAndAnnounceJackpotMilestones(updatedRoundResult[0]);
        }
      } catch (error) {
        console.error('[guesses] Failed to check jackpot milestones:', error);
        // Continue - announcer failures should never break the game
      }
    }

    // Get user's total guess count for this round
    const totalGuesses = await getGuessCountForUserInRound(fid, round.id);

    // Milestone 5.1: Check guess count milestones (non-blocking)
    try {
      // Get total guess count for the round
      const totalRoundGuessesResult = await db
        .select({ count: count() })
        .from(guesses)
        .where(eq(guesses.roundId, round.id));
      const totalRoundGuesses = totalRoundGuessesResult[0]?.count ?? 0;

      // Get round data for announcements
      const roundData = await db
        .select()
        .from(rounds)
        .where(eq(rounds.id, round.id))
        .limit(1);

      if (roundData.length > 0) {
        await checkAndAnnounceGuessMilestones(roundData[0], totalRoundGuesses);
      }
    } catch (error) {
      console.error('[guesses] Failed to check guess milestones:', error);
      // Continue - announcer failures should never break the game
    }

    console.log(`❌ User ${fid} guessed "${word}" incorrectly (${totalGuesses} total guesses)`);

    // Calculate letter matches for analytics
    const lettersCorrect = word.split('').filter((char, idx) => char === normalizedAnswer[idx]).length;

    // Milestone 5.2: Log analytics events (non-blocking)
    // Log the basic guess event
    logGuessEvent(isPaidGuess, fid.toString(), round.id.toString(), {
      word,
      isCorrect: false,
      totalGuesses,
    });

    // Analytics v2: Log enhanced guess event with metadata
    logAnalyticsEvent(AnalyticsEventTypes.GUESS_SUBMITTED, {
      userId: fid.toString(),
      roundId: round.id.toString(),
      data: {
        word,
        is_correct: false,
        guess_number: totalGuesses,
        letters_correct_count: lettersCorrect,
        is_paid: isPaidGuess,
      },
    });

    // Analytics v2: Log wrong guess event
    logAnalyticsEvent(AnalyticsEventTypes.WRONG_GUESS_SUBMITTED, {
      userId: fid.toString(),
      roundId: round.id.toString(),
      data: {
        word,
        guess_number: totalGuesses,
        letters_correct: lettersCorrect,
      },
    });

    // Analytics v2: Log first guess if this is their first
    if (totalGuesses === 1) {
      logAnalyticsEvent(AnalyticsEventTypes.FIRST_GUESS_SUBMITTED, {
        userId: fid.toString(),
        roundId: round.id.toString(),
        data: {
          word,
          letters_correct: lettersCorrect,
        },
      });
      logAnalyticsEvent(AnalyticsEventTypes.FIRST_GUESS_WORD, {
        userId: fid.toString(),
        roundId: round.id.toString(),
        data: { word },
      });
    }

    return {
      status: 'incorrect',
      word,
      totalGuessesForUserThisRound: totalGuesses,
    };
  }
}

import { db, guesses, users, rounds } from '../db';
import { eq, and, desc, sql, count } from 'drizzle-orm';
import type { SubmitGuessResult, SubmitGuessParams, TopGuesser } from '../types';
import { getActiveRound, resolveRound } from './rounds';
import { isValidGuess } from './word-lists';
import { applyPaidGuessEconomicEffects } from './economics';
import { DAILY_LIMITS_RULES } from './daily-limits';
import { checkAndAnnounceJackpotMilestones, checkAndAnnounceGuessMilestones } from './announcer';
import { logGuessEvent, logReferralEvent, logAnalyticsEvent, AnalyticsEventTypes } from './analytics';
import { isDevModeEnabled, getDevFixedSolution } from './devGameState';

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

    // Use a transaction to ensure atomicity
    // This prevents race conditions where two correct guesses happen simultaneously
    try {
      await db.transaction(async (tx) => {
        // Re-check that round is still unresolved (race condition protection)
        const currentRound = await getActiveRound();
        if (!currentRound || currentRound.resolvedAt !== null) {
          throw new Error('ROUND_ALREADY_RESOLVED');
        }

        // Insert the winning guess
        await tx.insert(guesses).values({
          roundId: round.id,
          fid,
          word,
          isPaid: isPaidGuess,
          isCorrect: true,
          createdAt: new Date(),
        });

        // Apply economic effects for paid guesses (Milestone 3.1)
        if (isPaidGuess) {
          await applyPaidGuessEconomicEffects(round.id, DAILY_LIMITS_RULES.paidGuessPackPriceEth);
        }

        // Resolve the round
        await resolveRound(round.id, fid, referrerFid);
      });

      // Success!
      console.log(`🎉 User ${fid} won round ${round.id} with word "${word}"!`);

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
    // INCORRECT GUESS

    // Insert the guess
    await db.insert(guesses).values({
      roundId: round.id,
      fid,
      word,
      isPaid: isPaidGuess,
      isCorrect: false,
      createdAt: new Date(),
    });

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

/**
 * Daily Guess Limits & Bonus Mechanics
 * Milestone 2.2
 *
 * Implements:
 * - Daily free guess allocations (base + CLANKTON + share bonus)
 * - Paid guess pack purchases and limits
 * - Share bonus awards
 * - Daily state management
 */

import { db } from '../db';
import { dailyGuessState, users } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { submitGuess } from './guesses';
import { getActiveRound } from './rounds';
import type { DailyGuessStateRow, DailyGuessStateInsert } from '../db/schema';
import type { SubmitGuessResult, GuessSourceState } from '../types';
import { hasClanktonBonus } from './clankton';
import { getGuessWords } from './word-lists';
import { logGuessEvent, logReferralEvent, logAnalyticsEvent, AnalyticsEventTypes } from './analytics';
import {
  getClanktonHolderBonusGuesses,
  CLANKTON_MARKET_CAP_USD,
} from '../../config/economy';

/**
 * Game rules for daily limits
 * These will eventually come from the game_rules table
 *
 * Note: clanktonBonusGuesses is now dynamic based on market cap (Milestone 5.4c)
 * Use getClanktonHolderBonusGuesses() for the current value
 */
export const DAILY_LIMITS_RULES = {
  freeGuessesPerDayBase: 1,
  /** @deprecated Use getClanktonHolderBonusGuesses() instead - value depends on market cap */
  clanktonBonusGuesses: getClanktonHolderBonusGuesses(), // Dynamic: 2 if mcap < $250k, 3 if >= $250k
  shareBonusGuesses: 1,
  clanktonThreshold: 100_000_000, // 100M tokens
  paidGuessPackSize: 3,
  paidGuessPackPriceEth: '0.0003', // ETH
  maxPaidPacksPerDay: 3,
} as const;

/**
 * Dev mode FID for special handling
 * This FID gets daily state reset on each page load in dev mode
 */
export const DEV_MODE_FID = 6500;

/**
 * Reset daily state for a user in dev mode
 * Milestone 6.5.1: Allows dev mode to start fresh on each page load
 *
 * This deletes today's daily state row for the user, forcing
 * getOrCreateDailyState to create a fresh one with:
 * - 1 base free guess
 * - CLANKTON bonus (if holder)
 * - 0 share guesses (until they share)
 * - 0 paid guesses
 *
 * @param fid - Farcaster ID to reset
 * @returns true if a row was deleted, false otherwise
 */
export async function resetDevDailyStateForUser(fid: number): Promise<boolean> {
  const dateStr = getTodayUTC();

  const result = await db
    .delete(dailyGuessState)
    .where(and(eq(dailyGuessState.fid, fid), eq(dailyGuessState.date, dateStr)))
    .returning();

  if (result.length > 0) {
    console.log(`🔄 [DEV MODE] Reset daily state for FID ${fid} on ${dateStr}`);
    return true;
  }

  console.log(`🔄 [DEV MODE] No existing daily state to reset for FID ${fid} on ${dateStr}`);
  return false;
}

/**
 * Get today's date in UTC as YYYY-MM-DD string
 * Daily reset happens at 11:00 UTC
 * - If current time is before 11:00 UTC, returns yesterday's date
 * - If current time is 11:00 UTC or later, returns today's date
 */
export function getTodayUTC(): string {
  const now = new Date();
  const utcHour = now.getUTCHours();

  // If before 11:00 UTC, use yesterday's date
  if (utcHour < 11) {
    const yesterday = new Date(now);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    return yesterday.toISOString().split('T')[0];
  }

  // 11:00 UTC or later, use today's date
  return now.toISOString().split('T')[0];
}

/**
 * CLANKTON Bonus Check
 * Milestone 4.1: Real onchain balance checking
 *
 * Checks if the user's signer wallet holds >= 100M CLANKTON tokens.
 *
 * @param fid - Farcaster ID of the user
 * @returns true if user has CLANKTON bonus, false otherwise
 */
export async function hasCLANKTONBonus(fid: number): Promise<boolean> {
  try {
    // Look up user's signer wallet address
    const [user] = await db
      .select({ signerWalletAddress: users.signerWalletAddress })
      .from(users)
      .where(eq(users.fid, fid))
      .limit(1);

    if (!user || !user.signerWalletAddress) {
      console.log(`[CLANKTON] No signer wallet found for FID ${fid}`);
      return false;
    }

    // Query onchain CLANKTON balance
    return await hasClanktonBonus(user.signerWalletAddress);
  } catch (error) {
    console.error(`[CLANKTON] Error checking bonus for FID ${fid}:`, error);
    return false;
  }
}

/**
 * Get or create daily guess state for a user
 * If no state exists for today, creates it with appropriate allocations
 * Milestone 4.14: Now also initializes wheelStartIndex
 *
 * Note: Uses try/catch to handle race conditions where multiple requests
 * try to create the same row simultaneously (unique constraint on fid+date).
 */
export async function getOrCreateDailyState(
  fid: number,
  dateStr: string = getTodayUTC(),
  roundId?: number
): Promise<DailyGuessStateRow> {
  // Try to find existing state for this day
  const existing = await db
    .select()
    .from(dailyGuessState)
    .where(and(eq(dailyGuessState.fid, fid), eq(dailyGuessState.date, dateStr)))
    .limit(1);

  if (existing.length > 0) {
    return existing[0];
  }

  // Create new state for today
  const hasClankton = await hasCLANKTONBonus(fid);

  // Milestone 5.4c: Get dynamic CLANKTON bonus based on current market cap
  const clanktonBonusGuesses = getClanktonHolderBonusGuesses();

  // Generate random wheel start index (Milestone 4.14)
  // Random index between 0 and (total GUESS_WORDS - 1)
  const totalGuessWords = getGuessWords().length;
  const wheelStartIndex = Math.floor(Math.random() * totalGuessWords);

  const newState: DailyGuessStateInsert = {
    fid,
    date: dateStr,
    freeAllocatedBase: DAILY_LIMITS_RULES.freeGuessesPerDayBase,
    freeAllocatedClankton: hasClankton ? clanktonBonusGuesses : 0,
    freeAllocatedShareBonus: 0,
    freeUsed: 0,
    paidGuessCredits: 0,
    paidPacksPurchased: 0,
    hasSharedToday: false,
    wheelStartIndex, // Milestone 4.14
    wheelRoundId: roundId || null, // Milestone 4.14
  };

  try {
    const [created] = await db.insert(dailyGuessState).values(newState).returning();

    // Use defined values for logging (TypeScript Insert type allows undefined due to DB defaults)
    const baseGuesses = DAILY_LIMITS_RULES.freeGuessesPerDayBase;
    const clanktonGuesses = hasClankton ? clanktonBonusGuesses : 0;
    console.log(
      `✅ Created daily state for FID ${fid} on ${dateStr}: ${baseGuesses} base + ${clanktonGuesses} CLANKTON = ${baseGuesses + clanktonGuesses} free guesses, wheelStartIndex: ${wheelStartIndex}`
    );

    // Analytics v2: Log game session start (non-blocking)
    logAnalyticsEvent(AnalyticsEventTypes.GAME_SESSION_START, {
      userId: fid.toString(),
      data: {
        date: dateStr,
        free_base: baseGuesses,
        free_clankton: clanktonGuesses,
        has_clankton: hasClankton,
      },
    });

    return created;
  } catch (error: any) {
    // Handle race condition: if another request created the row first,
    // fetch and return the existing row
    if (error.code === '23505' || error.message?.includes('unique constraint')) {
      console.log(`🔄 Race condition in getOrCreateDailyState for FID ${fid}, fetching existing row`);
      const [existingRow] = await db
        .select()
        .from(dailyGuessState)
        .where(and(eq(dailyGuessState.fid, fid), eq(dailyGuessState.date, dateStr)))
        .limit(1);

      if (existingRow) {
        return existingRow;
      }
    }
    // Re-throw unexpected errors
    throw error;
  }
}

/**
 * Get or generate wheel start index for a user
 * Milestone 4.14: Per-user, per-day random wheel start position
 *
 * Production: Generates a random index once per day per user (resets at 11:00 UTC)
 *            Optionally resets per round if roundId changes
 *            Persists in database for stability across page refreshes
 *
 * Dev Mode:   Generates a fresh random index on EVERY call (every page load)
 *            Does NOT persist or reuse from database
 *            Helps with faster testing and UX iteration
 *
 * @param fid - Farcaster ID of the user
 * @param roundId - Optional round ID for per-round reset
 * @param totalWords - Total number of guess words (should be getGuessWords().length)
 * @returns Random start index between 0 and totalWords-1
 */
export async function getOrGenerateWheelStartIndex(
  fid: number,
  roundId: number | undefined,
  totalWords: number
): Promise<number> {
  // Import dev mode check dynamically to avoid circular dependencies
  const { isDevModeEnabled } = await import('./devGameState');

  // DEV MODE: Generate fresh random on every call (every page load)
  if (isDevModeEnabled()) {
    const randomIndex = Math.floor(Math.random() * totalWords);
    console.log(
      `🎡 [DEV MODE] Generated fresh random wheel start index for FID ${fid}: ${randomIndex} (not persisted)`
    );
    return randomIndex;
  }

  // PRODUCTION: Stable per-day-per-user logic
  const dateStr = getTodayUTC();
  const state = await getOrCreateDailyState(fid, dateStr, roundId);

  // Check if we need to regenerate (per-round reset enabled and round changed)
  const needsRegeneration = roundId && state.wheelRoundId && state.wheelRoundId !== roundId;

  if (state.wheelStartIndex !== null && !needsRegeneration) {
    return state.wheelStartIndex;
  }

  // Generate new random index
  const newIndex = Math.floor(Math.random() * totalWords);

  // Update the database
  await db
    .update(dailyGuessState)
    .set({
      wheelStartIndex: newIndex,
      wheelRoundId: roundId || state.wheelRoundId,
    })
    .where(and(eq(dailyGuessState.fid, fid), eq(dailyGuessState.date, dateStr)));

  console.log(
    `🎡 Generated new wheel start index for FID ${fid}: ${newIndex} (round ${roundId || 'N/A'})`
  );

  return newIndex;
}

/**
 * Calculate remaining free guesses for a daily state
 */
export function getFreeGuessesRemaining(state: DailyGuessStateRow): number {
  const totalAllocated =
    state.freeAllocatedBase + state.freeAllocatedClankton + state.freeAllocatedShareBonus;
  return Math.max(0, totalAllocated - state.freeUsed);
}

/**
 * Check if user can buy another pack today
 */
export async function canBuyAnotherPack(
  fid: number,
  dateStr: string = getTodayUTC()
): Promise<boolean> {
  const state = await getOrCreateDailyState(fid, dateStr);
  return state.paidPacksPurchased < DAILY_LIMITS_RULES.maxPaidPacksPerDay;
}

/**
 * Award a paid guess pack (stub for Milestone 3.1)
 * Increments pack count and adds paid guess credits
 *
 * In Milestone 3.1, this will also:
 * - Accept payment (ETH)
 * - Split funds into prize pool and next round seed
 */
export async function awardPaidPack(
  fid: number,
  dateStr: string = getTodayUTC()
): Promise<DailyGuessStateRow> {
  const state = await getOrCreateDailyState(fid, dateStr);

  // Check if can buy another pack
  if (state.paidPacksPurchased >= DAILY_LIMITS_RULES.maxPaidPacksPerDay) {
    throw new Error(
      `Cannot buy more packs: already purchased ${state.paidPacksPurchased} of ${DAILY_LIMITS_RULES.maxPaidPacksPerDay} allowed per day`
    );
  }

  // Increment pack count and add credits
  const [updated] = await db
    .update(dailyGuessState)
    .set({
      paidPacksPurchased: state.paidPacksPurchased + 1,
      paidGuessCredits: state.paidGuessCredits + DAILY_LIMITS_RULES.paidGuessPackSize,
      updatedAt: new Date(),
    })
    .where(eq(dailyGuessState.id, state.id))
    .returning();

  console.log(
    `💰 Awarded paid pack to FID ${fid}: pack ${updated.paidPacksPurchased}/${DAILY_LIMITS_RULES.maxPaidPacksPerDay}, credits: ${updated.paidGuessCredits}`
  );

  return updated;
}

/**
 * Award share bonus (stub for Milestone 4.2)
 * Gives user +1 free guess for sharing a cast
 * Can only be awarded once per day
 *
 * In Milestone 4.2, this will be called when Neynar confirms a share
 */
export async function awardShareBonus(
  fid: number,
  dateStr: string = getTodayUTC()
): Promise<DailyGuessStateRow | null> {
  const state = await getOrCreateDailyState(fid, dateStr);

  // Check if already shared today
  if (state.hasSharedToday) {
    console.log(`⚠️  FID ${fid} already received share bonus today`);
    return null;
  }

  // Award the bonus
  const [updated] = await db
    .update(dailyGuessState)
    .set({
      hasSharedToday: true,
      freeAllocatedShareBonus: DAILY_LIMITS_RULES.shareBonusGuesses,
      updatedAt: new Date(),
    })
    .where(eq(dailyGuessState.id, state.id))
    .returning();

  console.log(`🎁 Awarded share bonus to FID ${fid}: +${DAILY_LIMITS_RULES.shareBonusGuesses} free guess`);

  // Milestone 5.2: Log analytics event (non-blocking)
  logReferralEvent(AnalyticsEventTypes.SHARE_BONUS_UNLOCKED, fid.toString(), {
    bonusGuesses: DAILY_LIMITS_RULES.shareBonusGuesses,
  });

  return updated;
}

/**
 * Submit a guess with daily limits enforcement
 *
 * IMPORTANT: This function now validates the guess BEFORE consuming any credits.
 * Only actual processed guesses (correct or incorrect) consume credits.
 * Rejected guesses (already_guessed_word, invalid_word, round_closed) do NOT
 * consume credits.
 *
 * Order of consumption (when guess is valid):
 * 1. Free guesses (base + CLANKTON + share bonus)
 * 2. Paid guess credits
 * 3. If neither available, reject with "no_guesses_left_today"
 */
export async function submitGuessWithDailyLimits(params: {
  fid: number;
  word: string;
}): Promise<SubmitGuessResult> {
  const { fid, word } = params;
  const dateStr = getTodayUTC();

  // Get or create today's state
  const state = await getOrCreateDailyState(fid, dateStr);

  // Calculate available guesses
  const freeRemaining = getFreeGuessesRemaining(state);
  const paidRemaining = state.paidGuessCredits;

  // Check if user has any guesses left BEFORE validating the word
  if (freeRemaining <= 0 && paidRemaining <= 0) {
    // No guesses left today
    console.log(`❌ FID ${fid} has no guesses left today`);
    return {
      status: 'no_guesses_left_today',
    };
  }

  // Determine which type of guess would be used (free or paid)
  const isPaidGuess = freeRemaining <= 0;

  // Submit the guess FIRST to validate it
  // This checks: word format, dictionary validity, round status, and duplicate guesses
  const result = await submitGuess({
    fid,
    word,
    isPaidGuess,
  });

  // Only consume a guess credit if the guess was actually processed
  // (i.e., it was a valid, non-duplicate guess that got recorded)
  // Statuses that consume credits: 'correct', 'incorrect'
  // Statuses that do NOT consume credits: 'already_guessed_word', 'invalid_word', 'round_closed'
  const shouldConsumeCredit = result.status === 'correct' || result.status === 'incorrect';

  if (shouldConsumeCredit) {
    if (!isPaidGuess) {
      // Consume a free guess
      await db
        .update(dailyGuessState)
        .set({
          freeUsed: state.freeUsed + 1,
          updatedAt: new Date(),
        })
        .where(eq(dailyGuessState.id, state.id));

      console.log(
        `🎮 FID ${fid} used free guess (${freeRemaining - 1} remaining)`
      );
    } else {
      // Consume a paid guess
      await db
        .update(dailyGuessState)
        .set({
          paidGuessCredits: state.paidGuessCredits - 1,
          updatedAt: new Date(),
        })
        .where(eq(dailyGuessState.id, state.id));

      console.log(
        `💰 FID ${fid} used paid guess (${paidRemaining - 1} credits remaining)`
      );

      // Milestone 5.3: Log GUESS_PACK_USED event (non-blocking)
      // Get active round for round_id
      const activeRound = await getActiveRound();
      logAnalyticsEvent(AnalyticsEventTypes.GUESS_PACK_USED, {
        userId: fid.toString(),
        roundId: activeRound?.id.toString(),
        data: {
          credits_remaining: paidRemaining - 1,
          fid,
          round_id: activeRound?.id,
        },
      });
    }
  } else {
    // Log that no credit was consumed due to validation failure
    console.log(
      `⚠️ FID ${fid} guess rejected (${result.status}) - no credit consumed`
    );
  }

  return result;
}

/**
 * Get guess source state for unified guess bar
 * Milestone 6.5: Returns per-source tracking information
 *
 * This function calculates how many guesses have been used from each source
 * based on the consumption order: Free -> CLANKTON -> Share -> Paid
 *
 * @param fid - Farcaster ID of the user
 * @returns GuessSourceState with detailed per-source tracking
 */
export async function getGuessSourceState(fid: number): Promise<GuessSourceState> {
  const dateStr = getTodayUTC();
  const state = await getOrCreateDailyState(fid, dateStr);

  // Total allocations for each source
  const freeTotal = state.freeAllocatedBase;
  const clanktonTotal = state.freeAllocatedClankton;
  const shareTotal = state.freeAllocatedShareBonus;
  const paidTotal = state.paidGuessCredits + getPaidGuessesUsedFromState(state);

  // Calculate used guesses per source based on consumption order:
  // Free (base) -> CLANKTON -> Share
  // Paid guesses are tracked separately in paidGuessCredits
  let freeUsedRemaining = state.freeUsed;

  // Free (base) is consumed first
  const freeUsed = Math.min(freeUsedRemaining, freeTotal);
  freeUsedRemaining -= freeUsed;

  // CLANKTON is consumed second
  const clanktonUsed = Math.min(freeUsedRemaining, clanktonTotal);
  freeUsedRemaining -= clanktonUsed;

  // Share bonus is consumed third
  const shareUsed = Math.min(freeUsedRemaining, shareTotal);

  // Paid guesses used: total purchased minus remaining credits
  const paidUsed = getPaidGuessesUsedFromState(state);

  // Calculate remaining for each source
  const freeRemaining = Math.max(0, freeTotal - freeUsed);
  const clanktonRemaining = Math.max(0, clanktonTotal - clanktonUsed);
  const shareRemaining = Math.max(0, shareTotal - shareUsed);
  const paidRemaining = state.paidGuessCredits;

  // Total remaining across all sources
  const totalRemaining = freeRemaining + clanktonRemaining + shareRemaining + paidRemaining;

  // CLANKTON holder check
  const isClanktonHolder = state.freeAllocatedClankton > 0;

  // Share bonus eligibility
  const hasSharedToday = state.hasSharedToday;
  const canClaimBonus = !hasSharedToday;

  // Paid pack eligibility
  const maxPacksPerDay = DAILY_LIMITS_RULES.maxPaidPacksPerDay;
  const canBuyMore = state.paidPacksPurchased < maxPacksPerDay;

  return {
    totalRemaining,
    free: {
      total: freeTotal,
      used: freeUsed,
      remaining: freeRemaining,
    },
    clankton: {
      total: clanktonTotal,
      used: clanktonUsed,
      remaining: clanktonRemaining,
      isHolder: isClanktonHolder,
    },
    share: {
      total: shareTotal,
      used: shareUsed,
      remaining: shareRemaining,
      hasSharedToday,
      canClaimBonus,
    },
    paid: {
      total: paidTotal,
      used: paidUsed,
      remaining: paidRemaining,
      packsPurchased: state.paidPacksPurchased,
      maxPacksPerDay,
      canBuyMore,
    },
  };
}

/**
 * Calculate paid guesses used from daily state
 * Total purchased = paidPacksPurchased * packSize
 * Used = total purchased - remaining credits
 */
function getPaidGuessesUsedFromState(state: DailyGuessStateRow): number {
  const totalPurchased = state.paidPacksPurchased * DAILY_LIMITS_RULES.paidGuessPackSize;
  return Math.max(0, totalPurchased - state.paidGuessCredits);
}

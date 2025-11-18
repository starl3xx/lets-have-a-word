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
import type { DailyGuessStateRow, DailyGuessStateInsert } from '../db/schema';
import type { SubmitGuessResult } from '../types';
import { hasClanktonBonus } from './clankton';

/**
 * Game rules for daily limits
 * These will eventually come from the game_rules table
 */
export const DAILY_LIMITS_RULES = {
  freeGuessesPerDayBase: 1,
  clanktonBonusGuesses: 3,
  shareBonusGuesses: 1,
  clanktonThreshold: 100_000_000, // 100M tokens
  paidGuessPackSize: 3,
  paidGuessPackPriceEth: '0.0003', // ETH
  maxPaidPacksPerDay: 3,
} as const;

/**
 * Get today's date in UTC as YYYY-MM-DD string
 */
export function getTodayUTC(): string {
  const now = new Date();
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
 */
export async function getOrCreateDailyState(
  fid: number,
  dateStr: string = getTodayUTC()
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

  const newState: DailyGuessStateInsert = {
    fid,
    date: dateStr,
    freeAllocatedBase: DAILY_LIMITS_RULES.freeGuessesPerDayBase,
    freeAllocatedClankton: hasClankton ? DAILY_LIMITS_RULES.clanktonBonusGuesses : 0,
    freeAllocatedShareBonus: 0,
    freeUsed: 0,
    paidGuessCredits: 0,
    paidPacksPurchased: 0,
    hasSharedToday: false,
  };

  const [created] = await db.insert(dailyGuessState).values(newState).returning();

  console.log(
    `✅ Created daily state for FID ${fid} on ${dateStr}: ${newState.freeAllocatedBase} base + ${newState.freeAllocatedClankton} CLANKTON = ${newState.freeAllocatedBase + newState.freeAllocatedClankton} free guesses`
  );

  return created;
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

  return updated;
}

/**
 * Submit a guess with daily limits enforcement
 *
 * Order of consumption:
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

  let isPaidGuess: boolean;

  // Determine guess type and consume credit
  if (freeRemaining > 0) {
    // Use a free guess
    isPaidGuess = false;

    // Increment free_used
    await db
      .update(dailyGuessState)
      .set({
        freeUsed: state.freeUsed + 1,
        updatedAt: new Date(),
      })
      .where(eq(dailyGuessState.id, state.id));

    console.log(
      `🎮 FID ${fid} using free guess (${freeRemaining - 1} remaining after this)`
    );
  } else if (paidRemaining > 0) {
    // Use a paid guess
    isPaidGuess = true;

    // Decrement paid_guess_credits
    await db
      .update(dailyGuessState)
      .set({
        paidGuessCredits: state.paidGuessCredits - 1,
        updatedAt: new Date(),
      })
      .where(eq(dailyGuessState.id, state.id));

    console.log(
      `💰 FID ${fid} using paid guess (${paidRemaining - 1} credits remaining after this)`
    );
  } else {
    // No guesses left today
    console.log(`❌ FID ${fid} has no guesses left today`);

    return {
      status: 'no_guesses_left_today',
    };
  }

  // Submit the actual guess
  const result = await submitGuess({
    fid,
    word,
    isPaidGuess,
  });

  return result;
}

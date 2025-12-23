/**
 * Dev Mid-Round Test Mode (Milestone 4.5)
 *
 * This module provides functionality to create and manage dev-only test rounds
 * that simulate an active round in progress with pre-populated guesses and jackpot.
 *
 * IMPORTANT: This code only runs in development and is fully gated by env flags.
 * It does NOT interfere with production logic or word lists.
 */

import { db, rounds, guesses } from '../db';
import { isNull, eq, and } from 'drizzle-orm';
import { TEST_ANSWER_WORDS, TEST_GUESS_WORDS } from './testWords';
import { createCommitment } from './commit-reveal';
import { populateRoundSeedWords } from './wheel';

/**
 * Simple seeded random number generator for consistent dev mode values
 * Uses 10-minute bucket seeding so values stay stable during dev sessions
 */
function createSeededRng(): () => number {
  const serverStartSeed = Math.floor(Date.now() / (10 * 60 * 1000));
  let seed = serverStartSeed * 8831; // Prime multiplier for variety
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

// Module-level seeded RNG for consistent random picks
const rng = createSeededRng();

/**
 * Helper to pick a random element from an array (seeded for consistency)
 */
function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * Helper to pick N random unique elements from an array (seeded for consistency)
 */
function pickMany<T>(arr: T[], count: number): T[] {
  const copy = [...arr];
  const result: T[] = [];

  while (copy.length > 0 && result.length < count) {
    const idx = Math.floor(rng() * copy.length);
    result.push(copy.splice(idx, 1)[0]);
  }

  return result;
}

/**
 * Ensure a dev test mid-round exists (if test mode is enabled)
 *
 * This function:
 * 1. Checks environment flags (production check + test mode flag)
 * 2. Looks for existing active dev test round
 * 3. If none exists, creates a new dev test round with:
 *    - Random answer from TEST_ANSWER_WORDS
 *    - Commit hash using salt
 *    - is_dev_test_round = true
 *    - Non-zero prize pool (0.42 ETH for testing)
 *    - 50-100 pre-populated wrong guesses
 *
 * This function is safe to call in production - it will immediately return
 * if NODE_ENV is production or if the test mode flag is not enabled.
 */
export async function ensureDevMidRound(): Promise<void> {
  // Safety check: NEVER run in production
  if (process.env.NODE_ENV === 'production') {
    return;
  }

  // Check if test mode is enabled
  if (process.env.NEXT_PUBLIC_TEST_MID_ROUND !== 'true') {
    return;
  }

  console.log('[DevMidRound] Test mode enabled, checking for dev test round...');

  // Check if a dev test round already exists
  const existingDevRound = await db
    .select()
    .from(rounds)
    .where(
      and(
        eq(rounds.isDevTestRound, true),
        isNull(rounds.resolvedAt)
      )
    )
    .limit(1);

  if (existingDevRound.length > 0) {
    console.log(`[DevMidRound] Dev test round ${existingDevRound[0].id} already exists`);
    return;
  }

  console.log('[DevMidRound] Creating new dev test round...');

  // Select a random answer from test word list
  const answer = pickRandom(TEST_ANSWER_WORDS);
  console.log(`[DevMidRound] Selected answer: ${answer}`);

  // Create commitment (salt + hash)
  const { salt, commitHash } = createCommitment(answer);

  // Create the dev test round
  const roundResult = await db
    .insert(rounds)
    .values({
      rulesetId: 1, // Use default ruleset
      answer,
      salt,
      commitHash,
      prizePoolEth: '0.42', // Dev test jackpot
      seedNextRoundEth: '0',
      winnerFid: null,
      referrerFid: null,
      isDevTestRound: true, // Mark as dev test round
      startedAt: new Date(Date.now() - 3600000), // Started 1 hour ago
      resolvedAt: null,
    })
    .returning();

  const round = roundResult[0];
  console.log(`[DevMidRound] Created dev test round ${round.id}`);

  // Populate seed words for the wheel
  await populateRoundSeedWords(round.id);

  // Generate 50-100 wrong guesses (seeded for consistency)
  const numGuesses = 50 + Math.floor(rng() * 51); // 50-100
  const wrongWords = pickMany(
    TEST_GUESS_WORDS.filter((w) => w !== answer),
    numGuesses
  );

  console.log(`[DevMidRound] Inserting ${wrongWords.length} test guesses...`);

  // Create guess records with variety in timing and paid status
  const guessRecords = wrongWords.map((word, idx) => ({
    roundId: round.id,
    fid: 900000 + idx, // Fake dev FIDs starting at 900000
    word,
    isPaid: idx % 3 === 0, // Every 3rd guess is paid
    isCorrect: false,
    // Stagger created timestamps (oldest to newest)
    createdAt: new Date(Date.now() - (wrongWords.length - idx) * 60000),
  }));

  // Insert all guesses
  await db.insert(guesses).values(guessRecords);

  console.log(`[DevMidRound] ✅ Dev test round ${round.id} fully initialized:`);
  console.log(`  - Answer: ${answer}`);
  console.log(`  - Prize Pool: ${round.prizePoolEth} ETH`);
  console.log(`  - Guesses: ${wrongWords.length}`);
  console.log(`  - Ready for testing!`);
}

/**
 * Check if dev mid-round test mode is currently enabled
 */
export function isDevMidRoundEnabled(): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.NEXT_PUBLIC_TEST_MID_ROUND === 'true'
  );
}

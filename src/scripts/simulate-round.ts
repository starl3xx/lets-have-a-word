/**
 * Round Simulation Script
 * Simulates a complete game round with fake users for testing on Sepolia
 *
 * This script:
 * 1. Creates a test round with a known answer
 * 2. Simulates multiple fake users making guesses
 * 3. Has one user eventually guess correctly
 * 4. Shows the full resolution flow
 *
 * Usage:
 *   npx tsx src/scripts/simulate-round.ts
 *   npx tsx src/scripts/simulate-round.ts --answer CRANE --guesses 50
 *
 * Options:
 *   --answer <word>   Force a specific 5-letter answer (default: random)
 *   --guesses <n>     Number of wrong guesses before winning (default: 20)
 *   --users <n>       Number of simulated users (default: 5)
 *   --delay <ms>      Delay between guesses in ms (default: 100)
 *   --skip-onchain    Skip onchain commitment (for testing without contract)
 *   --dry-run         Show what would happen without making changes
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { createRound, getActiveRound, resolveRound, getRoundById } from '../lib/rounds';
import { submitGuess } from '../lib/guesses';
import { getGuessWords, getAnswerWords } from '../lib/word-lists';
import { db, users, guesses, dailyGuessState } from '../db';
import { eq } from 'drizzle-orm';

// =============================================================================
// Configuration
// =============================================================================

interface SimulationConfig {
  answer?: string;
  numGuesses: number;
  numUsers: number;
  delayMs: number;
  skipOnchain: boolean;
  dryRun: boolean;
}

function parseArgs(): SimulationConfig {
  const args = process.argv.slice(2);
  const config: SimulationConfig = {
    numGuesses: 20,
    numUsers: 5,
    delayMs: 100,
    skipOnchain: false,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--answer':
        config.answer = args[++i]?.toUpperCase();
        break;
      case '--guesses':
        config.numGuesses = parseInt(args[++i] || '20', 10);
        break;
      case '--users':
        config.numUsers = parseInt(args[++i] || '5', 10);
        break;
      case '--delay':
        config.delayMs = parseInt(args[++i] || '100', 10);
        break;
      case '--skip-onchain':
        config.skipOnchain = true;
        break;
      case '--dry-run':
        config.dryRun = true;
        break;
    }
  }

  return config;
}

// =============================================================================
// Fake User Management
// =============================================================================

// Use high FID numbers to avoid conflicts with real users
const FAKE_FID_BASE = 9000000;

interface FakeUser {
  fid: number;
  username: string;
  walletAddress: string;
}

function generateFakeUsers(count: number): FakeUser[] {
  const users: FakeUser[] = [];
  for (let i = 0; i < count; i++) {
    users.push({
      fid: FAKE_FID_BASE + i,
      username: `sim_user_${i}`,
      walletAddress: `0x${(i + 1).toString(16).padStart(40, '0')}`,
    });
  }
  return users;
}

async function ensureFakeUsersExist(fakeUsers: FakeUser[]): Promise<void> {
  console.log(`\n📝 Ensuring ${fakeUsers.length} fake users exist in database...`);

  for (const user of fakeUsers) {
    // Upsert user
    await db
      .insert(users)
      .values({
        fid: user.fid,
        username: user.username,
        signerWalletAddress: user.walletAddress,
      })
      .onConflictDoNothing();
  }

  console.log(`   ✅ Fake users ready: FIDs ${FAKE_FID_BASE} - ${FAKE_FID_BASE + fakeUsers.length - 1}`);
}

async function cleanupFakeUsers(fakeUsers: FakeUser[], roundId: number): Promise<void> {
  console.log(`\n🧹 Cleaning up simulation data...`);

  // Delete daily states for fake users
  for (const user of fakeUsers) {
    await db.delete(dailyGuessState).where(eq(dailyGuessState.fid, user.fid));
  }

  console.log(`   ✅ Cleaned up daily states for ${fakeUsers.length} fake users`);
}

// =============================================================================
// Word Selection
// =============================================================================

function selectWrongGuesses(answer: string, count: number): string[] {
  const guessWords = getGuessWords();
  const wrongWords: string[] = [];
  const used = new Set<string>([answer]);

  // Shuffle and pick unique wrong words
  const shuffled = [...guessWords].sort(() => Math.random() - 0.5);

  for (const word of shuffled) {
    if (!used.has(word)) {
      wrongWords.push(word);
      used.add(word);
      if (wrongWords.length >= count) break;
    }
  }

  return wrongWords;
}

// =============================================================================
// Simulation Logic
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function simulateRound(config: SimulationConfig): Promise<void> {
  console.log('='.repeat(60));
  console.log('🎮 LHAW Round Simulation');
  console.log('='.repeat(60));
  console.log(`\nConfiguration:`);
  console.log(`  Answer: ${config.answer || '(random)'}`);
  console.log(`  Wrong guesses: ${config.numGuesses}`);
  console.log(`  Simulated users: ${config.numUsers}`);
  console.log(`  Delay between guesses: ${config.delayMs}ms`);
  console.log(`  Skip onchain: ${config.skipOnchain}`);
  console.log(`  Dry run: ${config.dryRun}`);

  if (config.dryRun) {
    console.log('\n⚠️  DRY RUN MODE - No changes will be made\n');
    return;
  }

  // Check for existing active round
  const existingRound = await getActiveRound();
  if (existingRound) {
    console.log(`\n⚠️  Active round ${existingRound.id} already exists.`);
    console.log(`   Answer: ${existingRound.answer}`);
    console.log(`   Started: ${existingRound.startedAt.toISOString()}`);
    console.log(`\n   Either resolve it first or use the existing round.`);
    process.exit(1);
  }

  // Generate fake users
  const fakeUsers = generateFakeUsers(config.numUsers);
  await ensureFakeUsersExist(fakeUsers);

  // Create round
  console.log('\n' + '─'.repeat(60));
  console.log('📦 PHASE 1: Creating Round');
  console.log('─'.repeat(60));

  const round = await createRound({
    forceAnswer: config.answer,
    skipOnChainCommitment: config.skipOnchain,
  });

  console.log(`\n   ✅ Round created successfully!`);
  console.log(`   Round ID: ${round.id}`);
  console.log(`   Answer: ${round.answer} (keep secret!)`);
  console.log(`   Commit Hash: ${round.commitHash}`);
  console.log(`   Started At: ${round.startedAt.toISOString()}`);

  // Prepare wrong guesses
  const wrongWords = selectWrongGuesses(round.answer, config.numGuesses);
  console.log(`\n   📋 Selected ${wrongWords.length} wrong words to guess`);

  // Simulate wrong guesses
  console.log('\n' + '─'.repeat(60));
  console.log('🎯 PHASE 2: Simulating Guesses');
  console.log('─'.repeat(60));

  let guessCount = 0;
  const guessResults: { user: FakeUser; word: string; status: string }[] = [];

  for (const word of wrongWords) {
    // Pick a random user for this guess
    const user = fakeUsers[Math.floor(Math.random() * fakeUsers.length)];

    const result = await submitGuess({
      fid: user.fid,
      word,
      isPaidGuess: Math.random() > 0.7, // 30% chance of being paid
    });

    guessCount++;
    guessResults.push({ user, word, status: result.status });

    // Progress indicator
    if (guessCount % 5 === 0 || guessCount === wrongWords.length) {
      const bar = '█'.repeat(Math.floor((guessCount / wrongWords.length) * 20));
      const empty = '░'.repeat(20 - bar.length);
      console.log(`   [${bar}${empty}] ${guessCount}/${wrongWords.length} guesses`);
    }

    if (config.delayMs > 0) {
      await sleep(config.delayMs);
    }
  }

  // Show guess summary by user
  console.log('\n   Guesses by user:');
  const userGuesses = new Map<number, number>();
  for (const r of guessResults) {
    userGuesses.set(r.user.fid, (userGuesses.get(r.user.fid) || 0) + 1);
  }
  for (const [fid, count] of userGuesses.entries()) {
    console.log(`   • FID ${fid}: ${count} guesses`);
  }

  // Winning guess
  console.log('\n' + '─'.repeat(60));
  console.log('🏆 PHASE 3: Winning Guess');
  console.log('─'.repeat(60));

  const winner = fakeUsers[Math.floor(Math.random() * fakeUsers.length)];
  console.log(`\n   🎲 Selected winner: ${winner.username} (FID ${winner.fid})`);
  console.log(`   📝 Submitting correct answer: ${round.answer}`);

  const winResult = await submitGuess({
    fid: winner.fid,
    word: round.answer,
    isPaidGuess: false,
  });

  if (winResult.status === 'correct') {
    console.log(`\n   🎉 WINNER! Round ${round.id} resolved!`);
    console.log(`   Winner FID: ${winResult.winnerFid}`);
  } else {
    console.log(`\n   ❌ Unexpected result: ${winResult.status}`);
    console.log(`   This shouldn't happen - check the logs`);
  }

  // Get final round state
  console.log('\n' + '─'.repeat(60));
  console.log('📊 PHASE 4: Final State');
  console.log('─'.repeat(60));

  const finalRound = await getRoundById(round.id);
  if (finalRound) {
    console.log(`\n   Round ${finalRound.id}:`);
    console.log(`   • Status: ${finalRound.resolvedAt ? 'RESOLVED' : 'ACTIVE'}`);
    console.log(`   • Winner FID: ${finalRound.winnerFid}`);
    console.log(`   • Prize Pool: ${finalRound.prizePoolEth} ETH`);
    console.log(`   • Resolved At: ${finalRound.resolvedAt?.toISOString() || 'N/A'}`);
    console.log(`   • Total Guesses: ${guessCount + 1}`);
  }

  // Cleanup
  await cleanupFakeUsers(fakeUsers, round.id);

  console.log('\n' + '='.repeat(60));
  console.log('✅ Simulation Complete!');
  console.log('='.repeat(60));
  console.log(`\nThe round has been simulated and resolved.`);
  console.log(`You can verify the commitment hash using the archive.`);
  console.log(`\n   Round ID: ${round.id}`);
  console.log(`   Answer: ${round.answer}`);
  console.log(`   Salt: ${round.salt}`);
  console.log(`   Commit: ${round.commitHash}`);
  console.log(`   Verify: H(salt || answer) = commitHash\n`);
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const config = parseArgs();

  try {
    await simulateRound(config);
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Simulation failed:', error);
    process.exit(1);
  }
}

main();

/**
 * Round Simulation API Endpoint
 * Allows running the round simulation script from the admin panel
 * for Sepolia testing without using the command line.
 *
 * POST /api/admin/operational/simulate-round
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from '../me';
import { createRound, getActiveRound, getRoundById } from '../../../../src/lib/rounds';
import { submitGuess } from '../../../../src/lib/guesses';
import { getGuessWords } from '../../../../src/lib/word-lists';
import { db, users, dailyGuessState } from '../../../../src/db';
import { eq } from 'drizzle-orm';

// =============================================================================
// Types
// =============================================================================

interface SimulationConfig {
  answer?: string;
  numGuesses: number;
  numUsers: number;
  skipOnchain: boolean;
  dryRun: boolean;
}

interface SimulationResult {
  success: boolean;
  message: string;
  roundId?: number;
  answer?: string;
  totalGuesses?: number;
  winnerFid?: number;
  commitHash?: string;
  salt?: string;
  dryRun?: boolean;
  logs: string[];
}

interface FakeUser {
  fid: number;
  username: string;
  walletAddress: string;
}

// =============================================================================
// Fake User Management
// =============================================================================

const FAKE_FID_BASE = 9000000;

function generateFakeUsers(count: number): FakeUser[] {
  const fakeUsers: FakeUser[] = [];
  for (let i = 0; i < count; i++) {
    fakeUsers.push({
      fid: FAKE_FID_BASE + i,
      username: `sim_user_${i}`,
      walletAddress: `0x${(i + 1).toString(16).padStart(40, '0')}`,
    });
  }
  return fakeUsers;
}

async function ensureFakeUsersExist(fakeUsers: FakeUser[]): Promise<void> {
  for (const user of fakeUsers) {
    await db
      .insert(users)
      .values({
        fid: user.fid,
        username: user.username,
        signerWalletAddress: user.walletAddress,
      })
      .onConflictDoNothing();
  }
}

async function cleanupFakeUsers(fakeUsers: FakeUser[]): Promise<void> {
  for (const user of fakeUsers) {
    await db.delete(dailyGuessState).where(eq(dailyGuessState.fid, user.fid));
  }
}

// =============================================================================
// Word Selection
// =============================================================================

function selectWrongGuesses(answer: string, count: number): string[] {
  const guessWords = getGuessWords();
  const wrongWords: string[] = [];
  const used = new Set<string>([answer]);

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

async function runSimulation(config: SimulationConfig): Promise<SimulationResult> {
  const logs: string[] = [];
  const log = (msg: string) => logs.push(msg);

  log('Starting round simulation...');
  log(`Config: answer=${config.answer || '(random)'}, guesses=${config.numGuesses}, users=${config.numUsers}, skipOnchain=${config.skipOnchain}`);

  if (config.dryRun) {
    log('DRY RUN MODE - No changes will be made');
    return {
      success: true,
      message: 'Dry run completed - no changes made',
      dryRun: true,
      logs,
    };
  }

  // Check for existing active round
  const existingRound = await getActiveRound();
  if (existingRound) {
    log(`Active round ${existingRound.id} already exists`);
    return {
      success: false,
      message: `Active round ${existingRound.id} already exists. Resolve it first or wait for it to complete.`,
      logs,
    };
  }

  // Generate fake users
  const fakeUsers = generateFakeUsers(config.numUsers);
  await ensureFakeUsersExist(fakeUsers);
  log(`Created ${fakeUsers.length} fake users (FIDs ${FAKE_FID_BASE} - ${FAKE_FID_BASE + fakeUsers.length - 1})`);

  // Create round
  log('Creating new round...');
  const round = await createRound({
    forceAnswer: config.answer,
    skipOnChainCommitment: config.skipOnchain,
  });

  log(`Round created: ID=${round.id}, Answer=${round.answer}`);

  // Prepare wrong guesses
  const wrongWords = selectWrongGuesses(round.answer, config.numGuesses);
  log(`Selected ${wrongWords.length} wrong words to guess`);

  // Simulate wrong guesses
  // When skipOnchain is true, all guesses are free to avoid triggering on-chain payouts
  let guessCount = 0;
  for (const word of wrongWords) {
    const user = fakeUsers[Math.floor(Math.random() * fakeUsers.length)];
    await submitGuess({
      fid: user.fid,
      word,
      isPaidGuess: config.skipOnchain ? false : Math.random() > 0.7,
    });
    guessCount++;

    if (guessCount % 10 === 0) {
      log(`Progress: ${guessCount}/${wrongWords.length} guesses submitted`);
    }
  }

  log(`Submitted ${guessCount} wrong guesses`);

  // Winning guess
  const winner = fakeUsers[Math.floor(Math.random() * fakeUsers.length)];
  log(`Submitting winning guess from ${winner.username} (FID ${winner.fid})`);

  const winResult = await submitGuess({
    fid: winner.fid,
    word: round.answer,
    isPaidGuess: false,
  });

  if (winResult.status === 'correct') {
    log(`Round resolved! Winner: FID ${winResult.winnerFid}`);
  } else {
    log(`Unexpected result: ${winResult.status}`);
  }

  // Get final round state
  const finalRound = await getRoundById(round.id);

  // Cleanup
  await cleanupFakeUsers(fakeUsers);
  log('Cleaned up fake user daily states');

  log('Simulation complete!');

  return {
    success: true,
    message: `Simulation complete. Round ${round.id} resolved with winner FID ${winResult.winnerFid || winner.fid}`,
    roundId: round.id,
    answer: round.answer,
    totalGuesses: guessCount + 1,
    winnerFid: winResult.winnerFid || winner.fid,
    commitHash: round.commitHash,
    salt: round.salt,
    logs,
  };
}

// =============================================================================
// API Handler
// =============================================================================

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { devFid, answer, numGuesses = 20, numUsers = 5, skipOnchain = true, dryRun = false } = req.body;

  // Authorize using centralized admin check
  if (!devFid || !isAdminFid(devFid)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  // Validate answer if provided
  if (answer) {
    const upperAnswer = answer.toUpperCase();
    if (!/^[A-Z]{5}$/.test(upperAnswer)) {
      return res.status(400).json({ error: 'Answer must be exactly 5 letters' });
    }
  }

  // Validate numeric params
  const parsedGuesses = Math.min(Math.max(1, parseInt(numGuesses, 10) || 20), 100);
  const parsedUsers = Math.min(Math.max(1, parseInt(numUsers, 10) || 5), 10);

  try {
    const result = await runSimulation({
      answer: answer?.toUpperCase(),
      numGuesses: parsedGuesses,
      numUsers: parsedUsers,
      skipOnchain: !!skipOnchain,
      dryRun: !!dryRun,
    });

    return res.status(result.success ? 200 : 400).json(result);
  } catch (error: any) {
    console.error('Simulation error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Simulation failed',
      logs: [],
    });
  }
}

/**
 * Round Simulation API Endpoint
 * Allows running the round simulation script from the admin panel
 * for Sepolia testing without using the command line.
 *
 * POST /api/admin/operational/simulate-round
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from '../me';
import { createRound, getRoundById } from '../../../../src/lib/rounds';
import { submitGuess } from '../../../../src/lib/guesses';
import { getGuessWords } from '../../../../src/lib/word-lists';
import { db, users, dailyGuessState } from '../../../../src/db';
import { eq } from 'drizzle-orm';
import {
  purchaseGuessesOnSepolia,
  startRoundWithCommitmentOnSepolia,
  getCurrentJackpotOnSepolia,
  getSepoliaContractBalance,
  getSepoliaRoundInfo,
  resolveSepoliaPreviousRound,
  getSepoliaMinimumSeed,
  seedJackpotOnSepolia,
} from '../../../../src/lib/jackpot-contract';
import { ethers } from 'ethers';
import { setSepoliaSimulationMode, setSkipOnchainResolution } from '../../../../src/lib/economics';
import { isDevModeEnabled, getDevFixedSolution } from '../../../../src/lib/devGameState';

// Base pack price for simulation (0.0003 ETH)
const SIM_PACK_PRICE_ETH = '0.0003';

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
  console.log(`[simulate] Generating ${count} fake users with random wallets`);

  for (let i = 0; i < count; i++) {
    // Use ethers.Wallet.createRandom() to generate guaranteed valid addresses
    // This completely avoids manual hex string construction and checksum issues
    const randomWallet = ethers.Wallet.createRandom();
    const walletAddress = randomWallet.address; // Already properly checksummed

    console.log(`[simulate] User ${i}: wallet="${walletAddress}"`);

    fakeUsers.push({
      fid: FAKE_FID_BASE + i,
      username: `sim_user_${i}`,
      walletAddress,
    });
  }

  console.log(`[simulate] Generated ${fakeUsers.length} fake users with valid addresses`);
  return fakeUsers;
}

async function ensureFakeUsersExist(fakeUsers: FakeUser[]): Promise<void> {
  for (const user of fakeUsers) {
    // Use upsert to ensure wallet address is always set correctly
    // onConflictDoNothing would leave existing users without wallet addresses
    await db
      .insert(users)
      .values({
        fid: user.fid,
        username: user.username,
        signerWalletAddress: user.walletAddress,
      })
      .onConflictDoUpdate({
        target: users.fid,
        set: {
          username: user.username,
          signerWalletAddress: user.walletAddress,
        },
      });
  }
  console.log(`[simulate] Ensured ${fakeUsers.length} fake users have wallet addresses`);
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

  // Enable Sepolia simulation mode for all contract operations
  setSepoliaSimulationMode(true);
  log('Sepolia simulation mode: ENABLED');

  try {
    if (config.dryRun) {
      log('DRY RUN MODE - No changes will be made');
      return {
        success: true,
        message: 'Dry run completed - no changes made',
        dryRun: true,
        logs,
      };
    }

    // Sepolia simulation bypasses active round check - it's independent of production state
    log('Sepolia simulation - bypassing active round check');

    // Dev mode check: if dev mode is enabled, submitGuess uses fixed solution (CRANE)
    // So we need to force the round answer to match, or the winning guess will fail
    let effectiveAnswer = config.answer;
    if (isDevModeEnabled()) {
      const devSolution = getDevFixedSolution();
      log(`Dev mode enabled - forcing answer to "${devSolution}" (submitGuess uses fixed solution)`);
      effectiveAnswer = devSolution;
    }

    // Generate fake users
    const fakeUsers = generateFakeUsers(config.numUsers);
    await ensureFakeUsersExist(fakeUsers);
    log(`Created ${fakeUsers.length} fake users (FIDs ${FAKE_FID_BASE} - ${FAKE_FID_BASE + fakeUsers.length - 1})`);

    // Log Sepolia contract state before starting
    let sepoliaHasActiveRound = false;
    let sepoliaJackpotMismatch = false;
    try {
      const roundInfo = await getSepoliaRoundInfo();
      const sepoliaBalance = await getSepoliaContractBalance();
      const jackpotEth = ethers.formatEther(roundInfo.jackpot);

      log(`Sepolia contract state BEFORE:`);
      log(`  - Round #${roundInfo.roundNumber}, Active: ${roundInfo.isActive}`);
      log(`  - Internal jackpot: ${jackpotEth} ETH`);
      log(`  - Actual balance: ${sepoliaBalance} ETH`);

      sepoliaHasActiveRound = roundInfo.isActive;

      const balanceNum = parseFloat(sepoliaBalance);
      const jackpotNum = parseFloat(jackpotEth);
      if (roundInfo.isActive && balanceNum < jackpotNum * 0.9) {
        sepoliaJackpotMismatch = true;
        log(`⚠️  WARNING: Jackpot/balance mismatch detected!`);
        log(`   The contract's internal jackpot (${jackpotEth} ETH) is higher than its balance (${sepoliaBalance} ETH).`);
        log(`   This can happen when previous simulations failed to resolve.`);
        log(`   Resolution will fail because the contract validates against its internal jackpot.`);
        log(`   ⚠️  ALL onchain operations will be skipped.`);
        log(`   The Sepolia contract needs manual intervention (resolve existing round or redeploy).`);
      }
    } catch (err: any) {
      log(`Warning: Could not query Sepolia state: ${err.message}`);
    }

    // If we have a jackpot mismatch, skip ALL onchain operations (not just resolution)
    // The contract is in a broken state and nothing will work until it's fixed
    const skipAllOnchain = sepoliaJackpotMismatch || config.skipOnchain;

    // Create DB round (bypass active round check for Sepolia simulation)
    // IMPORTANT: We skip onchain commitment here because we'll start a Sepolia round explicitly
    log('Creating DB round...');
    const round = await createRound({
      forceAnswer: effectiveAnswer,
      skipOnChainCommitment: true, // Always skip - we start on Sepolia explicitly
      skipActiveRoundCheck: true,
    });
    log(`DB Round created: ID=${round.id}, Answer=${round.answer}`);

    // Start a fresh round on Sepolia contract
    // This is critical: we need a clean round state for the simulation to resolve properly
    let sepoliaRoundStarted = false;
    if (!skipAllOnchain) {
      // If there's an active round, resolve it first to clear the state
      if (sepoliaHasActiveRound) {
        log(`Sepolia has an active round - resolving it first...`);
        try {
          const resolveTxHash = await resolveSepoliaPreviousRound();
          log(`✅ Previous round resolved: ${resolveTxHash}`);
          log(`   Jackpot returned to operator wallet.`);

          // After resolving, the contract may automatically start a new round
          // Check if a new round is already active
          const postResolveInfo = await getSepoliaRoundInfo();
          if (postResolveInfo.isActive) {
            log(`Contract automatically started new round #${postResolveInfo.roundNumber}`);
            const autoJackpot = ethers.formatEther(postResolveInfo.jackpot);
            log(`Auto-started round jackpot: ${autoJackpot} ETH`);

            // Check if auto-started round needs seeding
            const minimumSeed = await getSepoliaMinimumSeed();
            const minimumSeedEth = ethers.formatEther(minimumSeed);
            if (postResolveInfo.jackpot < minimumSeed) {
              log(`⚠️  Auto-started round jackpot (${autoJackpot} ETH) is below minimum (${minimumSeedEth} ETH)`);
              log(`   Seeding jackpot to enable purchases...`);
              try {
                const seedTxHash = await seedJackpotOnSepolia(minimumSeedEth);
                log(`✅ Jackpot seeded: ${seedTxHash}`);

                // Verify new jackpot
                const newJackpot = await getCurrentJackpotOnSepolia();
                log(`   New jackpot: ${newJackpot} ETH`);
              } catch (seedErr: any) {
                log(`❌ Failed to seed jackpot: ${seedErr.message}`);
                log(`   → Purchases may fail.`);
              }
            }

            sepoliaRoundStarted = true;
            sepoliaHasActiveRound = true; // Update flag
          }
        } catch (err: any) {
          log(`❌ Failed to resolve previous round: ${err.message}`);
          log(`   → Continuing with DB-only simulation.`);
          // Mark as mismatch so we skip all onchain ops
          sepoliaJackpotMismatch = true;
        }
      }

      // Now start a fresh round (only if we didn't fail to resolve AND no round is already active)
      // Note: Sepolia contract only has startRoundWithCommitment(), not startNextRound()
      if (!sepoliaJackpotMismatch && !sepoliaRoundStarted) {
        try {
          const minimumSeed = await getSepoliaMinimumSeed();
          const currentJackpot = await getCurrentJackpotOnSepolia();
          const contractBalance = await getSepoliaContractBalance();
          const contractBalanceWei = ethers.parseEther(contractBalance);

          log(`Minimum seed required: ${ethers.formatEther(minimumSeed)} ETH`);
          log(`Current jackpot: ${currentJackpot} ETH`);
          log(`Contract balance: ${contractBalance} ETH`);

          // Seed the jackpot if needed
          if (contractBalanceWei < minimumSeed) {
            const seedAmount = ethers.formatEther(minimumSeed);
            log(`Seeding jackpot with ${seedAmount} ETH...`);
            const seedTxHash = await seedJackpotOnSepolia(seedAmount);
            log(`✅ Jackpot seeded: ${seedTxHash}`);
          }

          // Start round with commitment (the only way on Sepolia contract)
          log('Starting round with commitment...');
          const txHash = await startRoundWithCommitmentOnSepolia(round.commitHash);
          log(`✅ Sepolia round started: ${txHash}`);
          sepoliaRoundStarted = true;

          // Re-check state after starting round
          const newRoundInfo = await getSepoliaRoundInfo();
          const newJackpot = ethers.formatEther(newRoundInfo.jackpot);
          log(`New round state: Round #${newRoundInfo.roundNumber}, Active: ${newRoundInfo.isActive}, Jackpot: ${newJackpot} ETH`);
        } catch (err: any) {
          log(`❌ Failed to start Sepolia round: ${err.message}`);
          log(`   → Continuing with DB-only simulation (all onchain operations will be skipped).`);
        }
      }
    } else {
      log('Skipping Sepolia round start (skipAllOnchain=true)');
    }

    // Determine if we should skip onchain operations
    // Skip if: mismatch detected, explicitly requested, OR round start failed
    let skipOnchainOps = skipAllOnchain || !sepoliaRoundStarted;

    // If we started/seeded a round, wait a moment for the blockchain state to settle
    if (sepoliaRoundStarted && !skipAllOnchain) {
      log('Waiting 2 seconds for blockchain state to settle...');
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Verify round is still active after delay
      try {
        const verifyInfo = await getSepoliaRoundInfo();
        if (!verifyInfo.isActive) {
          log(`⚠️  Round became inactive after delay. Attempting to restart...`);
          try {
            // Seed if needed
            const minimumSeed = await getSepoliaMinimumSeed();
            const currentJackpot = await getCurrentJackpotOnSepolia();
            const currentJackpotWei = ethers.parseEther(currentJackpot);

            if (currentJackpotWei < minimumSeed) {
              const minimumSeedEth = ethers.formatEther(minimumSeed);
              const seedTxHash = await seedJackpotOnSepolia(minimumSeedEth);
              log(`✅ Re-seeded jackpot: ${seedTxHash}`);
            }

            // Start new round with commitment
            log(`Starting new round with commitment...`);
            const startTxHash = await startRoundWithCommitmentOnSepolia(round.commitHash);
            log(`✅ Round restarted: ${startTxHash}`);

            await new Promise((resolve) => setTimeout(resolve, 1000));

            // Verify it's now active
            const newInfo = await getSepoliaRoundInfo();
            log(`New round state: Round #${newInfo.roundNumber}, Active: ${newInfo.isActive}, Jackpot: ${ethers.formatEther(newInfo.jackpot)} ETH`);
          } catch (restartErr: any) {
            log(`❌ Failed to restart round: ${restartErr.message}`);
            log(`   → Falling back to DB-only simulation`);
            skipOnchainOps = true;
          }
        } else {
          log(`✅ Round #${verifyInfo.roundNumber} is active with ${ethers.formatEther(verifyInfo.jackpot)} ETH`);
        }
      } catch (verifyErr: any) {
        log(`Warning: Could not verify round state: ${verifyErr.message}`);
      }
    }

    // Prepare wrong guesses
    const wrongWords = selectWrongGuesses(round.answer, config.numGuesses);
    log(`Selected ${wrongWords.length} wrong words to guess`);

    // Simulate wrong guesses with onchain pack purchases
    let guessCount = 0;
    let paidGuessCount = 0;
    let consecutiveFailures = 0;
    const MAX_CONSECUTIVE_FAILURES = 3;

    if (skipOnchainOps) {
      log(`⚠️  Skipping onchain purchases (DB-only simulation)`);
    }

    for (const word of wrongWords) {
      const user = fakeUsers[Math.floor(Math.random() * fakeUsers.length)];
      const isPaidGuess = !skipOnchainOps && Math.random() > 0.7; // ~30% paid guesses (skip if onchain disabled)

      // For paid guesses, execute onchain purchase on Sepolia first
      // CRITICAL: Only mark as paid in DB if onchain purchase succeeds
      // This prevents DB/contract balance mismatch
      let actuallyPaid = false;
      if (isPaidGuess) {
        try {
          // Debug: log the exact address being used
          log(`Attempting purchase for ${user.username} with address: ${user.walletAddress}`);

          // Validate address one more time before the call
          if (!ethers.isAddress(user.walletAddress)) {
            throw new Error(`Invalid address before purchase: ${user.walletAddress}`);
          }

          await purchaseGuessesOnSepolia(user.walletAddress, 1, SIM_PACK_PRICE_ETH);
          actuallyPaid = true;
          paidGuessCount++;
          consecutiveFailures = 0; // Reset on success
          log(`Sepolia purchase: ${user.username} bought 1 pack (${SIM_PACK_PRICE_ETH} ETH)`);
        } catch (err: any) {
          consecutiveFailures++;
          const errMsg = err.message || 'Unknown error';
          log(`Warning: Sepolia purchase failed for ${user.username} (addr: ${user.walletAddress}): ${errMsg}`);

          // If we're getting consecutive failures, the round might be inactive
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            log(`⚠️  ${MAX_CONSECUTIVE_FAILURES} consecutive purchase failures - checking round state...`);
            try {
              const roundCheck = await getSepoliaRoundInfo();
              if (!roundCheck.isActive) {
                log(`   Round is inactive. Switching to DB-only mode for remaining guesses.`);
                skipOnchainOps = true;
              } else {
                log(`   Round #${roundCheck.roundNumber} is active. Errors may be transient.`);
              }
            } catch (checkErr: any) {
              log(`   Could not check round state: ${checkErr.message}`);
            }
          }

          log(`  → Submitting as free guess to maintain DB/contract sync`);
        }
      }

      await submitGuess({
        fid: user.fid,
        word,
        isPaidGuess: actuallyPaid, // Only paid if onchain succeeded
      });
      guessCount++;

      if (guessCount % 10 === 0) {
        log(`Progress: ${guessCount}/${wrongWords.length} guesses submitted (${paidGuessCount} paid)`);
      }
    }

    log(`Submitted ${guessCount} wrong guesses (${paidGuessCount} onchain purchases)`);

    // If we're skipping onchain operations, set the flag so resolution also skips onchain
    if (skipOnchainOps) {
      log(`⚠️  Setting skipOnchainResolution flag (DB-only simulation)`);
      setSkipOnchainResolution(true);
    } else {
      // Log Sepolia contract state before resolution
      try {
        const sepoliaJackpot = await getCurrentJackpotOnSepolia();
        const sepoliaBalance = await getSepoliaContractBalance();
        log(`Sepolia contract state BEFORE RESOLUTION:`);
        log(`  - Internal jackpot: ${sepoliaJackpot} ETH`);
        log(`  - Actual balance: ${sepoliaBalance} ETH`);
      } catch (err: any) {
        log(`Warning: Could not query Sepolia state: ${err.message}`);
      }
    }

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
  } finally {
    // Always reset flags when simulation ends
    setSepoliaSimulationMode(false);
    setSkipOnchainResolution(false);
    log('Sepolia simulation mode: DISABLED');
    log('Skip onchain resolution: RESET');
  }
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

  // Note: skipOnchain defaults to FALSE - simulation should run full onchain flow on Sepolia
  const { devFid, answer, numGuesses = 20, numUsers = 5, skipOnchain = false, dryRun = false } = req.body;

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

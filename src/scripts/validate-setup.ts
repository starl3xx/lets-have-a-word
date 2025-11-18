import { validateWordLists } from '../lib/word-lists';
import { getCurrentRules } from '../lib/game-rules';
import {
  createRound,
  getActiveRound,
  ensureActiveRound,
  resolveRound,
  verifyRoundCommitment,
} from '../lib/rounds';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Validation script to verify Milestone 1.2 setup (Round Lifecycle)
 */
async function validate() {
  console.log('🔍 Validating Milestone 1.2 setup (Round Lifecycle)...\n');

  try {
    // Step 1: Validate word lists
    console.log('Step 1: Validating word lists...');
    validateWordLists();
    console.log('');

    // Step 2: Verify game rules exist
    console.log('Step 2: Verifying game rules (with pack-based purchases)...');
    const rules = await getCurrentRules();
    console.log(`✅ Game rules loaded successfully (ID: ${rules.id}, Name: ${rules.name})`);
    console.log(`   Config:`, JSON.stringify(rules.config, null, 2));
    console.log('');

    // Step 3: Test round creation
    console.log('Step 3: Testing round creation with commit-reveal...');
    const testAnswer = 'crane'; // Example test word
    const testRound = await createRound({ forceAnswer: testAnswer });
    console.log(`✅ Test round created successfully`);
    console.log(`   Round ID: ${testRound.id}`);
    console.log(`   Answer: ${testRound.answer}`);
    console.log(`   Salt: ${testRound.salt}`);
    console.log(`   Commit Hash: ${testRound.commitHash}`);
    console.log('');

    // Step 4: Verify commitment
    console.log('Step 4: Verifying commit-reveal integrity...');
    const isValid = verifyRoundCommitment(testRound);
    if (!isValid) {
      throw new Error('Commit-reveal verification failed!');
    }
    console.log(`✅ Commit-reveal verification passed`);
    console.log(`   H(salt||answer) === commit_hash: ${isValid}`);
    console.log('');

    // Step 5: Test getActiveRound()
    console.log('Step 5: Testing getActiveRound()...');
    const activeRound = await getActiveRound();
    if (!activeRound) {
      throw new Error('No active round found');
    }
    console.log(`✅ Active round retrieved: ${activeRound.id}`);
    console.log('');

    // Step 6: Test round resolution
    console.log('Step 6: Testing round resolution...');
    const winnerFid = 12345;
    const referrerFid = 67890;
    const resolvedRound = await resolveRound(testRound.id, winnerFid, referrerFid);
    console.log(`✅ Round ${resolvedRound.id} resolved successfully`);
    console.log(`   Winner FID: ${resolvedRound.winnerFid}`);
    console.log(`   Referrer FID: ${resolvedRound.referrerFid}`);
    console.log(`   Resolved At: ${resolvedRound.resolvedAt}`);
    console.log('');

    // Step 7: Test ensureActiveRound()
    console.log('Step 7: Testing ensureActiveRound()...');
    const ensuredRound = await ensureActiveRound({ forceAnswer: 'brain' });
    console.log(`✅ Ensured active round: ${ensuredRound.id}`);
    console.log('');

    // Clean up: resolve the ensured round
    await resolveRound(ensuredRound.id, 99999);

    console.log('🎉 All validation checks passed!\n');
    console.log('Milestone 1.2 setup is complete and working correctly.');
    console.log('');
    console.log('Summary:');
    console.log(`  - Pack-based purchases: ${rules.config.paidGuessPackSize} guesses × ${rules.config.maxPaidPacksPerDay} packs`);
    console.log(`  - Game rules schema: ✅`);
    console.log(`  - Word lists: ✅`);
    console.log(`  - Commit-reveal model: ✅`);
    console.log(`  - Round creation: ✅`);
    console.log(`  - Round lifecycle (create → active → resolve): ✅`);

  } catch (error) {
    console.error('❌ Validation failed:', error);
    process.exit(1);
  }

  process.exit(0);
}

validate();

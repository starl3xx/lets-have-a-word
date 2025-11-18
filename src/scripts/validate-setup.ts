import { validateWordLists } from '../lib/word-lists';
import { getCurrentRules } from '../lib/game-rules';
import { createRound, getCurrentRound, verifyRoundCommitment } from '../lib/rounds';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Validation script to verify Milestone 1.1 setup
 */
async function validate() {
  console.log('🔍 Validating Milestone 1.1 setup...\n');

  try {
    // Step 1: Validate word lists
    console.log('Step 1: Validating word lists...');
    validateWordLists();
    console.log('');

    // Step 2: Verify game rules exist
    console.log('Step 2: Verifying game rules...');
    const rules = await getCurrentRules();
    console.log(`✅ Game rules loaded successfully (ID: ${rules.id}, Name: ${rules.name})`);
    console.log(`   Config:`, JSON.stringify(rules.config, null, 2));
    console.log('');

    // Step 3: Test round creation
    console.log('Step 3: Testing round creation with commit-reveal...');
    const testAnswer = 'crane'; // Example test word
    const testRound = await createRound(1, testAnswer);
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

    console.log('🎉 All validation checks passed!\n');
    console.log('Milestone 1.1 setup is complete and working correctly.');
    console.log('');
    console.log('Summary:');
    console.log(`  - Answer words: ${rules.config.freeGuessesPerDayBase} (example from config)`);
    console.log(`  - Game rules schema: ✅`);
    console.log(`  - Word lists: ✅`);
    console.log(`  - Commit-reveal model: ✅`);
    console.log(`  - Round creation: ✅`);

  } catch (error) {
    console.error('❌ Validation failed:', error);
    process.exit(1);
  }

  process.exit(0);
}

validate();

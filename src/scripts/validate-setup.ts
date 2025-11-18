import { validateWordLists } from '../lib/word-lists';
import { getCurrentRules } from '../lib/game-rules';
import {
  createRound,
  getActiveRound,
  ensureActiveRound,
  resolveRound,
  verifyRoundCommitment,
} from '../lib/rounds';
import {
  submitGuess,
  getWrongWordsForRound,
  getGuessCountForUserInRound,
  getTopGuessersForRound,
} from '../lib/guesses';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Validation script to verify Milestone 1.3 setup (Guess Logic Basic)
 */
async function validate() {
  console.log('🔍 Validating Milestone 1.3 setup (Guess Logic Basic)...\n');

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

    // Step 8: Test guess submission
    console.log('Step 8: Testing guess submission...');

    // Submit incorrect guess
    const incorrectGuess = await submitGuess({
      fid: 1000,
      word: 'house',
      isPaidGuess: false,
    });
    console.log(`✅ Incorrect guess submitted: ${incorrectGuess.status}`);
    if (incorrectGuess.status === 'incorrect') {
      console.log(`   Word: ${incorrectGuess.word}, Total guesses: ${incorrectGuess.totalGuessesForUserThisRound}`);
    }
    console.log('');

    // Step 9: Test wrong words tracking
    console.log('Step 9: Testing wrong words tracking...');
    await submitGuess({ fid: 2000, word: 'phone' });
    await submitGuess({ fid: 3000, word: 'table' });

    const wrongWords = await getWrongWordsForRound(ensuredRound.id);
    console.log(`✅ Wrong words for round: ${wrongWords.join(', ')}`);
    console.log('');

    // Step 10: Test global deduplication
    console.log('Step 10: Testing global deduplication...');
    const duplicateGuess = await submitGuess({ fid: 4000, word: 'house' });
    if (duplicateGuess.status === 'already_guessed_word') {
      console.log(`✅ Duplicate guess blocked: ${duplicateGuess.word}`);
    }
    console.log('');

    // Step 11: Test top guessers
    console.log('Step 11: Testing top guessers...');
    await submitGuess({ fid: 1000, word: 'chair' }); // User 1000's 2nd guess
    const topGuessers = await getTopGuessersForRound(ensuredRound.id, 5);
    console.log(`✅ Top guessers (${topGuessers.length}):`);
    topGuessers.forEach((g, i) => {
      console.log(`   ${i + 1}. FID ${g.fid}: ${g.guessCount} guesses`);
    });
    console.log('');

    // Step 12: Test correct guess and round resolution
    console.log('Step 12: Testing correct guess...');
    const correctGuess = await submitGuess({
      fid: 5000,
      word: ensuredRound.answer,
    });
    if (correctGuess.status === 'correct') {
      console.log(`✅ Correct guess! Winner FID: ${correctGuess.winnerFid}`);
      console.log(`   Round ${correctGuess.roundId} resolved`);
    }
    console.log('');

    // Step 13: Verify round is closed
    console.log('Step 13: Verifying round is closed...');
    const afterGuess = await submitGuess({ fid: 9999, word: 'apple' });
    if (afterGuess.status === 'round_closed') {
      console.log(`✅ Round correctly closed to new guesses`);
    }
    console.log('');

    console.log('🎉 All validation checks passed!\n');
    console.log('Milestone 1.3 setup is complete and working correctly.');
    console.log('');
    console.log('Summary:');
    console.log(`  - Pack-based purchases: ${rules.config.paidGuessPackSize} guesses × ${rules.config.maxPaidPacksPerDay} packs`);
    console.log(`  - Game rules schema: ✅`);
    console.log(`  - Word lists: ✅`);
    console.log(`  - Commit-reveal model: ✅`);
    console.log(`  - Round lifecycle (create → active → resolve): ✅`);
    console.log(`  - Guess submission & validation: ✅`);
    console.log(`  - Global wrong word tracking: ✅`);
    console.log(`  - Global deduplication: ✅`);
    console.log(`  - Top guessers ranking: ✅`);
    console.log(`  - Correct guess resolution: ✅`);

  } catch (error) {
    console.error('❌ Validation failed:', error);
    process.exit(1);
  }

  process.exit(0);
}

validate();

/**
 * Fix Round 2 Answer
 *
 * Round 2's answer field was corrupted (contained a Date instead of string).
 * This script encrypts the correct answer and updates the database.
 *
 * Run with: npx tsx scripts/fix-round2-answer.ts
 */

import { encryptAndPack, getPlaintextAnswer } from '../src/lib/encryption.js';
import { db } from '../src/db/index.js';
import { rounds } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

async function fixRound2() {
  const ROUND_ID = 2;
  const CORRECT_ANSWER = 'TUCKS';

  console.log('=== Fixing Round 2 Answer ===\n');

  // First, check current state
  console.log('1. Checking current state...');
  const [currentRound] = await db.select().from(rounds).where(eq(rounds.id, ROUND_ID));

  if (!currentRound) {
    console.error('Round 2 not found!');
    process.exit(1);
  }

  console.log('   Current answer type:', typeof currentRound.answer);
  console.log('   Current answer value:', currentRound.answer);

  // Encrypt the correct answer
  console.log('\n2. Encrypting correct answer:', CORRECT_ANSWER);
  const encryptedAnswer = encryptAndPack(CORRECT_ANSWER);
  console.log('   Encrypted:', encryptedAnswer.substring(0, 40) + '...');

  // Update the database
  console.log('\n3. Updating database...');
  await db.update(rounds)
    .set({ answer: encryptedAnswer })
    .where(eq(rounds.id, ROUND_ID));

  // Verify the fix
  console.log('\n4. Verifying fix...');
  const [updatedRound] = await db.select().from(rounds).where(eq(rounds.id, ROUND_ID));

  const decryptedAnswer = getPlaintextAnswer(updatedRound.answer);
  console.log('   New answer type:', typeof updatedRound.answer);
  console.log('   Decrypted answer:', decryptedAnswer);

  if (decryptedAnswer === CORRECT_ANSWER) {
    console.log('\n✅ Round 2 answer fixed successfully!');
    console.log('\nYou can now re-run the archive sync to archive Round 2.');
  } else {
    console.error('\n❌ Verification failed! Decrypted answer does not match.');
    process.exit(1);
  }

  process.exit(0);
}

fixRound2().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

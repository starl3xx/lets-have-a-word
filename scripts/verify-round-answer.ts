/**
 * Verify Round Answer Script
 *
 * Verifies that a round's stored answer + salt produces the correct commit hash.
 * Use this before emergency resolution to confirm the answer is correct.
 *
 * Usage: npx ts-node scripts/verify-round-answer.ts [roundId]
 */

import { config } from 'dotenv';
config();

import { createHash } from 'crypto';
import { db } from '../src/db';
import { rounds } from '../src/db/schema';
import { eq, desc } from 'drizzle-orm';
import { getPlaintextAnswer } from '../src/lib/encryption';

function computeCommitHash(salt: string, answer: string): string {
  const hash = createHash('sha256');
  hash.update(salt + answer);
  return hash.digest('hex');
}

async function main() {
  const roundIdArg = process.argv[2];
  let roundId: number;

  if (roundIdArg) {
    roundId = parseInt(roundIdArg, 10);
    if (isNaN(roundId)) {
      console.error('Invalid round ID');
      process.exit(1);
    }
  } else {
    // Get latest active round
    const [activeRound] = await db
      .select()
      .from(rounds)
      .where(eq(rounds.status, 'active'))
      .orderBy(desc(rounds.id))
      .limit(1);

    if (!activeRound) {
      console.error('No active round found');
      process.exit(1);
    }
    roundId = activeRound.id;
  }

  console.log('═'.repeat(60));
  console.log(`🔍 VERIFYING ROUND ${roundId}`);
  console.log('═'.repeat(60));

  const [round] = await db
    .select()
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .limit(1);

  if (!round) {
    console.error(`Round ${roundId} not found`);
    process.exit(1);
  }

  // Get the decrypted answer
  const decryptedAnswer = getPlaintextAnswer(round.answer);
  const salt = round.salt;
  const storedCommitHash = round.commitHash;

  // Compute the hash
  const computedHash = computeCommitHash(salt, decryptedAnswer);

  console.log('\n📋 ROUND DATA:');
  console.log(`  Round ID:          ${round.id}`);
  console.log(`  Status:            ${round.status}`);
  console.log(`  Prize Pool:        ${round.prizePoolEth} ETH`);
  console.log(`  Started At:        ${round.startedAt}`);
  console.log(`  Resolved At:       ${round.resolvedAt || 'Not yet resolved'}`);

  console.log('\n🔐 COMMIT-REVEAL DATA:');
  console.log(`  Decrypted Answer:  ${decryptedAnswer.toUpperCase()}`);
  console.log(`  Salt:              ${salt.slice(0, 16)}...${salt.slice(-8)}`);
  console.log(`  Full Salt:         ${salt}`);

  console.log('\n✅ VERIFICATION:');
  console.log(`  Stored Commit:     ${storedCommitHash}`);
  console.log(`  Computed Commit:   ${computedHash}`);
  console.log(`  Match:             ${storedCommitHash === computedHash ? '✅ YES - VALID' : '❌ NO - MISMATCH!'}`);

  console.log('\n📝 HASH WITHOUT SALT (for comparison):');
  const hashWithoutSalt = createHash('sha256').update(decryptedAnswer).digest('hex');
  console.log(`  SHA256(answer):    ${hashWithoutSalt}`);
  console.log(`  Note: This won't match the commit because salt is required!`);

  console.log('\n' + '═'.repeat(60));
  if (storedCommitHash === computedHash) {
    console.log('✅ VERIFICATION PASSED - Answer is cryptographically proven');
  } else {
    console.log('❌ VERIFICATION FAILED - Something is wrong!');
  }
  console.log('═'.repeat(60) + '\n');

  process.exit(storedCommitHash === computedHash ? 0 : 1);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

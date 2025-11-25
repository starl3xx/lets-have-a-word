/**
 * Create Round Script
 * Creates a new database round with a random solution
 *
 * Usage: npx tsx src/scripts/create-round.ts
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { createRound, getActiveRound } from '../lib/rounds';

async function main() {
  console.log('='.repeat(50));
  console.log('Create Database Round');
  console.log('='.repeat(50));

  // Check for existing active round
  const existingRound = await getActiveRound();

  if (existingRound) {
    console.log('\n⚠️  An active round already exists:\n');
    console.log(`  Round ID: ${existingRound.id}`);
    console.log(`  Started At: ${existingRound.startedAt.toISOString()}`);
    console.log(`  Commit Hash: ${existingRound.commitHash}`);
    console.log(`  Prize Pool: ${existingRound.prizePoolEth} ETH`);
    console.log('\n  (Solution hidden for security)');
    console.log('\n' + '='.repeat(50));
    process.exit(0);
  }

  // Create new round
  console.log('\nCreating new round with random solution...\n');

  const round = await createRound();

  console.log('✅ Round created successfully!\n');
  console.log(`  Round ID: ${round.id}`);
  console.log(`  Started At: ${round.startedAt.toISOString()}`);
  console.log(`  Commit Hash: ${round.commitHash}`);
  console.log(`  Prize Pool: ${round.prizePoolEth} ETH`);
  console.log('\n  Solution has been randomly selected and committed.');
  console.log('  The commit hash can be used to verify fairness after the round ends.');
  console.log('\n' + '='.repeat(50));

  process.exit(0);
}

main().catch((error) => {
  console.error('Error creating round:', error);
  process.exit(1);
});

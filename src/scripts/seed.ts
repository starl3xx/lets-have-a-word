import { db, gameRules } from '../db';
import { DEFAULT_RULES_CONFIG } from '../lib/game-rules';
import { validateWordLists } from '../lib/word-lists';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Seed script to initialize the database with default game rules
 */
async function seed() {
  console.log('🌱 Seeding database...\n');

  try {
    // Step 1: Validate word lists
    console.log('Step 1: Validating word lists...');
    validateWordLists();
    console.log('');

    // Step 2: Insert default game rules
    console.log('Step 2: Inserting default game rules (v1)...');

    const result = await db
      .insert(gameRules)
      .values({
        name: 'v1',
        config: DEFAULT_RULES_CONFIG,
      })
      .onConflictDoUpdate({
        target: gameRules.name,
        set: {
          config: DEFAULT_RULES_CONFIG,
          updatedAt: new Date(),
        },
      })
      .returning();

    console.log(`✅ Game rules seeded successfully (ID: ${result[0].id})`);
    console.log(`   Name: ${result[0].name}`);
    console.log(`   Config:`, JSON.stringify(result[0].config, null, 2));
    console.log('');

    console.log('🎉 Database seeded successfully!\n');
    console.log('Next steps:');
    console.log('  1. Run: npm run validate (to verify setup)');
    console.log('  2. Create your first round (see examples in docs)');

  } catch (error) {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  }

  process.exit(0);
}

seed();

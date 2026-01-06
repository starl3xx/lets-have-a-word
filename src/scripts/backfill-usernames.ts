/**
 * Backfill Usernames Script
 *
 * Fetches usernames from Neynar for all users with null/empty usernames
 * in the database and updates them.
 *
 * Usage: npx tsx src/scripts/backfill-usernames.ts
 */

import { db, users } from '../db';
import { isNull, or, eq } from 'drizzle-orm';
import { neynarClient } from '../lib/farcaster';

const BATCH_SIZE = 100; // Neynar batch limit

async function backfillUsernames() {
  console.log('🔄 Starting username backfill...\n');

  // Find all users with null or empty usernames
  const usersWithoutUsernames = await db
    .select({ id: users.id, fid: users.fid, username: users.username })
    .from(users)
    .where(
      or(
        isNull(users.username),
        eq(users.username, ''),
        eq(users.username, 'unknown')
      )
    );

  console.log(`📊 Found ${usersWithoutUsernames.length} users without usernames\n`);

  if (usersWithoutUsernames.length === 0) {
    console.log('✅ All users have usernames. Nothing to do.');
    return;
  }

  let updated = 0;
  let failed = 0;

  // Process in batches
  for (let i = 0; i < usersWithoutUsernames.length; i += BATCH_SIZE) {
    const batch = usersWithoutUsernames.slice(i, i + BATCH_SIZE);
    const fids = batch.map((u) => u.fid);

    console.log(`📦 Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(usersWithoutUsernames.length / BATCH_SIZE)} (${fids.length} users)`);

    try {
      // Fetch user data from Neynar
      const userData = await neynarClient.fetchBulkUsers({ fids });

      if (userData.users && userData.users.length > 0) {
        // Create a map of FID -> username
        const usernameMap = new Map<number, string>();
        for (const user of userData.users) {
          if (user.username) {
            usernameMap.set(user.fid, user.username);
          }
        }

        // Update each user in the batch
        for (const user of batch) {
          const username = usernameMap.get(user.fid);
          if (username) {
            await db
              .update(users)
              .set({ username, updatedAt: new Date() })
              .where(eq(users.id, user.id));
            updated++;
            console.log(`  ✅ FID ${user.fid}: "${username}"`);
          } else {
            failed++;
            console.log(`  ⚠️ FID ${user.fid}: No username in Neynar response`);
          }
        }
      } else {
        failed += batch.length;
        console.log(`  ⚠️ Neynar returned no users for this batch`);
      }
    } catch (error) {
      failed += batch.length;
      console.error(`  ❌ Error fetching batch:`, error);
    }

    // Small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  console.log(`\n📊 Backfill complete!`);
  console.log(`   ✅ Updated: ${updated}`);
  console.log(`   ⚠️ Failed: ${failed}`);
}

// Run if executed directly
backfillUsernames()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

/**
 * POST /api/admin/operational/backfill-usernames
 *
 * Temporary endpoint to backfill usernames from Neynar for users
 * with null/empty usernames in the database.
 *
 * Requires admin authentication via ADMIN_SECRET header.
 *
 * Query params:
 * - limit: Max users to process (default 100, max 500)
 * - dryRun: If 'true', only show what would be updated without making changes
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db, users } from '../../../../src/db';
import { isNull, or, eq } from 'drizzle-orm';
import { neynarClient } from '../../../../src/lib/farcaster';

const BATCH_SIZE = 100; // Neynar batch limit
const MAX_LIMIT = 500;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Admin authentication
  const adminSecret = process.env.ADMIN_SECRET;
  const providedSecret = req.headers['x-admin-secret'] || req.headers['authorization']?.replace('Bearer ', '');

  if (!adminSecret || providedSecret !== adminSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const limit = Math.min(
      parseInt(req.query.limit as string) || 100,
      MAX_LIMIT
    );
    const dryRun = req.query.dryRun === 'true';

    console.log(`🔄 Starting username backfill (limit=${limit}, dryRun=${dryRun})...`);

    // Find users with null or empty usernames
    const usersWithoutUsernames = await db
      .select({ id: users.id, fid: users.fid, username: users.username })
      .from(users)
      .where(
        or(
          isNull(users.username),
          eq(users.username, ''),
          eq(users.username, 'unknown')
        )
      )
      .limit(limit);

    console.log(`📊 Found ${usersWithoutUsernames.length} users without usernames`);

    if (usersWithoutUsernames.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'All users have usernames. Nothing to do.',
        stats: { found: 0, updated: 0, failed: 0 },
      });
    }

    let updated = 0;
    let failed = 0;
    const results: Array<{ fid: number; username: string | null; status: string }> = [];

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
              if (!dryRun) {
                await db
                  .update(users)
                  .set({ username, updatedAt: new Date() })
                  .where(eq(users.id, user.id));
              }
              updated++;
              results.push({ fid: user.fid, username, status: dryRun ? 'would_update' : 'updated' });
              console.log(`  ✅ FID ${user.fid}: "${username}"${dryRun ? ' (dry run)' : ''}`);
            } else {
              failed++;
              results.push({ fid: user.fid, username: null, status: 'not_found_in_neynar' });
              console.log(`  ⚠️ FID ${user.fid}: No username in Neynar response`);
            }
          }
        } else {
          for (const user of batch) {
            failed++;
            results.push({ fid: user.fid, username: null, status: 'neynar_empty_response' });
          }
          console.log(`  ⚠️ Neynar returned no users for this batch`);
        }
      } catch (error) {
        for (const user of batch) {
          failed++;
          results.push({ fid: user.fid, username: null, status: 'error' });
        }
        console.error(`  ❌ Error fetching batch:`, error);
      }

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    console.log(`\n📊 Backfill complete! Updated: ${updated}, Failed: ${failed}`);

    return res.status(200).json({
      success: true,
      dryRun,
      stats: {
        found: usersWithoutUsernames.length,
        updated,
        failed,
      },
      results,
    });
  } catch (error) {
    console.error('Backfill error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

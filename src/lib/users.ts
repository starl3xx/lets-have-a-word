import { db, users } from '../db';
import { eq } from 'drizzle-orm';
import type { UserRow } from '../db/schema';
import { logReferralEvent, AnalyticsEventTypes } from './analytics';

/**
 * Parameters for upserting a user from Farcaster context
 */
export interface UpsertUserParams {
  fid: number;
  username?: string | null;
  signerWallet: string | null;
  spamScore: number | null;
  referrerFid?: number | null;
}

/**
 * Upsert a user from Farcaster authentication context
 *
 * Rules:
 * - If user exists: update signer wallet, spam score, and backfill referrer if missing
 * - If user doesn't exist: create new user with referrer (if valid)
 * - Referrer can only be set once (first referrer wins, no overwrites)
 * - Self-referral is not allowed
 *
 * @param params User data from Farcaster verification
 * @returns The upserted user row
 */
export async function upsertUserFromFarcaster(params: UpsertUserParams): Promise<UserRow> {
  const { fid, username, signerWallet, spamScore, referrerFid } = params;

  console.log(`[Referral] upsertUserFromFarcaster called: fid=${fid}, username=${username}, referrerFid=${referrerFid}`);

  // Validate referrer (cannot refer yourself)
  // Note: We trust the Farcaster FID is valid - no need to verify the referrer exists in our DB.
  // This allows users to share referral links before making their first guess.
  const validReferrerFid = referrerFid && referrerFid !== fid ? referrerFid : null;

  if (referrerFid && validReferrerFid === null) {
    console.log(`[Referral] Self-referral blocked: fid=${fid} tried to use referrerFid=${referrerFid}`);
  }

  // Check if user already exists
  const existingUser = await db
    .select()
    .from(users)
    .where(eq(users.fid, fid))
    .limit(1);

  if (existingUser.length > 0) {
    // User exists - update signer wallet, spam score, and potentially backfill referrer
    const user = existingUser[0];
    console.log(`[Referral] User FID ${fid} already exists (existing referrerFid=${user.referrerFid})`);

    // Backfill referrer if user doesn't have one yet (first referrer wins)
    const shouldBackfillReferrer = validReferrerFid && !user.referrerFid;
    if (shouldBackfillReferrer) {
      console.log(`[Referral] ✅ Backfilling referrer ${validReferrerFid} for existing user ${fid}`);

      // Log referral join analytics event (non-blocking)
      logReferralEvent(AnalyticsEventTypes.REFERRAL_JOIN, fid.toString(), {
        referrerFid: validReferrerFid,
        backfilled: true,
      });
    }

    // Check if any values need updating
    // Always update username if provided (Neynar is authoritative)
    const shouldUpdateUsername = username && user.username !== username;
    const needsUpdate =
      user.signerWalletAddress !== signerWallet ||
      user.spamScore !== spamScore ||
      shouldBackfillReferrer ||
      shouldUpdateUsername;

    if (needsUpdate) {
      const updated = await db
        .update(users)
        .set({
          signerWalletAddress: signerWallet,
          spamScore,
          ...(username && { username }),
          ...(shouldBackfillReferrer && { referrerFid: validReferrerFid }),
          updatedAt: new Date(),
        })
        .where(eq(users.fid, fid))
        .returning();

      console.log(`✅ Updated user FID ${fid}${shouldBackfillReferrer ? ` with backfilled referrer ${validReferrerFid}` : ''}`);
      return updated[0];
    }

    return user;
  }

  // User doesn't exist - create new user
  const newUser = await db
    .insert(users)
    .values({
      fid,
      username: username || null,
      signerWalletAddress: signerWallet,
      referrerFid: validReferrerFid,
      spamScore,
      xp: 0,
    })
    .returning();

  if (validReferrerFid) {
    console.log(`✅ Created new user FID ${fid} with referrer FID ${validReferrerFid}`);

    // Milestone 5.2: Log referral join analytics event (non-blocking)
    logReferralEvent(AnalyticsEventTypes.REFERRAL_JOIN, fid.toString(), {
      referrerFid: validReferrerFid,
    });
  } else {
    console.log(`✅ Created new user FID ${fid}`);
  }

  return newUser[0];
}

/**
 * Get user by FID
 */
export async function getUserByFid(fid: number): Promise<UserRow | null> {
  const result = await db
    .select()
    .from(users)
    .where(eq(users.fid, fid))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

/**
 * Get user by signer wallet address
 */
export async function getUserByWallet(wallet: string): Promise<UserRow | null> {
  const result = await db
    .select()
    .from(users)
    .where(eq(users.signerWalletAddress, wallet))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

/**
 * Check if a user exists
 */
export async function userExists(fid: number): Promise<boolean> {
  const user = await getUserByFid(fid);
  return user !== null;
}

import { db, users } from '../db';
import { eq } from 'drizzle-orm';
import type { UserRow } from '../db/schema';

/**
 * Parameters for upserting a user from Farcaster context
 */
export interface UpsertUserParams {
  fid: number;
  signerWallet: string | null;
  spamScore: number | null;
  referrerFid?: number | null;
}

/**
 * Upsert a user from Farcaster authentication context
 *
 * Rules:
 * - If user exists: update signer wallet and spam score
 * - If user doesn't exist: create new user with referrer (if valid)
 * - Referrer can only be set once (on first creation)
 * - Self-referral is not allowed
 *
 * @param params User data from Farcaster verification
 * @returns The upserted user row
 */
export async function upsertUserFromFarcaster(params: UpsertUserParams): Promise<UserRow> {
  const { fid, signerWallet, spamScore, referrerFid } = params;

  // Validate referrer (cannot refer yourself)
  const validReferrerFid = referrerFid && referrerFid !== fid ? referrerFid : null;

  // Check if user already exists
  const existingUser = await db
    .select()
    .from(users)
    .where(eq(users.fid, fid))
    .limit(1);

  if (existingUser.length > 0) {
    // User exists - update signer wallet and spam score
    const user = existingUser[0];

    // Only update if values have changed
    const needsUpdate =
      user.signerWalletAddress !== signerWallet ||
      user.spamScore !== spamScore;

    if (needsUpdate) {
      const updated = await db
        .update(users)
        .set({
          signerWalletAddress: signerWallet,
          spamScore,
          updatedAt: new Date(),
        })
        .where(eq(users.fid, fid))
        .returning();

      console.log(`✅ Updated user FID ${fid} with new wallet/spam score`);
      return updated[0];
    }

    return user;
  }

  // User doesn't exist - create new user
  const newUser = await db
    .insert(users)
    .values({
      fid,
      signerWalletAddress: signerWallet,
      referrerFid: validReferrerFid,
      spamScore,
      xp: 0,
    })
    .returning();

  if (validReferrerFid) {
    console.log(`✅ Created new user FID ${fid} with referrer FID ${validReferrerFid}`);
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

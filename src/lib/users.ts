import { db, users } from '../db';
import { eq, sql } from 'drizzle-orm';
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
    // Only update wallet if we have a new non-null value (don't overwrite existing with null)
    const shouldUpdateUsername = username && user.username !== username;
    const shouldUpdateWallet = signerWallet && user.signerWalletAddress !== signerWallet;
    const shouldUpdateSpamScore = spamScore !== null && user.spamScore !== spamScore;
    const needsUpdate =
      shouldUpdateWallet ||
      shouldUpdateSpamScore ||
      shouldBackfillReferrer ||
      shouldUpdateUsername;

    if (needsUpdate) {
      // The wallet-history gate caches wallet_tx_count keyed on FID, but the
      // value is specific to whichever signer_wallet_address it was fetched
      // for. If the wallet swaps under a FID, that cached count is stale and
      // would be returned by the gate's fast path — letting a fresh bot
      // wallet inherit a real wallet's pass. Clear the cache on swap so the
      // gate re-fetches against the new address.
      const updated = await db
        .update(users)
        .set({
          ...(shouldUpdateWallet && {
            signerWalletAddress: signerWallet,
            walletTxCount: null,
            walletTxCountCheckedAt: null,
          }),
          ...(shouldUpdateSpamScore && { spamScore }),
          ...(username && { username }),
          ...(shouldBackfillReferrer && { referrerFid: validReferrerFid }),
          updatedAt: new Date(),
        })
        .where(eq(users.fid, fid))
        .returning();

      console.log(`✅ Updated user FID ${fid}${shouldBackfillReferrer ? ` with backfilled referrer ${validReferrerFid}` : ''}${shouldUpdateWallet ? ' (wallet swapped — wallet-history cache cleared)' : ''}`);
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
 * Floor of the synthetic FID range used by wallet-native players.
 *
 * Must match the START/MINVALUE of wallet_player_fid_seq in
 * migrations/0031_wallet_identity.sql. Real Farcaster FIDs are around 1-2M, and
 * users.fid is a Postgres `integer` capped at 2,147,483,647, so this reserves
 * ~1.1B ids with no collision risk in either direction.
 */
export const WALLET_FID_MIN = 1_000_000_000;

/** True when this FID was minted for a wallet player rather than issued by Farcaster. */
export function isWalletFid(fid: number): boolean {
  return fid >= WALLET_FID_MIN;
}

export interface UpsertUserFromWalletParams {
  /** Address that produced a verified SIWE signature. Case-insensitive. */
  wallet: string;
  referrerFid?: number | null;
  /** Basename/ENS if resolved. Null leaves the row unnamed rather than inventing one. */
  username?: string | null;
}

/**
 * Resolve a SIWE-verified wallet to a player row, creating one if needed.
 *
 * THE CALLER MUST HAVE VERIFIED THE SIGNATURE. This function takes the address
 * as proven and will hand back an existing account for it.
 *
 * Three outcomes, in this order:
 *
 *  1. A wallet-origin row already holds this address — that is the player.
 *
 *  2. A FARCASTER row holds it. This is the interesting case and the reason the
 *     lookup is not simply scoped to wallet rows. signer_wallet_address is
 *     populated from Neynar's verified_addresses, which the user proved control
 *     of to Farcaster; they have now proved control of the same address to us
 *     via SIWE. Two independent proofs of one address, so it is the same human,
 *     and returning their existing FID keeps their guesses, Wordmarks, XP,
 *     grandfathering and referrals intact instead of stranding them behind a
 *     second empty account. Without this branch, an existing player opening the
 *     game in Base App would silently start over.
 *
 *     If several FIDs somehow share the address, the earliest is chosen — an
 *     arbitrary rule, but a STABLE one, which matters more: the alternative is
 *     a player whose identity changes between sign-ins. It is logged loudly
 *     because it should not happen.
 *
 *  3. Nobody holds it — mint a synthetic FID and create a wallet-origin row.
 *
 * Note that case 2 hands back a row whose identity_origin stays 'farcaster'.
 * That is correct: the account IS a Farcaster account, reached through a
 * different door. Only rows created by case 3 are wallet-origin, which is
 * exactly the set the partial unique index constrains.
 */
export async function upsertUserFromWallet(
  params: UpsertUserFromWalletParams
): Promise<UserRow> {
  const { referrerFid, username } = params;
  const wallet = params.wallet.toLowerCase();

  // Case 1 and 2 in one query: any row holding this address. Address comparison
  // is case-insensitive because the column holds both checksummed (Neynar) and
  // lowercased (ours) forms.
  //
  // ORDERING, when more than one row holds the address.
  //
  // Farcaster verification is EXCLUSIVE — an address is verified by at most one
  // FID at a time — so two rows holding one address means one of them is a
  // stale snapshot: the address moved and we never re-read the row it left.
  // That makes the older FID the likelier stale one, so ordering by fid alone
  // would tend to pick precisely the wrong row.
  //
  // But "which FID truly owns this address" is not the question this function
  // is answering. The question is "whose account is this", and the answer that
  // serves the player is the account they actually play. So: wallet-origin
  // rows first (they own the address by construction), then the most XP, then
  // lowest fid purely as a stable final tiebreak. Stability matters as much as
  // correctness here — a player whose identity changed between sign-ins would
  // be a far worse bug than one who landed on the less-active of their two
  // accounts.
  //
  // In production (2026-08-26) this affects exactly 2 wallets, each held by 2
  // FIDs, out of the whole table.
  const holders = await db
    .select()
    .from(users)
    .where(sql`lower(${users.signerWalletAddress}) = ${wallet}`)
    .orderBy(
      sql`(${users.identityOrigin} = 'wallet') DESC`,
      sql`${users.xp} DESC`,
      users.fid
    );

  if (holders.length > 0) {
    const user = holders[0];

    if (holders.length > 1) {
      console.warn(
        `[WalletAuth] Wallet ${wallet} is held by ${holders.length} rows ` +
          `(fids ${holders.map((h) => h.fid).join(', ')}) — resolving to ${user.fid}`
      );
    }

    // Backfill a referrer onto an account that has never had one, matching
    // upsertUserFromFarcaster's first-referrer-wins rule. Self-referral is
    // impossible here for a new wallet row but is checked anyway for case 2.
    const validReferrerFid =
      referrerFid && referrerFid !== user.fid && !user.referrerFid ? referrerFid : null;

    if (validReferrerFid || (username && user.username !== username)) {
      const [updated] = await db
        .update(users)
        .set({
          ...(validReferrerFid && { referrerFid: validReferrerFid }),
          ...(username && { username }),
          updatedAt: new Date(),
        })
        .where(eq(users.fid, user.fid))
        .returning();

      if (validReferrerFid) {
        logReferralEvent(AnalyticsEventTypes.REFERRAL_JOIN, user.fid.toString(), {
          referrerFid: validReferrerFid,
          backfilled: true,
          via: 'wallet',
        });
      }
      return updated;
    }

    console.log(
      `[WalletAuth] Wallet ${wallet} resolved to existing FID ${user.fid} (${user.identityOrigin})`
    );
    return user;
  }

  // Case 3: a genuinely new wallet-native player.
  //
  // The FID comes from the sequence rather than from max(fid)+1, so two
  // simultaneous first sign-ins cannot be handed the same number. The insert
  // can still lose a race against another request for the same wallet, which
  // the partial unique index turns into a conflict rather than a duplicate
  // player — hence the re-read below instead of a bare throw.
  // db.execute's result shape varies by driver (array vs { rows }), so the
  // value is dug out rather than destructured — destructuring yields undefined
  // on the other shape, and an undefined fid reaches the insert as a driver
  // error rather than as anything diagnosable.
  const seqResult: any = await db.execute(
    sql`SELECT nextval('wallet_player_fid_seq')::int AS fid`
  );
  const mintedFid = Number(
    (Array.isArray(seqResult) ? seqResult : seqResult?.rows ?? [])[0]?.fid
  );
  if (!Number.isInteger(mintedFid) || mintedFid < WALLET_FID_MIN) {
    throw new Error(
      `wallet_player_fid_seq returned an unusable value (${mintedFid}). ` +
        'Has migrations/0031_wallet_identity.sql been applied?'
    );
  }

  const inserted = await db
    .insert(users)
    .values({
      fid: mintedFid,
      username: username || null,
      signerWalletAddress: wallet,
      identityOrigin: 'wallet',
      referrerFid: referrerFid && referrerFid !== mintedFid ? referrerFid : null,
      spamScore: null,
      xp: 0,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted.length === 0) {
    const [raced] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.signerWalletAddress}) = ${wallet}`)
      .limit(1);
    if (!raced) {
      throw new Error(`Failed to create wallet player for ${wallet}`);
    }
    console.log(`[WalletAuth] Lost insert race for ${wallet}, using FID ${raced.fid}`);
    return raced;
  }

  const user = inserted[0];
  console.log(`[WalletAuth] Created wallet player FID ${user.fid} for ${wallet}`);

  if (user.referrerFid) {
    logReferralEvent(AnalyticsEventTypes.REFERRAL_JOIN, user.fid.toString(), {
      referrerFid: user.referrerFid,
      via: 'wallet',
    });
  }

  return user;
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

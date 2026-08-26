/**
 * Wallet-native player identity (Base App).
 *
 * Base App stopped hosting Farcaster mini apps on 2026-04-09, so a player there
 * arrives with a wallet and no FID. `upsertUserFromWallet` turns a SIWE-verified
 * address into a player row, and the behaviour that matters most is not the
 * creation path but the LINKING path: an existing Farcaster player who opens the
 * game in Base App must land on their own account, not a fresh empty one. That
 * is the difference between "the game remembers me" and "I lost my Wordmarks".
 *
 * Requires migrations/0031_wallet_identity.sql (sequence + identity_origin +
 * the partial unique index).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { db } from '../db';
import { users } from '../db/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { upsertUserFromWallet, isWalletFid, WALLET_FID_MIN } from '../lib/users';

const createdFids: number[] = [];

/** Unique per run so repeat runs never collide on the wallet unique index. */
function freshWallet(tag: string): string {
  const suffix = (process.hrtime.bigint() % 10n ** 12n).toString().padStart(12, '0');
  return `0x${tag.padEnd(28, '0').slice(0, 28)}${suffix}`.toLowerCase();
}

/**
 * A stand-in Farcaster FID: high enough to miss the seeded fixtures, and
 * deliberately BELOW WALLET_FID_MIN so the code under test reads it as a real
 * Farcaster account rather than a wallet-native one.
 */
function freshFarcasterFid(): number {
  return 900_000_000 + Number(process.hrtime.bigint() % 10_000_000n);
}

async function track<T extends { fid: number }>(row: T): Promise<T> {
  createdFids.push(row.fid);
  return row;
}

afterEach(async () => {
  if (createdFids.length > 0) {
    await db.delete(users).where(inArray(users.fid, createdFids));
    createdFids.length = 0;
  }
});

describe('creating a wallet-native player', () => {
  it('mints a synthetic FID above the real Farcaster range', async () => {
    const wallet = freshWallet('aa');
    const user = await track(await upsertUserFromWallet({ wallet }));

    expect(user.fid).toBeGreaterThanOrEqual(WALLET_FID_MIN);
    expect(isWalletFid(user.fid)).toBe(true);
    expect(user.identityOrigin).toBe('wallet');
    expect(user.signerWalletAddress).toBe(wallet);
    // Positive, because eleven endpoints validate `fid <= 0` and would reject
    // a negative scheme at the door.
    expect(user.fid).toBeGreaterThan(0);
    // Must fit Postgres `integer`, which is what users.fid is.
    expect(user.fid).toBeLessThanOrEqual(2_147_483_647);
  });

  it('returns the same player on a second sign-in, not a second account', async () => {
    const wallet = freshWallet('bb');
    const first = await track(await upsertUserFromWallet({ wallet }));
    const second = await upsertUserFromWallet({ wallet });

    expect(second.fid).toBe(first.fid);
  });

  it('treats a checksummed address as the same wallet as a lowercase one', async () => {
    const wallet = freshWallet('cc');
    const first = await track(await upsertUserFromWallet({ wallet }));
    // Base App and Neynar disagree about casing constantly; one wallet must
    // never become two players over it.
    const second = await upsertUserFromWallet({ wallet: wallet.toUpperCase().replace('0X', '0x') });

    expect(second.fid).toBe(first.fid);
  });
});

describe('linking to an existing Farcaster player', () => {
  it('resolves to their FID instead of stranding them on a new account', async () => {
    const wallet = freshWallet('dd');
    // A real player, exactly as upsertUserFromFarcaster would have left them:
    // wallet populated from Neynar verified_addresses, origin farcaster.
    const [inserted] = await db
      .insert(users)
      .values({
        fid: freshFarcasterFid(),
        username: 'realplayer',
        signerWalletAddress: wallet,
        xp: 500,
      })
      .returning();
    const existing = await track(inserted);

    const resolved = await upsertUserFromWallet({ wallet });

    expect(resolved.fid).toBe(existing.fid);
    expect(resolved.xp).toBe(500);
    // Still a Farcaster account — reached through a different door, not converted.
    expect(resolved.identityOrigin).toBe('farcaster');
  });

  it('lands on the account they actually play, not merely the oldest', async () => {
    // Two FIDs sharing one address means one snapshot is stale — Farcaster
    // verification is exclusive. Production has exactly two such wallets. The
    // older FID is the likelier stale one, so ordering by fid alone would pick
    // the wrong row; XP is the proxy for "the account with their history".
    const wallet = freshWallet('ba');
    const olderFid = freshFarcasterFid();
    const newerFid = olderFid + 1;

    const [older] = await db
      .insert(users)
      .values({ fid: olderFid, signerWalletAddress: wallet, xp: 0 })
      .returning();
    const [newer] = await db
      .insert(users)
      .values({ fid: newerFid, signerWalletAddress: wallet, xp: 4200 })
      .returning();
    await track(older);
    await track(newer);

    const resolved = await upsertUserFromWallet({ wallet });
    expect(resolved.fid).toBe(newerFid);

    // Stable across sign-ins, which matters more than the choice itself.
    expect((await upsertUserFromWallet({ wallet })).fid).toBe(newerFid);
  });

  it('does not create a wallet row alongside the linked one', async () => {
    const wallet = freshWallet('ee');
    const [seeded] = await db
      .insert(users)
      .values({ fid: freshFarcasterFid(), signerWalletAddress: wallet, xp: 0 })
      .returning();
    await track(seeded);

    await upsertUserFromWallet({ wallet });

    const rows = await db
      .select({ fid: users.fid })
      .from(users)
      .where(sql`lower(${users.signerWalletAddress}) = ${wallet}`);

    expect(rows).toHaveLength(1);
  });
});

describe('referrals', () => {
  it('records a referrer on a new wallet player', async () => {
    const wallet = freshWallet('ff');
    const user = await track(await upsertUserFromWallet({ wallet, referrerFid: 6500 }));
    expect(user.referrerFid).toBe(6500);
  });

  it('never lets a second sign-in overwrite the first referrer', async () => {
    const wallet = freshWallet('ab');
    const first = await track(await upsertUserFromWallet({ wallet, referrerFid: 6500 }));
    const second = await upsertUserFromWallet({ wallet, referrerFid: 999 });

    expect(second.fid).toBe(first.fid);
    expect(second.referrerFid).toBe(6500);
  });
});

describe('the unique index is real', () => {
  it('refuses a second wallet-origin row for one address', async () => {
    const wallet = freshWallet('ac');
    await track(await upsertUserFromWallet({ wallet }));

    // Bypass upsertUserFromWallet entirely — the database itself must refuse,
    // or a race between two first-time sign-ins would mint two players.
    await expect(
      db.insert(users).values({
        fid: WALLET_FID_MIN + 999_999,
        signerWalletAddress: wallet.toUpperCase().replace('0X', '0x'),
        identityOrigin: 'wallet',
        xp: 0,
      })
    ).rejects.toThrow();
  });
});

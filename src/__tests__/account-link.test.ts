/**
 * Linking a Base App wallet to an existing Farcaster account.
 *
 * THE PROBLEM. A returning Farcaster player who opens the game in Base App
 * silently became a brand-new account: their Base Account is a different wallet
 * from the Neynar-verified EOA in signer_wallet_address, so nothing matched and
 * a fresh synthetic FID was minted. They lost reward-gate grandfathering (keyed
 * on first_guess_round), their Early Adopter Wordmark (same column), their XP,
 * streak and referral history — at the exact moment they were being invited
 * through a new door. The owner's own account is the proof: fid 1000000001 was
 * the first wallet FID ever minted, created by someone who already held 6500.
 *
 * The rule these tests pin is the one that keeps the fix from becoming a hole:
 * an address vouches for exactly ONE player. Otherwise linking is a way to
 * attach one wallet to several accounts and multiply the daily allocation the
 * reward gate's one-wallet-one-fid claim exists to bound.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { db } from '../db';
import { users, userAddresses } from '../db/schema';
import { eq, inArray } from 'drizzle-orm';
import { upsertUserFromWallet, WALLET_FID_MIN } from '../lib/users';

const createdFids: number[] = [];
const createdWallets: string[] = [];

function freshWallet(tag: string): string {
  const suffix = (process.hrtime.bigint() % 10n ** 12n).toString().padStart(12, '0');
  const w = `0x${tag.padEnd(28, '0').slice(0, 28)}${suffix}`.toLowerCase();
  createdWallets.push(w);
  return w;
}

function freshFarcasterFid(): number {
  return 800_000_000 + Number(process.hrtime.bigint() % 10_000_000n);
}

async function track<T extends { fid: number }>(row: T): Promise<T> {
  createdFids.push(row.fid);
  return row;
}

afterEach(async () => {
  if (createdWallets.length > 0) {
    await db.delete(userAddresses).where(inArray(userAddresses.address, createdWallets));
    createdWallets.length = 0;
  }
  if (createdFids.length > 0) {
    await db.delete(users).where(inArray(users.fid, createdFids));
    createdFids.length = 0;
  }
});

describe('a linked address resolves to the account it belongs to', () => {
  it('returns the Farcaster player instead of minting a new wallet FID', async () => {
    const wallet = freshWallet('11');
    const fid = freshFarcasterFid();
    createdFids.push(fid);

    await db.insert(users).values({
      fid,
      username: 'veteran',
      // Deliberately a DIFFERENT address: this is the whole point. The
      // Neynar-verified EOA is not the Base Account.
      signerWalletAddress: '0x00000000000000000000000000000000000000ee',
      firstGuessRound: 12,
    });
    await db.insert(userAddresses).values({ fid, address: wallet });

    const resolved = await upsertUserFromWallet({ wallet });

    expect(resolved.fid).toBe(fid);
    expect(resolved.username).toBe('veteran');
    // The grandfather column travels with them, which is the benefit that was
    // being silently lost.
    expect(resolved.firstGuessRound).toBe(12);
  });

  it('takes precedence over the signer_wallet_address match', async () => {
    // An explicit two-sided proof beats a Neynar snapshot that may be stale.
    const wallet = freshWallet('12');
    const linkedFid = freshFarcasterFid();
    const snapshotFid = linkedFid + 1;
    createdFids.push(linkedFid, snapshotFid);

    await db.insert(users).values({ fid: linkedFid, username: 'linked' });
    await db.insert(users).values({
      fid: snapshotFid,
      username: 'snapshot',
      signerWalletAddress: wallet,
    });
    await db.insert(userAddresses).values({ fid: linkedFid, address: wallet });

    const resolved = await upsertUserFromWallet({ wallet });
    expect(resolved.fid).toBe(linkedFid);
  });

  it('is case-insensitive, since addresses arrive checksummed and not', async () => {
    const wallet = freshWallet('13');
    const fid = freshFarcasterFid();
    createdFids.push(fid);

    await db.insert(users).values({ fid, username: 'mixedcase' });
    await db.insert(userAddresses).values({ fid, address: wallet });

    const resolved = await upsertUserFromWallet({ wallet: wallet.toUpperCase().replace('0X', '0x') });
    expect(resolved.fid).toBe(fid);
  });
});

describe('an address vouches for exactly one player', () => {
  it('refuses a second link for the same wallet at the database level', async () => {
    const wallet = freshWallet('14');
    const fidA = freshFarcasterFid();
    const fidB = fidA + 1;
    createdFids.push(fidA, fidB);

    await db.insert(users).values({ fid: fidA, username: 'first' });
    await db.insert(users).values({ fid: fidB, username: 'second' });
    await db.insert(userAddresses).values({ fid: fidA, address: wallet });

    // Without this constraint, linking would be a way to attach one wallet to
    // several accounts and multiply the daily allocation the reward gate
    // bounds per wallet.
    await expect(
      db.insert(userAddresses).values({ fid: fidB, address: wallet })
    ).rejects.toThrow();
  });
});

describe('a stale link never breaks a sign-in', () => {
  it('falls through and mints normally when the link points at a missing account', async () => {
    const wallet = freshWallet('15');
    await db.insert(userAddresses).values({ fid: 799_999_999, address: wallet });

    const resolved = await track(await upsertUserFromWallet({ wallet }));

    // Bookkeeping that has gone stale is not a reason to refuse someone entry.
    expect(resolved.fid).toBeGreaterThanOrEqual(WALLET_FID_MIN);
    expect(resolved.identityOrigin).toBe('wallet');
  });
});

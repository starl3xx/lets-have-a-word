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

describe('a pre-link session cannot outlive the link', () => {
  /**
   * Linking mints a new session, but the OLD one stays cryptographically valid
   * for its full 30 days and we cannot reach it to revoke it: Base App's
   * webview pins cookies it will not update. That is the same jar behaviour
   * that caused the original lockout, cutting the other way — cookie-first
   * resolution would keep answering with the synthetic identity the player just
   * linked away from, while the client held the correct new token.
   *
   * So resolution asks who owns the address NOW rather than trusting the fid
   * baked into the token. (Bugbot, PR #293.)
   */
  it('resolves an old wallet session to the account the wallet is linked to', async () => {
    const { signPlayerSession } = await import('../lib/playerSession');
    const { resolvePlayerSessionFromRequest } = await import('../lib/requestAuth');

    const wallet = freshWallet('16');
    const farcasterFid = freshFarcasterFid();
    const walletFid = WALLET_FID_MIN + 900;
    createdFids.push(farcasterFid, walletFid);

    await db.insert(users).values({ fid: farcasterFid, username: 'veteran' });
    await db.insert(users).values({
      fid: walletFid,
      identityOrigin: 'wallet',
      signerWalletAddress: wallet,
    });

    const secret = process.env.ADMIN_SECRET || 'test-secret-not-a-real-one';
    process.env.ADMIN_SECRET = secret;

    // The token minted BEFORE linking, naming the synthetic account.
    const staleToken = await signPlayerSession(
      { fid: walletFid, origin: 'wallet', wallet },
      secret
    );

    // Before the link it is exactly what it says it is.
    const before = await resolvePlayerSessionFromRequest({
      cookies: { lhaw_player_session: staleToken },
      headers: {},
    } as never);
    expect(before.session?.fid).toBe(walletFid);

    await db.insert(userAddresses).values({ fid: farcasterFid, address: wallet });

    // After the link the SAME token resolves to the linked account.
    const after = await resolvePlayerSessionFromRequest({
      cookies: { lhaw_player_session: staleToken },
      headers: {},
    } as never);
    expect(after.session?.fid).toBe(farcasterFid);
    expect(after.session?.origin).toBe('farcaster');
  });
});

describe('a link pointing at a missing account is ignored, everywhere', () => {
  it('leaves a wallet session as itself rather than resolving to a ghost', async () => {
    // upsertUserFromWallet already falls through on a dangling link and mints
    // normally. Without the same rule in session resolution, sign-in would
    // succeed while every later request resolved to an account that does not
    // exist — the player would be a ghost. (Bugbot, PR #293.)
    const { signPlayerSession } = await import('../lib/playerSession');
    const { resolvePlayerSessionFromRequest } = await import('../lib/requestAuth');

    const wallet = freshWallet('17');
    const walletFid = WALLET_FID_MIN + 901;
    createdFids.push(walletFid);

    await db.insert(users).values({
      fid: walletFid,
      identityOrigin: 'wallet',
      signerWalletAddress: wallet,
    });
    // A link to a fid with no users row.
    await db.insert(userAddresses).values({ fid: 799_999_998, address: wallet });

    const secret = process.env.ADMIN_SECRET || 'test-secret-not-a-real-one';
    process.env.ADMIN_SECRET = secret;
    const token = await signPlayerSession({ fid: walletFid, origin: 'wallet', wallet }, secret);

    const resolved = await resolvePlayerSessionFromRequest({
      cookies: { lhaw_player_session: token },
      headers: {},
    } as never);

    expect(resolved.session?.fid).toBe(walletFid);
    expect(resolved.session?.origin).toBe('wallet');
  });
});

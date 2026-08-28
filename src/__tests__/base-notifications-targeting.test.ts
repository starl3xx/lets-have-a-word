/**
 * A targeted push must never become a broadcast.
 *
 * `sendNotification(title, body, targetUrl, targetFids)` honoured targetFids on
 * the Neynar rail and passed NOTHING to the Base rail, which selected every
 * wallet-origin row. No caller passes targetFids today, so this was latent —
 * but the parameter is public and documented, so the first targeted send
 * anyone wrote (a winner nudge, a Superguess ping, an admin send) would have
 * gone to the entire Base App audience.
 *
 * A push cannot be recalled, and this is the only channel these players have.
 * Silence is recoverable; a wrong broadcast is not.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { db } from '../db';
import { users, userAddresses } from '../db/schema';
import { inArray } from 'drizzle-orm';
import { resolveBaseAudience } from '../lib/base-notifications';

const createdFids: number[] = [];
const createdWallets: string[] = [];

/** Fresh per run. Fixed ids leave rows behind that make a later run assert
 *  against the wrong data — the same trap that made three versions of the
 *  share-bonus test vacuous. */
function freshFid(offset: number): number {
  return 1_000_100_000 + Number(process.hrtime.bigint() % 5_000_000n) + offset;
}

function freshWallet(tag: string): string {
  const suffix = (process.hrtime.bigint() % 10n ** 12n).toString().padStart(12, '0');
  const w = `0x${tag.padEnd(28, '0').slice(0, 28)}${suffix}`.toLowerCase();
  createdWallets.push(w);
  return w;
}

afterEach(async () => {
  // Rows left behind are not harmless: a stale row makes a later run of these
  // same assertions pass or fail for the wrong reason, which is exactly how
  // three attempts at the share-bonus test came out vacuous.
  if (createdWallets.length) {
    await db.delete(userAddresses).where(inArray(userAddresses.address, createdWallets));
    createdWallets.length = 0;
  }
  if (createdFids.length) {
    await db.delete(users).where(inArray(users.fid, createdFids));
    createdFids.length = 0;
  }
});

describe('targeting', () => {
  it('resolves only the named players, not everyone', async () => {
    const targetWallet = freshWallet('a1');
    const otherWallet = freshWallet('a2');
    const targetFid = freshFid(0);
    const otherFid = freshFid(1);
    createdFids.push(targetFid, otherFid);

    await db.insert(users).values([
      { fid: targetFid, identityOrigin: 'wallet', signerWalletAddress: targetWallet },
      { fid: otherFid, identityOrigin: 'wallet', signerWalletAddress: otherWallet },
    ]);

    const audience = await resolveBaseAudience([targetFid]);
    expect(audience.map((w) => w.toLowerCase())).toEqual([targetWallet]);
    expect(audience.map((w) => w.toLowerCase())).not.toContain(otherWallet);
  });

  it('resolves NOBODY when no targeted player is reachable, rather than everyone', async () => {
    // The dangerous shape: an empty audience must not fall back to a broadcast.
    const otherWallet = freshWallet('a3');
    const otherFid = freshFid(2);
    createdFids.push(otherFid);
    await db
      .insert(users)
      .values({ fid: otherFid, identityOrigin: 'wallet', signerWalletAddress: otherWallet });

    const audience = await resolveBaseAudience([4242]);
    expect(audience).toEqual([]);
  });

  it('treats an empty target list as nobody, never as everybody', async () => {
    const someWallet = freshWallet('a5');
    const someFid = freshFid(3);
    createdFids.push(someFid);
    await db
      .insert(users)
      .values({ fid: someFid, identityOrigin: 'wallet', signerWalletAddress: someWallet });

    expect(await resolveBaseAudience([])).toEqual([]);
  });

  it('reaches a LINKED player, whose row is farcaster-origin', async () => {
    // After linking, a returning veteran keeps their Farcaster row while
    // playing in Base App through a linked address. Selecting only
    // wallet-origin rows would mean linking silently costs them the one
    // notification channel they have.
    const linkedWallet = freshWallet('a4');
    const veteranFid = 700_000_000 + Number(process.hrtime.bigint() % 5_000_000n);
    createdFids.push(veteranFid);

    await db.insert(users).values({ fid: veteranFid, username: 'veteran' });
    await db.insert(userAddresses).values({ fid: veteranFid, address: linkedWallet });

    const audience = await resolveBaseAudience([veteranFid]);
    expect(audience.map((w) => w.toLowerCase())).toEqual([linkedWallet]);
  });
});

/**
 * Who gets the packs?
 *
 * This endpoint has always read `fid` from the request body and believed it,
 * which is what made the txHash front-run possible: an attacker holding an FID
 * Neynar has no record of can plant a victim's wallet, watch for the victim's
 * purchase, and claim it first — `pack_purchases.tx_hash` is unique, so first
 * submitter wins and the buyer loses their packs.
 *
 * The onchain verification is mocked. That is the part viem/ethers and
 * `word-jackpot-contract` already own, and reaching Base from a test is the
 * thing this repo has been burned by. What is under test is the resolution
 * itself: a verified credential must beat the body, an unauthenticated caller
 * must still work during the phase-1 rollout, and a wallet player must not be
 * able to claim someone else's payment.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const { mockPackVerify, mockLegacyVerify, mockTier, mockTierChecked, mockRateLimit } =
  vi.hoisted(() => ({
    mockPackVerify: vi.fn(),
    mockLegacyVerify: vi.fn(),
    mockTier: vi.fn(async () => 0),
    mockTierChecked: vi.fn(async () => ({ tier: 0, determined: true })),
    mockRateLimit: vi.fn(),
  }));

/**
 * The limiter is mocked so the test can see WHICH identity it was handed.
 *
 * The first version of this file used `vi.spyOn({ checkPurchaseRateLimit }, ...)`,
 * which spies on a freshly built object literal — the handler imports the real
 * function from the module and never touches that object, so the spy observed
 * nothing and the test asserted nothing. Bugbot caught it on #277. Mocking the
 * module is the only way to make the assertion real.
 */
vi.mock('../lib/rateLimit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/rateLimit')>();
  return { ...actual, checkPurchaseRateLimit: mockRateLimit };
});

/**
 * Keep this file off the network.
 *
 * getOrCreateDailyState resolves the $WORD holder tier, which reads an ERC-20
 * balance from Base. Without this mock the suite makes a live mainnet call per
 * seeded wallet — the exact failure this repo hit on 2026-08-15, when a change
 * routed around a hand-written stub and the tests started talking to mainnet
 * with fabricated addresses. The tell is runtime: this file ran in ~2.5s with
 * the real provider and ~0.2s without it. Same pattern as
 * guess-path-performance.test.ts.
 */
vi.mock('../lib/word-token', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/word-token')>();
  return { ...actual, getWordBonusTier: mockTier, getWordBonusTierChecked: mockTierChecked };
});

vi.mock('../lib/word-jackpot-contract', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/word-jackpot-contract')>();
  return {
    ...actual,
    isWordEconomyConfigured: () => true,
    getWordJackpotConfig: () => ({ wordPackSalesAddress: '0x' + '1'.repeat(40) }),
    verifyPackPurchaseTransaction: mockPackVerify,
  };
});

vi.mock('../lib/jackpot-contract', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/jackpot-contract')>();
  return { ...actual, verifyPurchaseTransaction: mockLegacyVerify };
});

import handler from '../../pages/api/purchase-guess-pack';
import { db } from '../db';
import { users, rounds, packPurchases } from '../db/schema';
import { eq, inArray } from 'drizzle-orm';
import { signPlayerSession, PLAYER_SESSION_COOKIE } from '../lib/playerSession';
import { upsertUserFromWallet } from '../lib/users';

const SECRET = 'test-secret-not-a-real-one';
const originalSecret = process.env.ADMIN_SECRET;

const createdFids: number[] = [];
const createdRounds: number[] = [];
const createdTx: string[] = [];

function freshTx(): string {
  const tx = '0x' + (process.hrtime.bigint() % 10n ** 18n).toString().padStart(64, '0');
  createdTx.push(tx);
  return tx;
}

function post(body: unknown, cookies: Record<string, string> = {}) {
  return new Promise<{ status: number; body: any }>((resolve) => {
    let status = 200;
    const res = {
      status(c: number) {
        status = c;
        return this;
      },
      json(payload: unknown) {
        resolve({ status, body: payload });
        return this;
      },
      setHeader() {
        return this;
      },
      end() {
        return this;
      },
    };
    handler(
      { method: 'POST', body, cookies, headers: {}, query: {} } as unknown as NextApiRequest,
      res as unknown as NextApiResponse
    );
  });
}

async function activeRound() {
  const [r] = await db
    .insert(rounds)
    .values({
      rulesetId: 1,
      answer: 'PACKS',
      salt: `s-pack-${process.hrtime.bigint()}`,
      commitHash: 'c'.repeat(64),
      prizePoolEth: '0',
      seedNextRoundEth: '0',
      prizeCurrency: 'word',
      prizePoolWord: '0',
      status: 'active',
    })
    .returning();
  createdRounds.push(r.id);
  return r;
}

beforeEach(() => {
  process.env.ADMIN_SECRET = SECRET;
  // A generous, valid-looking payment so the amount check never decides the
  // outcome — these tests are about identity, not price.
  mockPackVerify.mockReset().mockResolvedValue({
    valid: true,
    weiAmount: (10n ** 18n).toString(),
    payer: '0x' + 'a'.repeat(40),
    logIndex: 0,
  });
  mockLegacyVerify.mockReset().mockResolvedValue({ valid: false, error: 'legacy rail off' });
  mockRateLimit.mockReset().mockResolvedValue({ allowed: true });
});

afterEach(async () => {
  if (originalSecret === undefined) delete process.env.ADMIN_SECRET;
  else process.env.ADMIN_SECRET = originalSecret;

  if (createdTx.length) {
    await db.delete(packPurchases).where(inArray(packPurchases.txHash, createdTx));
    createdTx.length = 0;
  }
  if (createdRounds.length) {
    await db.delete(rounds).where(inArray(rounds.id, createdRounds));
    createdRounds.length = 0;
  }
  if (createdFids.length) {
    await db.delete(users).where(inArray(users.fid, createdFids));
    createdFids.length = 0;
  }
});

describe('a verified credential beats the body', () => {
  it('attributes the purchase to the session FID, not the one in the body', async () => {
    await activeRound();
    const wallet = `0x${'b'.repeat(39)}1`;
    const victim = await upsertUserFromWallet({ wallet });
    createdFids.push(victim.fid);

    // The payer must match the signed-in wallet, or the binding (correctly)
    // rejects before we can observe which FID was used.
    mockPackVerify.mockResolvedValue({
      valid: true,
      weiAmount: (10n ** 18n).toString(),
      payer: wallet,
      logIndex: 0,
    });

    const token = await signPlayerSession(
      { fid: victim.fid, origin: 'wallet', wallet },
      SECRET
    );
    const txHash = freshTx();

    const { status } = await post(
      { fid: 999999123, packCount: 1, txHash }, // a body FID that is not theirs
      { [PLAYER_SESSION_COOKIE]: token }
    );

    expect(status).toBe(200);

    const [row] = await db
      .select({ fid: packPurchases.fid })
      .from(packPurchases)
      .where(eq(packPurchases.txHash, txHash));

    // The whole point: the body said 999999123, the credential said otherwise.
    expect(row?.fid).toBe(victim.fid);
    expect(row?.fid).not.toBe(999999123);
  });
});

describe('the wallet-player payer binding', () => {
  it('refuses a payment made by a different wallet', async () => {
    await activeRound();
    const wallet = `0x${'c'.repeat(39)}2`;
    const player = await upsertUserFromWallet({ wallet });
    createdFids.push(player.fid);

    // Their signature proves `wallet`; the chain says someone else paid.
    mockPackVerify.mockResolvedValue({
      valid: true,
      weiAmount: (10n ** 18n).toString(),
      payer: `0x${'d'.repeat(40)}`,
      logIndex: 0,
    });

    const token = await signPlayerSession({ fid: player.fid, origin: 'wallet', wallet }, SECRET);
    const txHash = freshTx();

    const { status, body } = await post(
      { fid: player.fid, packCount: 1, txHash },
      { [PLAYER_SESSION_COOKIE]: token }
    );

    expect(status).toBe(403);
    expect(body.error).toMatch(/different wallet/i);

    // And nothing was credited.
    const rows = await db
      .select({ id: packPurchases.id })
      .from(packPurchases)
      .where(eq(packPurchases.txHash, txHash));
    expect(rows).toHaveLength(0);
  });

  it('allows a payment from the wallet they signed in with', async () => {
    await activeRound();
    const wallet = `0x${'e'.repeat(39)}3`;
    const player = await upsertUserFromWallet({ wallet });
    createdFids.push(player.fid);

    // Checksummed on the chain, lowercased in the session — must still match.
    mockPackVerify.mockResolvedValue({
      valid: true,
      weiAmount: (10n ** 18n).toString(),
      payer: wallet.toUpperCase().replace('0X', '0x'),
      logIndex: 0,
    });

    const token = await signPlayerSession({ fid: player.fid, origin: 'wallet', wallet }, SECRET);
    const { status } = await post(
      { fid: player.fid, packCount: 1, txHash: freshTx() },
      { [PLAYER_SESSION_COOKIE]: token }
    );

    expect(status).toBe(200);
  });
});

describe('phase-1 fallback', () => {
  it('still accepts an unauthenticated caller, so un-reloaded clients keep working', async () => {
    await activeRound();
    const [seeded] = await db
      .insert(users)
      .values({ fid: 900_500_001, username: 'farcasterplayer', xp: 0 })
      .returning();
    createdFids.push(seeded.fid);

    const txHash = freshTx();
    const { status } = await post({ fid: seeded.fid, packCount: 1, txHash });

    // Phase 2 deletes this branch once the unauthenticated share reaches zero.
    expect(status).toBe(200);

    const [row] = await db
      .select({ fid: packPurchases.fid })
      .from(packPurchases)
      .where(eq(packPurchases.txHash, txHash));
    expect(row?.fid).toBe(seeded.fid);
  });

  it('does not apply the payer binding to a Farcaster player', async () => {
    // Their signer_wallet_address is a Neynar-verified EOA while the payment
    // may come from a Base Account. Rejecting on mismatch would take an honest
    // buyer's ETH and give nothing back.
    await activeRound();
    const [seeded] = await db
      .insert(users)
      .values({
        fid: 900_500_002,
        username: 'eoaplayer',
        signerWalletAddress: `0x${'f'.repeat(40)}`,
        xp: 0,
      })
      .returning();
    createdFids.push(seeded.fid);

    mockPackVerify.mockResolvedValue({
      valid: true,
      weiAmount: (10n ** 18n).toString(),
      payer: `0x${'9'.repeat(40)}`, // a different address entirely
      logIndex: 0,
    });

    const { status } = await post({ fid: seeded.fid, packCount: 1, txHash: freshTx() });
    expect(status).toBe(200);
  });
});

/**
 * The two Bugbot findings on PR #277, pinned.
 */
describe('rate limiting keys on the verified buyer', () => {
  it('hands the limiter the verified FID, not the one in the body', async () => {
    await activeRound();
    const wallet = `0x${'7'.repeat(39)}4`;
    const player = await upsertUserFromWallet({ wallet });
    createdFids.push(player.fid);

    mockPackVerify.mockResolvedValue({
      valid: true,
      weiAmount: (10n ** 18n).toString(),
      payer: wallet,
      logIndex: 0,
    });

    const token = await signPlayerSession({ fid: player.fid, origin: 'wallet', wallet }, SECRET);

    // A body FID that is not theirs. Before the fix the limiter bucketed on
    // exactly this value, so rotating it on each request skipped the
    // 4-per-5-minute cap while the packs still landed on the real identity.
    await post({ fid: 111111, packCount: 1, txHash: freshTx() }, { [PLAYER_SESSION_COOKIE]: token });

    expect(mockRateLimit).toHaveBeenCalled();
    const [keyedFid] = mockRateLimit.mock.calls[0];
    expect(keyedFid).toBe(player.fid);
    expect(keyedFid).not.toBe(111111);
  });

  it('falls back to the body FID when there is no credential to key on', async () => {
    await activeRound();
    const [seeded] = await db
      .insert(users)
      .values({ fid: 900_500_004, username: 'anon', xp: 0 })
      .returning();
    createdFids.push(seeded.fid);

    await post({ fid: seeded.fid, packCount: 1, txHash: freshTx() });

    const [keyedFid] = mockRateLimit.mock.calls[0];
    expect(keyedFid).toBe(seeded.fid);
  });

  it('still refuses when the limiter says no', async () => {
    mockRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 300 });
    const { status } = await post({ fid: 900_500_005, packCount: 1, txHash: freshTx() });
    expect(status).toBe(429);
  });
});

describe('dev mode credits the buyer, not 6500', () => {
  const originalDev = process.env.NEXT_PUBLIC_LHAW_DEV_MODE;
  afterEach(() => {
    if (originalDev === undefined) delete process.env.NEXT_PUBLIC_LHAW_DEV_MODE;
    else process.env.NEXT_PUBLIC_LHAW_DEV_MODE = originalDev;
  });

  it('prefers an explicit body FID over the dev-mode 6500 default', async () => {
    process.env.NEXT_PUBLIC_LHAW_DEV_MODE = 'true';
    await activeRound();

    const [buyer] = await db
      .insert(users)
      .values({ fid: 900_500_003, username: 'devbuyer', xp: 0 })
      .returning();
    createdFids.push(buyer.fid);

    const txHash = freshTx();
    // No devFid in the body: an older client that has not shipped the new prop.
    const { status } = await post({ fid: buyer.fid, packCount: 1, txHash });
    expect(status).toBe(200);

    const [row] = await db
      .select({ fid: packPurchases.fid })
      .from(packPurchases)
      .where(eq(packPurchases.txHash, txHash));

    // resolveRequestFid would answer 6500 here. The buyer paid, so the buyer
    // gets the packs.
    expect(row?.fid).toBe(buyer.fid);
    expect(row?.fid).not.toBe(6500);
  });
});

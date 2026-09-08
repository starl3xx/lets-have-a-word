/**
 * The mint sponsorship path against the REAL @upstash/redis client.
 *
 * Everything before this suite tested the budget rules against a hand-rolled
 * fake, and the path's four historical defects all lived in the gap between
 * that fake and reality. Here the real client speaks its real wire protocol
 * to a wire-faithful shim (helpers/upstash-shim.ts), the real handler runs
 * end to end, and the upstream paymaster is a local server whose failure
 * modes each test picks. No real sleeps: the shim's clock is the only time.
 *
 * MODULE ORDER IS LOAD-BEARING. src/lib/redis.ts freezes its singleton at
 * import time, and the global setup chain has already imported it with no
 * UPSTASH env. So: start servers, set env, vi.resetModules(), then
 * dynamic-import everything from the fresh graph.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { vi } from 'vitest';
import { ethers } from 'ethers';
import type { NextApiRequest, NextApiResponse } from 'next';
import {
  startUpstashShim,
  startMockUpstream,
  type UpstashShim,
  type MockUpstream,
} from './helpers/upstash-shim';

const SALES = '0x1111111111111111111111111111111111111111';
const WORDMARKS = '0x3333333333333333333333333333333333333333';
const PLAYER = '0x4444444444444444444444444444444444444444';
// A fixed throwaway signing key: the "attestor" for this suite only.
const ATTESTOR_KEY = '0x' + '59'.repeat(32);
const ERC_8021_SUFFIX = '62635f6c756c34736c64770b0080218021802180218021802180218021';
const FID = 6500;
const ID = 10;

let shim: UpstashShim;
let upstream: MockUpstream;
let handler: (req: NextApiRequest, res: NextApiResponse) => Promise<unknown>;
let redis: { set: Function; get: Function };
let mintBudgetKey: (fid: number | bigint, id: number | bigint) => string;
let MINT_SPONSOR_BUDGET: number;
let parseBudget: (raw: unknown) => number;

const coder = ethers.AbiCoder.defaultAbiCoder();

async function signVoucher(overrides: Partial<{ fid: number; id: number; deadline: number; to: string; signer: string }> = {}) {
  const wallet = new ethers.Wallet(overrides.signer ?? ATTESTOR_KEY);
  const claim = {
    fid: overrides.fid ?? FID,
    to: overrides.to ?? PLAYER,
    id: overrides.id ?? ID,
    deadline: overrides.deadline ?? 1_900_000_000,
  };
  const signature = await wallet.signTypedData(
    { name: 'LetsHaveAWordWordmarks', version: '1', chainId: 8453, verifyingContract: WORDMARKS },
    {
      Claim: [
        { name: 'fid', type: 'uint256' },
        { name: 'to', type: 'address' },
        { name: 'id', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    claim
  );
  return { ...claim, signature };
}

/** execute-wrapped mint calldata, ERC-8021-suffixed — the real client shape. */
function mintCallData(v: { fid: number; to: string; id: number; deadline: number; signature: string }): string {
  const inner =
    ethers.id('mint(uint256,address,uint256,uint256,bytes)').slice(0, 10) +
    coder
      .encode(['uint256', 'address', 'uint256', 'uint256', 'bytes'], [v.fid, v.to, v.id, v.deadline, v.signature])
      .slice(2) +
    ERC_8021_SUFFIX;
  return '0xb61d27f6' + coder.encode(['address', 'uint256', 'bytes'], [WORDMARKS, 0n, inner]).slice(2);
}

function run(body: Record<string, unknown>) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    let status = 200;
    const res = {
      status(c: number) {
        status = c;
        return this;
      },
      json(b: unknown) {
        resolve({ status, body: b });
        return this;
      },
      setHeader() {
        return this;
      },
      end() {
        resolve({ status, body: null });
        return this;
      },
    };
    handler(
      {
        method: 'POST',
        body,
        cookies: {},
        headers: {},
        query: {},
        socket: { remoteAddress: '127.0.0.1' },
      } as unknown as NextApiRequest,
      res as unknown as NextApiResponse
    ).catch(reject);
  });
}

function paymasterBody(callData: string, method = 'pm_getPaymasterData') {
  return { id: 1, method, params: [{ callData, sender: PLAYER }] };
}

beforeAll(async () => {
  shim = await startUpstashShim();
  upstream = await startMockUpstream();

  process.env.UPSTASH_REDIS_REST_URL = shim.url;
  process.env.UPSTASH_REDIS_REST_TOKEN = shim.token;
  process.env.PAYMASTER_SERVICE_URL = upstream.url;
  process.env.NEXT_PUBLIC_WORD_PACK_SALES_ADDRESS = SALES;
  process.env.NEXT_PUBLIC_WORDMARKS_ADDRESS = WORDMARKS;
  process.env.WORDMARK_ATTESTOR_PRIVATE_KEY = ATTESTOR_KEY;

  vi.resetModules();
  handler = (await import('../../pages/api/paymaster')).default as typeof handler;
  ({ mintBudgetKey, MINT_SPONSOR_BUDGET } = await import('../../pages/api/wordmarks/voucher'));
  ({ parseBudget } = await import('../lib/mint-sponsorship'));
  ({ redis } = (await import('../lib/redis')) as unknown as { redis: typeof redis });
  expect(redis).toBeTruthy();
});

afterAll(async () => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.PAYMASTER_SERVICE_URL;
  delete process.env.NEXT_PUBLIC_WORD_PACK_SALES_ADDRESS;
  delete process.env.NEXT_PUBLIC_WORDMARKS_ADDRESS;
  delete process.env.WORDMARK_ATTESTOR_PRIVATE_KEY;
  vi.resetModules();
  await shim.close();
  await upstream.close();
});

beforeEach(() => {
  shim.store.clear();
  shim.requests.length = 0;
  upstream.requests.length = 0;
  upstream.mode.current = 'ok';
});

const KEY = () => mintBudgetKey(FID, ID);
const seed = () => redis.set(KEY(), MINT_SPONSOR_BUDGET, { ex: 600 });

describe('sponsorship against the real client', () => {
  it('sponsors a genuine voucher and spends exactly one unit', async () => {
    await seed();
    const v = await signVoucher();
    const { body } = await run(paymasterBody(mintCallData(v)));
    expect(body.result).toBeTruthy();
    expect(shim.store.get(KEY())?.value).toBe(String(MINT_SPONSOR_BUDGET - 1));
    expect(upstream.requests).toHaveLength(1);
  });

  it('stores the budget as a string and reads it back as a number — the round-trip that bit twice', async () => {
    await seed();
    expect(shim.store.get(KEY())?.value).toBe('3');
    expect(await redis.get(KEY())).toBe(3);
    expect(parseBudget('3')).toBe(3);
    expect(parseBudget(3)).toBe(3);
  });

  it('exhausts to refusal: budget-many sponsorships, then no more, and no decr past zero', async () => {
    await seed();
    const v = await signVoucher();
    for (let i = 0; i < MINT_SPONSOR_BUDGET; i++) {
      const { body } = await run(paymasterBody(mintCallData(v)));
      expect(body.result).toBeTruthy();
    }
    const { body } = await run(paymasterBody(mintCallData(v)));
    expect(body.error?.message).toMatch(/no voucher/i);
    expect(shim.store.get(KEY())?.value).toBe('0');
    expect(shim.commandCount('decr', 'mintbudget')).toBe(MINT_SPONSOR_BUDGET);
    expect(upstream.requests).toHaveLength(MINT_SPONSOR_BUDGET);
  });

  it('refunds an upstream network failure and preserves the voucher’s REMAINING life', async () => {
    await seed();
    const expiresAt = shim.store.get(KEY())!.expiresAt;
    shim.advance(100_000); // 500s remain
    upstream.mode.current = 'die';
    const v = await signVoucher();
    const { body } = await run(paymasterBody(mintCallData(v)));
    expect(body.error?.message).toMatch(/upstream unavailable/i);
    expect(shim.store.get(KEY())?.value).toBe(String(MINT_SPONSOR_BUDGET));
    // expire(remaining) must land on the original deadline, never a fresh 600.
    expect(shim.store.get(KEY())?.expiresAt).toBe(expiresAt);
  });

  it('refunds a forwarded upstream error exactly once, and forwards it verbatim', async () => {
    await seed();
    upstream.mode.current = 'rpcError';
    const v = await signVoucher();
    const { body } = await run(paymasterBody(mintCallData(v)));
    expect(body.error?.message).toBe('policy says no');
    expect(shim.store.get(KEY())?.value).toBe(String(MINT_SPONSOR_BUDGET));
    expect(shim.commandCount('incr', 'mintbudget')).toBe(1);
  });

  it('refunds an upstream HTTP 500 exactly once', async () => {
    await seed();
    upstream.mode.current = 'http500';
    const v = await signVoucher();
    await run(paymasterBody(mintCallData(v)));
    expect(shim.store.get(KEY())?.value).toBe(String(MINT_SPONSOR_BUDGET));
    expect(shim.commandCount('incr', 'mintbudget')).toBe(1);
  });

  it('skips the refund of a voucher that expired while the upstream failed', async () => {
    await seed();
    upstream.mode.current = 'die';
    shim.before('ttl', KEY(), () => shim.advance(601_000));
    const v = await signVoucher();
    await run(paymasterBody(mintCallData(v)));
    expect(shim.commandCount('incr', 'mintbudget')).toBe(0);
    expect(shim.store.get(KEY())).toBeUndefined();
  });

  it('skips the refund of a voucher with under a second left — the TTL-0 trap', async () => {
    await seed();
    shim.advance(599_600); // 400ms remain: TTL reports 0, key still alive
    upstream.mode.current = 'die';
    const v = await signVoucher();
    await run(paymasterBody(mintCallData(v)));
    expect(shim.commandCount('incr', 'mintbudget')).toBe(0);
    // Spent and not refunded: a dying voucher never buys a fresh ten minutes.
    expect(shim.store.get(KEY())?.value).toBe(String(MINT_SPONSOR_BUDGET - 1));
  });

  it('grants exactly one sponsorship when two requests race a budget of one', async () => {
    await redis.set(KEY(), 1, { ex: 600 });
    const v = await signVoucher();
    const results = await Promise.all([
      run(paymasterBody(mintCallData(v))),
      run(paymasterBody(mintCallData(v))),
    ]);
    const sponsored = results.filter((r) => r.body.result);
    const refused = results.filter((r) => r.body.error?.message?.match(/no voucher/i));
    expect(sponsored).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(shim.store.get(KEY())?.value).toBe('0');
    expect(upstream.requests).toHaveLength(1);
  });

  it('leaves nothing immortal when the voucher expires between check and spend', async () => {
    await redis.set(KEY(), 1, { ex: 600 });
    shim.before('decr', KEY(), () => shim.advance(601_000));
    const v = await signVoucher();
    const { body } = await run(paymasterBody(mintCallData(v)));
    // The DECR re-created the key at -1; the refusal path must expire it and
    // never sponsor against a lapsed authorization.
    expect(body.error?.message).toMatch(/no voucher/i);
    expect(upstream.requests).toHaveLength(0);
    const entry = shim.store.get(KEY());
    if (entry) expect(entry.expiresAt).not.toBeNull();
  });

  it('the stub call looks without spending', async () => {
    await seed();
    const v = await signVoucher();
    const { body } = await run(paymasterBody(mintCallData(v), 'pm_getPaymasterStubData'));
    expect(body.result).toBeTruthy();
    expect(shim.store.get(KEY())?.value).toBe(String(MINT_SPONSOR_BUDGET));
    expect(shim.commandCount('decr', 'mintbudget')).toBe(0);
  });

  it('the stub call still refuses an exhausted budget before the upstream is touched', async () => {
    await redis.set(KEY(), 0, { ex: 600 });
    const v = await signVoucher();
    const { body } = await run(paymasterBody(mintCallData(v), 'pm_getPaymasterStubData'));
    expect(body.error?.message).toMatch(/no voucher/i);
    expect(upstream.requests).toHaveLength(0);
  });

  it('refuses a GENUINE voucher whose deadline has passed, before any budget is touched', async () => {
    // A signature outlives its own budget key: after a re-issue recreates
    // the (fid, id) budget, an old genuine voucher would otherwise spend the
    // new budget on a guaranteed VoucherExpired revert (Bugbot, #321).
    await seed();
    const v = await signVoucher({ deadline: Math.floor(Date.now() / 1000) - 60 });
    const { body } = await run(paymasterBody(mintCallData(v)));
    expect(body.error?.message).toMatch(/expired voucher/i);
    expect(shim.commandCount('decr', 'mintbudget')).toBe(0);
    expect(upstream.requests).toHaveLength(0);
  });

  it('refuses a voucher the attestor never signed, before any budget is touched', async () => {
    await seed();
    const v = await signVoucher({ signer: '0x' + '77'.repeat(32) });
    const { body } = await run(paymasterBody(mintCallData(v)));
    expect(body.error?.message).toMatch(/invalid voucher/i);
    expect(shim.commandCount('get', 'mintbudget')).toBe(0);
    expect(shim.commandCount('decr', 'mintbudget')).toBe(0);
    expect(upstream.requests).toHaveLength(0);
  });

  it('a re-issued voucher cannot refill a drained budget — the NX bound', async () => {
    await seed();
    const v = await signVoucher();
    await run(paymasterBody(mintCallData(v)));
    await run(paymasterBody(mintCallData(v)));
    expect(shim.store.get(KEY())?.value).toBe('1');
    // What voucher.ts does on a re-request inside the TTL window:
    await redis.set(KEY(), MINT_SPONSOR_BUDGET, { nx: true, ex: 600 });
    expect(shim.store.get(KEY())?.value).toBe('1');
  });

  it('a pack purchase is sponsored with no voucher machinery at all', async () => {
    const buyPacks =
      '0x6a19e8b7' + coder.encode(['uint32', 'uint256'], [1, 34]).slice(2) + ERC_8021_SUFFIX;
    const callData = '0xb61d27f6' + coder.encode(['address', 'uint256', 'bytes'], [SALES, 0n, buyPacks]).slice(2);
    const { body } = await run(paymasterBody(callData));
    expect(body.result).toBeTruthy();
    expect(shim.commandCount('get', 'mintbudget')).toBe(0);
    expect(shim.commandCount('decr', 'mintbudget')).toBe(0);
  });
});

/**
 * Three commits, three defects, all in these rules and none caught by me.
 * These are the cases that would have caught each one.
 */

import { describe, it, expect } from 'vitest';
import { hasBudget, spendBudget, refundBudget, parseBudget, type BudgetStore } from './mint-sponsorship';

/**
 * A Redis that behaves like the real one in the ways that caused the bugs:
 * `incr` on a missing key creates it AT 1 WITH NO EXPIRY, and `ttl` reports -2
 * for missing and -1 for no expiry.
 */
function fakeRedis(initial: Record<string, { value: number; ttl: number }> = {}) {
  const store = new Map(Object.entries(initial));
  const api: BudgetStore & { peek: (k: string) => { value: number; ttl: number } | undefined } = {
    async get(key) {
      return store.get(key)?.value ?? null;
    },
    async ttl(key) {
      const e = store.get(key);
      return e ? e.ttl : -2;
    },
    async incr(key) {
      const e = store.get(key);
      if (!e) {
        // The behaviour that caused defect 3.
        store.set(key, { value: 1, ttl: -1 });
        return 1;
      }
      e.value += 1;
      return e.value;
    },
    async decr(key) {
      const e = store.get(key);
      if (!e) {
        store.set(key, { value: -1, ttl: -1 });
        return -1;
      }
      e.value -= 1;
      return e.value;
    },
    async expire(key, seconds) {
      const e = store.get(key);
      if (e) e.ttl = seconds;
      return 1;
    },
    peek: (k) => store.get(k),
  };
  return api;
}

const K = 'lhaw:mintauth:0xabc';

describe('a refund never resurrects an expired voucher', () => {
  it('leaves a lapsed voucher gone rather than recreating it', async () => {
    // Defect 3: a timeout in the last seconds of the ten-minute life. INCR on
    // the missing key would create a PERMANENT authorisation, and the mint it
    // authorises can only revert, because the deadline inside the signed
    // voucher has already passed.
    const redis = fakeRedis(); // key absent: it expired
    await refundBudget(redis, [K]);
    expect(redis.peek(K)).toBeUndefined();
  });

  it('never leaves a credited key without an expiry', async () => {
    // The race: TTL says the key is alive, it expires, then INCR recreates it.
    // Re-applying the expiry after every credit bounds even that case.
    const redis = fakeRedis({ [K]: { value: 1, ttl: -1 } });
    await refundBudget(redis, [K]);
    const after = redis.peek(K)!;
    expect(after.ttl).toBeGreaterThan(0);
  });

  it('preserves the remaining life of a live voucher, not a fresh ten minutes', async () => {
    const redis = fakeRedis({ [K]: { value: 2, ttl: 90 } });
    await refundBudget(redis, [K]);
    const after = redis.peek(K)!;
    expect(after.value).toBe(3);
    expect(after.ttl).toBe(90);
  });
});

describe('a spend is refunded when nothing was sponsored', () => {
  it('round-trips to where it started', async () => {
    // Defect 2: the spend happened before the upstream call, and an upstream
    // timeout left the voucher gone with an honest mint unable to retry.
    const redis = fakeRedis({ [K]: { value: 3, ttl: 600 } });
    await spendBudget(redis, [K]);
    expect(redis.peek(K)!.value).toBe(2);
    await refundBudget(redis, [K]);
    expect(redis.peek(K)!.value).toBe(3);
  });
});

describe('budget is what authorises, not mere existence', () => {
  it('refuses once the budget is spent', async () => {
    // Defect 1: reading the voucher and leaving it in place meant one issue
    // funded an unbounded run of sponsored reverts.
    const redis = fakeRedis({ [K]: { value: 1, ttl: 600 } });
    expect(await hasBudget(redis, [K])).toBe(true);
    await spendBudget(redis, [K]);
    expect(await hasBudget(redis, [K])).toBe(false);
  });

  it('refuses a voucher that was never issued', async () => {
    expect(await hasBudget(fakeRedis(), [K])).toBe(false);
  });

  it('refuses when any one voucher in a batch is exhausted', async () => {
    const other = 'lhaw:mintauth:0xdef';
    const redis = fakeRedis({
      [K]: { value: 3, ttl: 600 },
      [other]: { value: 0, ttl: 600 },
    });
    expect(await hasBudget(redis, [K, other])).toBe(false);
  });
});

describe('parseBudget', () => {
  it('reads what Upstash actually returns, number or string', () => {
    expect(parseBudget(3)).toBe(3);
    expect(parseBudget('3')).toBe(3);
  });

  it('treats anything unreadable as no budget, never as unlimited', () => {
    expect(parseBudget(null)).toBe(0);
    expect(parseBudget(undefined)).toBe(0);
    expect(parseBudget('nonsense')).toBe(0);
  });
});

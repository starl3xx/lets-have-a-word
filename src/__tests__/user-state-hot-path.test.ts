import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * /api/user-state hot-path costs (2026-08-30 first-load work).
 *
 * The endpoint runs for every app open and after every guess, and it was
 * paying for the same answers repeatedly inside one request: 1-2 uncached
 * Base RPC calls per poll for the connected wallet's tier, and three reads
 * of the same daily_guess_state row (its own, plus one inside each of
 * getOrGenerateWheelStartIndex and getGuessSourceState).
 */

const { mockTierChecked, cacheStore } = vi.hoisted(() => ({
  mockTierChecked: vi.fn(),
  cacheStore: new Map<string, unknown>(),
}));

// Redis is not configured under test, so cacheGet/cacheSet are no-ops and the
// caching logic would be invisible — the test would pass whether or not the
// cache was ever consulted. An in-memory stand-in makes the assertions real.
vi.mock('../lib/redis', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/redis')>();
  return {
    ...actual,
    cacheGet: async (key: string) => (cacheStore.has(key) ? cacheStore.get(key) : null),
    cacheSet: async (key: string, value: unknown) => {
      cacheStore.set(key, value);
    },
    cacheDel: async (key: string) => {
      cacheStore.delete(key);
    },
  };
});

vi.mock('../lib/word-token', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/word-token')>();
  return { ...actual, getWordBonusTierChecked: mockTierChecked };
});

import { db } from '../db';
import { dailyGuessState } from '../db/schema';
import { eq } from 'drizzle-orm';
import type { DailyGuessStateRow } from '../db/schema';
import {
  getWordBonusTierForConnectedWallet,
  getGuessSourceState,
  getOrGenerateWheelStartIndex,
  getTodayUTC,
} from '../lib/daily-limits';

const WALLET_A = '0x' + 'a'.repeat(40);
const WALLET_B = '0x' + 'b'.repeat(40);

describe('the connected-wallet tier cache', () => {
  beforeEach(() => {
    mockTierChecked.mockReset().mockResolvedValue({ tier: 2, determined: true });
    cacheStore.clear();
  });

  it('reads the chain once per wallet, then serves from cache', async () => {
    expect(await getWordBonusTierForConnectedWallet(WALLET_A)).toBe(2);
    expect(await getWordBonusTierForConnectedWallet(WALLET_A)).toBe(2);
    expect(await getWordBonusTierForConnectedWallet(WALLET_A)).toBe(2);
    expect(mockTierChecked).toHaveBeenCalledTimes(1);
  });

  it('does not let one wallet answer for another', async () => {
    // The fid-keyed tier cache answers for the STORED signer wallet; this
    // one answers for whatever is connected. Two wallets, two entries —
    // sharing would hand one wallet's bonus to the other.
    expect(await getWordBonusTierForConnectedWallet(WALLET_A)).toBe(2);
    mockTierChecked.mockResolvedValue({ tier: 3, determined: true });
    expect(await getWordBonusTierForConnectedWallet(WALLET_B)).toBe(3);
    expect(await getWordBonusTierForConnectedWallet(WALLET_A)).toBe(2); // still cached
    expect(mockTierChecked).toHaveBeenCalledTimes(2);
  });

  it('reports an outage as null and never caches it', async () => {
    // determined:false means "the chain could not be reached", not "holds
    // nothing". The caller falls back to the database value, and the next
    // call must ask the chain again — an outage cached as 0 would deny a
    // holder their bonus for the life of the entry.
    mockTierChecked.mockResolvedValueOnce({ tier: 0, determined: false });
    expect(await getWordBonusTierForConnectedWallet(WALLET_A)).toBeNull();

    mockTierChecked.mockResolvedValue({ tier: 3, determined: true });
    expect(await getWordBonusTierForConnectedWallet(WALLET_A)).toBe(3);
  });

  it('caches a genuine zero', async () => {
    // Non-holders are the common case; the cache must cover them or they
    // pay the RPC call this exists to remove.
    mockTierChecked.mockResolvedValue({ tier: 0, determined: true });
    expect(await getWordBonusTierForConnectedWallet(WALLET_A)).toBe(0);
    expect(await getWordBonusTierForConnectedWallet(WALLET_A)).toBe(0);
    expect(mockTierChecked).toHaveBeenCalledTimes(1);
  });

  it('answers 0 for a missing or malformed wallet with no chain read', async () => {
    expect(await getWordBonusTierForConnectedWallet(null)).toBe(0);
    expect(await getWordBonusTierForConnectedWallet('not-an-address')).toBe(0);
    expect(await getWordBonusTierForConnectedWallet('0x1234')).toBe(0);
    expect(mockTierChecked).toHaveBeenCalledTimes(0);
  });
});

describe('prefetched daily state', () => {
  // Deliberately an fid with no users row and no daily state: if either
  // function ignored the handed row and went to the database,
  // getOrCreateDailyState would try to CREATE state for it, and the
  // assertions below (no row exists afterwards) would catch it.
  const GHOST_FID = 43_999_999;

  const row = (overrides: Partial<DailyGuessStateRow>): DailyGuessStateRow =>
    ({
      id: 999_999,
      fid: GHOST_FID,
      date: getTodayUTC(),
      freeAllocatedBase: 3,
      freeAllocatedClankton: 2,
      freeAllocatedShareBonus: 1,
      freeUsed: 4,
      paidGuessCredits: 5,
      paidPacksPurchased: 1,
      packPurchaseRoundId: null,
      hasSharedToday: true,
      wheelStartIndex: 1234,
      wheelRoundId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }) as DailyGuessStateRow;

  beforeEach(async () => {
    await db.delete(dailyGuessState).where(eq(dailyGuessState.fid, GHOST_FID));
  });

  it('getGuessSourceState derives everything from the row it was handed', async () => {
    const state = await getGuessSourceState(GHOST_FID, row({}));

    // Consumption order free -> $WORD -> share over freeUsed=4:
    // base 3 used 3, word 2 used 1, share 1 used 0; paid credits 5.
    expect(state.free.remaining).toBe(0);
    expect(state.wordToken.remaining).toBe(1);
    expect(state.wordToken.isHolder).toBe(true);
    expect(state.share.remaining).toBe(1);
    expect(state.share.hasSharedToday).toBe(true);
    expect(state.paid.remaining).toBe(5);
    expect(state.totalRemaining).toBe(7);

    // The proof it never touched the database: no state was created for the
    // ghost fid, which the internal getOrCreateDailyState call would have done.
    const created = await db
      .select()
      .from(dailyGuessState)
      .where(eq(dailyGuessState.fid, GHOST_FID));
    expect(created.length).toBe(0);
  });

  it('getOrGenerateWheelStartIndex returns the handed row’s index without touching the database', async () => {
    const index = await getOrGenerateWheelStartIndex(GHOST_FID, undefined, 4437, row({}));
    expect(index).toBe(1234);

    const created = await db
      .select()
      .from(dailyGuessState)
      .where(eq(dailyGuessState.fid, GHOST_FID));
    expect(created.length).toBe(0);
  });
});

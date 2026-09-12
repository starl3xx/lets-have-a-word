import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

/**
 * Auto-start resilience (round 35+)
 *
 * The auto-start path ran in production for the first time on 2026-09-12 and
 * worked. These cover the ways a single unlucky invocation turns that into an
 * outage:
 *
 * 1. The START-SIDE WEDGE. WordJackpot.startRound mines but tx.wait() throws,
 *    so createRound cancels the row while the contract keeps activeRoundId set.
 *    Every later start then fails the contract's own preflight — and since the
 *    public round number IS rounds.id, retrying every 5 minutes burnt a round
 *    id per tick. createRound now refuses BEFORE the insert.
 *
 * 2. THE OTHER REFUSALS. activeRoundId is not the only way the seeding call
 *    says no. A stale oracle price, a seed outside the contract bounds and an
 *    empty tranche are all standing conditions, and each used to be discovered
 *    one line after the insert — so a 6-hour oracle outage advanced the public
 *    round number by 72 without a round being played.
 *
 * 3. The UNLOCKED check-then-act. It is not only reached by the cron:
 *    /api/guess and wheel.ts call ensureActiveRound too, and the admin Start
 *    Round button calls createRound directly, so the lock has to live in
 *    createRound for admin-vs-cron (the pair this game actually has) to be
 *    serialised at all.
 *
 * The Redis client is faked rather than required: the lock must behave
 * identically in CI, where Upstash is not configured.
 */

/** Fake Upstash client. `set` honours nx/ex the way the real one does. */
const mockRedisStore = new Map<string, string>();
let mockRedisAvailable = true;

const mockRedis = {
  async set(key: string, value: string, opts?: { nx?: boolean; ex?: number }) {
    if (opts?.nx && mockRedisStore.has(key)) return null;
    mockRedisStore.set(key, value);
    return 'OK';
  },
  async get(key: string) {
    return mockRedisStore.get(key) ?? null;
  },
  async del(key: string) {
    return mockRedisStore.delete(key) ? 1 : 0;
  },
};

vi.mock('../lib/redis', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/redis')>();
  return {
    ...actual,
    getRedisClient: () => (mockRedisAvailable ? mockRedis : null),
  };
});

/**
 * WordJackpot, stubbed. `mockOnchainActiveRoundId` is what the contract claims
 * to be holding; `mockStartWordRound` must never be called once the preflight
 * refuses, which is the whole point of the preflight.
 */
let mockOnchainActiveRoundId = 0;
const mockStartWordRound = vi.fn();

/**
 * The seeding preconditions, as the contract would report them. Round 35's
 * real numbers: $39.99 at 3.42e-7 per token is ~116.7M $WORD.
 */
const TOKEN = 10n ** 18n;
const healthyPrice = () => ({
  priceE18: 342000000000n,
  priceUsd: 3.42e-7,
  updatedAt: new Date(),
  maxPriceAgeSeconds: 3600,
  isStale: false,
});
let mockPrice = healthyPrice();
/** WordJackpot's pause flag. startRound is whenNotPaused; resolveRound is not. */
let mockPaused = false;
let mockSeedBounds = { minWei: 1_000_000n * TOKEN, maxWei: 1_000_000_000n * TOKEN };
let mockSolvency = {
  balanceWei: 6_000_000_000n * TOKEN,
  poolWei: 0n,
  carryWei: 0n,
  claimableWei: 0n,
  unallocatedWei: 6_000_000_000n * TOKEN,
};
const mockSyncWordPrice = vi.fn(async () => null as { txHash: string; priceE18: bigint; priceUsd: number } | null);

vi.mock('../lib/word-jackpot-contract', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/word-jackpot-contract')>();
  return {
    ...actual,
    isWordEconomyConfigured: () => true,
    getActiveWordRoundId: async () => mockOnchainActiveRoundId,
    startWordRoundOnChain: mockStartWordRound,
    // The reads the pre-insert preflight makes. Left real, they open an RPC
    // connection from a unit test; left out, the preflight cannot be tested at
    // all, which is how four of the five refusals stayed unguarded.
    getWordPriceOnChain: async () => mockPrice,
    getSeedBounds: async () => mockSeedBounds,
    getWordJackpotSolvency: async () => mockSolvency,
    syncWordPriceOnChain: mockSyncWordPrice,
    // rounds.ts reads only paused() off the contract handle. Stubbed to that
    // one method so the preflight never opens an RPC connection from a unit
    // test — the real getWordJackpotReadOnly also throws when
    // WORD_JACKPOT_ADDRESS is unset, which CI is.
    getWordJackpotReadOnly: () => ({ paused: async () => mockPaused }),
  };
});

// Round creation reads the bonus-words flag off JackpotManager before it does
// anything else. Stubbed so this file never opens an RPC connection.
vi.mock('../lib/jackpot-contract', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/jackpot-contract')>();
  return {
    ...actual,
    isBonusWordsEnabledOnChain: async () => false,
    isContractDeployed: async () => true,
  };
});

import { db, rounds } from '../db';
import { desc, eq, inArray } from 'drizzle-orm';
import { WORD_SEED_USD_CENTS } from '../../config/economy';

/**
 * rounds.ts is already in the module registry by the time this file's mocks
 * are registered — setup.ts reaches it through helpers/rounds.ts — and a
 * cached module is not re-mocked. Resetting the registry and importing it
 * again is what makes the three mocks above take effect.
 */
let lib: typeof import('../lib/rounds');

beforeAll(async () => {
  vi.resetModules();
  lib = await import('../lib/rounds');
});

describe('describeOnchainStartBlock', () => {
  it('clears the start when the contract holds no round', () => {
    expect(lib.describeOnchainStartBlock({ onchainActiveRoundId: 0, dbRow: null })).toBeNull();
  });

  it('blocks without alarm when the database agrees the round is live', () => {
    const reason = lib.describeOnchainStartBlock({
      onchainActiveRoundId: 35,
      dbRow: {
        id: 35,
        status: 'active',
        prizeCurrency: 'word',
        prizePoolWord: '116686114000000000000000000',
        seedPriceE18: '342000000000',
      },
    });

    expect(reason).toContain('Resolve it first');
    // A live round is the game working. It must not send an operator to the
    // recovery endpoint, which would clear a round people are playing.
    expect(reason).not.toContain('recover-stuck-round');
  });

  it('names the recovery endpoint when the contract holds a round the database cancelled', () => {
    const reason = lib.describeOnchainStartBlock({
      onchainActiveRoundId: 36,
      dbRow: {
        id: 36,
        status: 'cancelled',
        prizeCurrency: 'word',
        prizePoolWord: '0',
        seedPriceE18: null,
      },
    });

    expect(reason).toContain('recover-stuck-round');
    expect(reason).toContain('CLEAR_ONCHAIN_ROUND_36');
    // The currency discriminator survives into the diagnosis: an operator
    // reading "eth round" here would reach for the wrong contract entirely.
    expect(reason).toContain('word round');
  });

  it('treats a missing database row as the same wedge', () => {
    const reason = lib.describeOnchainStartBlock({ onchainActiveRoundId: 36, dbRow: null });

    expect(reason).toContain('no row at all');
    expect(reason).toContain('CLEAR_ONCHAIN_ROUND_36');
  });
});

describe('describeWordSeedBlock', () => {
  /** Round 35's real seed: $39.99 at 3.42e-7 per token. */
  const readiness = (over: Partial<import('../lib/rounds').WordSeedReadiness> = {}) => ({
    seedUsdCents: WORD_SEED_USD_CENTS,
    paused: false,
    priceE18: 342000000000n,
    priceIsStale: false,
    priceUpdatedAt: new Date('2026-09-12T17:00:00Z'),
    maxPriceAgeSeconds: 3600,
    priceSyncAttempted: false,
    seedTokensWei: 116686114000000000000000000n,
    minSeedWei: 1_000_000n * TOKEN,
    maxSeedWei: 1_000_000_000n * TOKEN,
    carryWei: 0n,
    unallocatedWei: 6_000_000_000n * TOKEN,
    ...over,
  });

  it('clears a start the contract would accept', () => {
    expect(lib.describeWordSeedBlock(readiness())).toBeNull();
  });

  it('blocks while the contract is paused', () => {
    // startRound is whenNotPaused (WordJackpot.sol:254). A pause lasts as long
    // as the incident behind it, so every 5-minute tick burnt a round id.
    const reason = lib.describeWordSeedBlock(readiness({ paused: true }));

    expect(reason).toContain('paused');
    expect(reason).toContain('Refusing to insert');
  });

  it('reports the pause ahead of a stale price, so the operator unpauses first', () => {
    // A paused contract usually also has a cold oracle. Naming the price would
    // send the operator to fix the symptom.
    const reason = lib.describeWordSeedBlock(
      readiness({ paused: true, priceIsStale: true, priceSyncAttempted: true })
    );

    expect(reason).toContain('paused');
    expect(reason).not.toContain('stale');
  });

  it('blocks on a price the oracle could not refresh', () => {
    const reason = lib.describeWordSeedBlock(
      readiness({ priceIsStale: true, priceSyncAttempted: true })
    );

    expect(reason).toContain('stale');
    // The point of moving this in front of the insert.
    expect(reason).toContain('Refusing to insert');
  });

  it('blocks when the seed prices outside the contract bounds', () => {
    // The oracle reporting a 1000x price move: the same $39.99 buys a seed
    // below the contract minimum.
    const reason = lib.describeWordSeedBlock(readiness({ seedTokensWei: 12n * TOKEN }));

    expect(reason).toContain('outside the contract bounds');
    expect(reason).toContain('Refusing to insert');
  });

  it('blocks when the tranche cannot cover the seed', () => {
    const reason = lib.describeWordSeedBlock(
      readiness({ carryWei: 6_000_000n * TOKEN, unallocatedWei: 1_000_000n * TOKEN })
    );

    expect(reason).toContain('unallocated');
    expect(reason).toContain('Fund WordJackpot');
  });

  it('spends the carry before the tranche, exactly as the contract does', () => {
    // Carry alone covers the seed, so an empty tranche is not a blocker.
    expect(
      lib.describeWordSeedBlock(
        readiness({ carryWei: 200_000_000n * TOKEN, unallocatedWei: 0n })
      )
    ).toBeNull();
  });

  it('blocks on a zero price instead of dividing by it', () => {
    // tokensForUsdCents throws on a zero price; this branch must be reached
    // without one having been priced.
    const reason = lib.describeWordSeedBlock(
      readiness({ priceE18: 0n, seedTokensWei: 0n, priceIsStale: true, priceSyncAttempted: true })
    );

    expect(reason).toContain('no $WORD price at all');
  });
});

describe('round-creation lock', () => {
  beforeEach(() => {
    mockRedisStore.clear();
    mockRedisAvailable = true;
  });

  it('admits one holder at a time', async () => {
    const first = await lib.acquireRoundCreationLock();
    expect(first).toBeTruthy();

    expect(await lib.acquireRoundCreationLock()).toBeNull();

    await lib.releaseRoundCreationLock(first!);
    expect(await lib.acquireRoundCreationLock()).toBeTruthy();
  });

  it('releases only its own token', async () => {
    const mine = await lib.acquireRoundCreationLock();
    // Someone else's lock, as it would look after ours expired and theirs was
    // taken. Releasing ours must not free theirs.
    mockRedisStore.set('lhaw:lock:create-round', 'someone-elses-token');

    await lib.releaseRoundCreationLock(mine!);

    expect(mockRedisStore.get('lhaw:lock:create-round')).toBe('someone-elses-token');
  });

  it('fails open when Redis is unavailable', async () => {
    mockRedisAvailable = false;

    // Both callers proceed, exactly as they did before the lock existed. A
    // lock that can block round creation outright is worse than the race.
    expect(await lib.acquireRoundCreationLock()).toBeTruthy();
    expect(await lib.acquireRoundCreationLock()).toBeTruthy();
    await expect(lib.releaseRoundCreationLock('no-redis')).resolves.toBeUndefined();
  });
});

describe('createRound refuses a wedged contract without burning a round id', () => {
  const createdIds: number[] = [];

  beforeEach(() => {
    mockStartWordRound.mockReset();
    mockSyncWordPrice.mockClear();
    mockOnchainActiveRoundId = 0;
    mockPrice = healthyPrice();
    mockPaused = false;
    mockSeedBounds = { minWei: 1_000_000n * TOKEN, maxWei: 1_000_000_000n * TOKEN };
    mockSolvency = {
      balanceWei: 6_000_000_000n * TOKEN,
      poolWei: 0n,
      carryWei: 0n,
      claimableWei: 0n,
      unallocatedWei: 6_000_000_000n * TOKEN,
    };
    // createRound takes the lock itself now, so a leftover holder from another
    // suite would refuse every creation in this one.
    mockRedisStore.clear();
    mockRedisAvailable = true;
  });

  afterEach(async () => {
    mockOnchainActiveRoundId = 0;
    delete process.env.WORD_JACKPOT_ADDRESS;
    delete process.env.WORD_PACK_SALES_ADDRESS;
    if (createdIds.length > 0) {
      await db.delete(rounds).where(inArray(rounds.id, createdIds));
      createdIds.length = 0;
    }
  });

  async function newestRoundId(): Promise<number> {
    const [row] = await db.select({ id: rounds.id }).from(rounds).orderBy(desc(rounds.id)).limit(1);
    return row?.id ?? 0;
  }

  it('throws and inserts nothing while WordJackpot holds a cancelled round', async () => {
    // The wedge as it actually occurs: the row exists, cancelled by the failed
    // seeding, and the contract never let go of the id.
    const [wedged] = await db
      .insert(rounds)
      .values({
        rulesetId: 1,
        answer: 'BRAIN',
        salt: 'a'.repeat(64),
        commitHash: 'c'.repeat(64),
        status: 'cancelled',
        prizeCurrency: 'word',
      })
      .returning({ id: rounds.id });
    createdIds.push(wedged.id);
    mockOnchainActiveRoundId = wedged.id;

    const highWaterMark = await newestRoundId();

    await expect(lib.createRound()).rejects.toThrow(/still holds round/);

    // The whole defect: a new row per 5-minute tick, each one burning a public
    // round number, none of which could ever be seeded.
    expect(await newestRoundId()).toBe(highWaterMark);
    expect(mockStartWordRound).not.toHaveBeenCalled();
  });

  it('still starts a round when the contract is free', async () => {
    // The false positive is the worse failure: a preflight that refuses when
    // WordJackpot is idle stops the game entirely. getWordJackpotConfig is the
    // real one, so the addresses have to be present for the success path.
    process.env.WORD_JACKPOT_ADDRESS = '0x1111111111111111111111111111111111111111';
    process.env.WORD_PACK_SALES_ADDRESS = '0x2222222222222222222222222222222222222222';

    const seedTokensWei = 116686114000000000000000000n; // round 35's seed, $39.99
    mockStartWordRound.mockImplementation(async (roundId: number) => ({
      txHash: `0x${'ab'.repeat(32)}`,
      roundId,
      seedTokensWei,
      seedUsdCents: WORD_SEED_USD_CENTS,
      priceE18: 342000000000n,
    }));

    // skipAnnounce for the reason the option exists (rounds.ts): the announcer
    // otherwise reads the live pool over RPC and writes an announcer_events row
    // for a round that only exists in this file.
    const round = await lib.createRound({ forceAnswer: 'brain', skipAnnounce: true });
    createdIds.push(round.id);

    expect(mockStartWordRound).toHaveBeenCalledWith(round.id, WORD_SEED_USD_CENTS, round.commitHash);
    // The returned Round carries the discriminator and the pool — the field
    // list that rebuilds it has dropped them four times.
    expect(round.prizeCurrency).toBe('word');
    expect(round.prizePoolWord).toBe(seedTokensWei.toString());
    expect(round.seedPriceE18).toBe('342000000000');

    const [row] = await db.select().from(rounds).where(eq(rounds.id, round.id)).limit(1);
    expect(row.status).toBe('active');
    expect(row.prizeCurrency).toBe('word');
  });

  it('inserts nothing when the oracle cannot refresh a stale price', async () => {
    // The 2026-08-11 DexScreener delisting, replayed: the onchain price ages
    // out and the sync has nothing to push. The refusal has to land before the
    // insert, or a 6-hour outage burns 72 public round numbers.
    mockPrice = { ...healthyPrice(), isStale: true };
    mockSyncWordPrice.mockResolvedValueOnce(null);

    const highWaterMark = await newestRoundId();

    await expect(lib.createRound()).rejects.toThrow(/price is stale/);

    // Synced once and only once — refusing without trying would strand every
    // start behind a manual step, because a stale price between rounds is
    // normal, not exceptional.
    expect(mockSyncWordPrice).toHaveBeenCalledTimes(1);
    expect(await newestRoundId()).toBe(highWaterMark);
    expect(mockStartWordRound).not.toHaveBeenCalled();
  });

  it('inserts nothing while WordJackpot is paused', async () => {
    // An owner pause during an incident. Every other precondition is healthy,
    // so this is the one door the preflight did not cover: startRound reverts
    // EnforcedPause and the row is cancelled, once per tick, for as long as
    // the pause lasts.
    mockPaused = true;

    const highWaterMark = await newestRoundId();

    await expect(lib.createRound()).rejects.toThrow(/paused/);

    expect(await newestRoundId()).toBe(highWaterMark);
    expect(mockStartWordRound).not.toHaveBeenCalled();
  });

  it('inserts nothing when the tranche cannot cover the seed', async () => {
    mockSolvency = { ...mockSolvency, carryWei: 0n, unallocatedWei: 1_000n * TOKEN };

    const highWaterMark = await newestRoundId();

    await expect(lib.createRound()).rejects.toThrow(/unallocated/);

    expect(await newestRoundId()).toBe(highWaterMark);
    expect(mockStartWordRound).not.toHaveBeenCalled();
  });

  it('refuses a second creation while another one holds the lock', async () => {
    // The admin-vs-cron pair. The admin Start Round endpoint calls createRound
    // directly, so a lock one level up (in ensureActiveRound) would not have
    // been taken by either the admin or, through it, this test.
    const heldByTheCron = await lib.acquireRoundCreationLock();
    expect(heldByTheCron).toBeTruthy();

    const highWaterMark = await newestRoundId();

    await expect(lib.createRound({ skipAnnounce: true })).rejects.toBeInstanceOf(
      lib.RoundCreationInFlightError
    );

    expect(await newestRoundId()).toBe(highWaterMark);
    expect(mockStartWordRound).not.toHaveBeenCalled();

    await lib.releaseRoundCreationLock(heldByTheCron!);
  });

  it('releases the lock after a refusal, so the next tick can still start a round', async () => {
    mockSolvency = { ...mockSolvency, carryWei: 0n, unallocatedWei: 1_000n * TOKEN };
    await expect(lib.createRound()).rejects.toThrow(/unallocated/);

    // A lock left held by a throwing creator would block auto-start for its
    // whole 180s TTL, turning one refusal into several missed ticks.
    const afterwards = await lib.acquireRoundCreationLock();
    expect(afterwards).toBeTruthy();
    await lib.releaseRoundCreationLock(afterwards!);
  });
});

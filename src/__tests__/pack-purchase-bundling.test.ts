import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db';
import { packPurchases, rounds } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { createTestRound } from './helpers/rounds';

/**
 * The database half of the bundling fix.
 *
 * An ERC-4337 bundler batches user operations from different accounts into one
 * transaction, so two players who buy packs at the same moment come back with
 * the SAME transaction hash and one PacksPurchased event each. Under the old
 * UNIQUE(tx_hash) the second was rejected as a duplicate after paying.
 *
 * These pin the constraint that replaced it. They are deliberately about the
 * schema rather than the endpoint: the guarantee has to hold in Postgres, not
 * only in the code path that happens to be reading today.
 */

const TX = '0x' + 'ab'.repeat(32);
const OTHER_TX = '0x' + 'cd'.repeat(32);

async function insertPurchase(
  roundId: number,
  fid: number,
  txHash: string,
  logIndex: number | null
) {
  return db.insert(packPurchases).values({
    roundId,
    fid,
    packCount: 1,
    totalPriceEth: '0.0004',
    totalPriceWei: '400000000000000',
    pricingPhase: 'BASE',
    totalGuessesAtPurchase: 0,
    txHash,
    logIndex,
  });
}

describe('pack purchase bundling', () => {
  let roundId: number;

  beforeEach(async () => {
    await db.delete(packPurchases).where(eq(packPurchases.txHash, TX));
    await db.delete(packPurchases).where(eq(packPurchases.txHash, OTHER_TX));
    const round = await createTestRound();
    roundId = round.id;
  });

  it('credits two players who shared one bundled transaction', async () => {
    // The bug this whole change exists for.
    await insertPurchase(roundId, 111, TX, 3);
    await insertPurchase(roundId, 222, TX, 7);

    const rows = await db
      .select()
      .from(packPurchases)
      .where(eq(packPurchases.txHash, TX));

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.fid).sort()).toEqual([111, 222]);
  });

  it('refuses to credit the same event twice', async () => {
    await insertPurchase(roundId, 111, TX, 3);

    // Same transaction, same event — a replay, whoever submits it.
    await expect(insertPurchase(roundId, 222, TX, 3)).rejects.toThrow();
  });

  it('refuses a second claim on a legacy row that has no log index', async () => {
    // Rows written before this change stand for the whole transaction. Postgres
    // treats NULLs as distinct, so without the partial unique index these would
    // both be allowed and the transaction would pay out twice.
    await insertPurchase(roundId, 111, TX, null);

    await expect(insertPurchase(roundId, 222, TX, null)).rejects.toThrow();
  });

  it('keeps transactions independent of each other', async () => {
    await insertPurchase(roundId, 111, TX, 3);
    await insertPurchase(roundId, 111, OTHER_TX, 3);

    const rows = await db.select().from(packPurchases).where(eq(packPurchases.fid, 111));
    const forOurTxs = rows.filter((r) => r.txHash === TX || r.txHash === OTHER_TX);
    expect(forOurTxs).toHaveLength(2);
  });

  it('lets one wallet buy twice inside a single bundle', async () => {
    // Same player, same transaction, two separate purchases — distinct events,
    // so both are creditable.
    await insertPurchase(roundId, 111, TX, 2);
    await insertPurchase(roundId, 111, TX, 5);

    const rows = await db
      .select()
      .from(packPurchases)
      .where(and(eq(packPurchases.txHash, TX), eq(packPurchases.fid, 111)));

    expect(rows).toHaveLength(2);
  });
});

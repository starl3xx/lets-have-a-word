/**
 * Round helpers for tests.
 *
 * Two problems these solve, both of which kept six test files un-runnable:
 *
 * 1. `createRound` requires a deployed contract — it calls `isContractDeployed()`
 *    and commits the answer hash onchain before inserting. In CI there is no
 *    contract, so every call threw "Smart contract is not deployed". The
 *    `skipOnChainCommitment` option exists precisely for this ("FOR TESTING
 *    ONLY" per rounds.ts) but no test used it.
 *
 * 2. `createRound` refuses to run while a round is active. Tests created rounds
 *    and never retired them, so the second call in a file failed with "Round N
 *    is still active" — and every subsequent one after that.
 */

import { createRound } from '../../lib/rounds';
import { db } from '../../db';
import { rounds } from '../../db/schema';
import { and, isNull, eq } from 'drizzle-orm';

type CreateRoundOptions = Parameters<typeof createRound>[0];

/**
 * Create a round without touching a contract.
 *
 * Prefer this over calling `createRound` directly in tests. The onchain
 * commitment is the one part of round creation that cannot work without a
 * deployed contract, and nothing under test depends on it having happened.
 */
export async function createTestRound(opts?: CreateRoundOptions) {
  return createRound({ ...opts, skipOnChainCommitment: true });
}

/**
 * Retire every active round.
 *
 * Call from afterEach. Marks rounds resolved rather than deleting them, because
 * guesses, payouts and daily state all carry foreign keys to `rounds` — a
 * delete would either cascade or fail, and neither is what a test wants.
 * `getActiveRound` filters on `status = 'active'` and a null `resolvedAt`, so
 * this is enough to let the next `createRound` proceed.
 */
export async function retireActiveRounds() {
  await db
    .update(rounds)
    .set({ status: 'resolved', resolvedAt: new Date() })
    .where(and(eq(rounds.status, 'active'), isNull(rounds.resolvedAt)));
}

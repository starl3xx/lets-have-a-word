/**
 * Global test setup, run before every test file (see vitest.config.ts).
 *
 * No unit test should be making real onchain calls. Without this, any test that
 * resolves a round reaches resolveRoundAndCreatePayouts, which reads the prize
 * pool from JackpotManagerV3 and throws "Failed to query contract jackpot"
 * when no contract is configured — which is most of what kept the round
 * lifecycle, wheel and archive suites failing.
 *
 * economics.ts already exposed this switch for exactly this purpose; nothing
 * had ever set it. With it on, payouts are computed and written to the database
 * as normal and only the onchain transaction is skipped, so the logic under
 * test is still the real logic.
 */

import { beforeAll, beforeEach } from 'vitest';
import { setSkipOnchainResolution } from '../lib/economics';
import { retireActiveRounds } from './helpers/rounds';

// The database guard and outbound silencing live in setup-guards.ts, which
// runs first and imports nothing from src/ — see the note there for why the
// ordering is load-bearing.

beforeAll(() => {
  setSkipOnchainResolution(true);
});

/**
 * Retire any round left active by an earlier test — including one left by a
 * different *file*.
 *
 * The whole suite shares one database and runs with --no-file-parallelism, so
 * a file that ends with an active round poisons the next file's first
 * `createRound`, which refuses to run while one is active. That is not a
 * hypothetical: daily-limits failed all 22 of its cases this way while passing
 * 16 of them when run alone, and the error it reported ("Round 389 is still
 * active") named a round it had never created.
 *
 * Hooks from setupFiles are outermost, so this runs before each file's own
 * beforeEach and cleans up before that file creates anything of its own.
 */
beforeEach(async () => {
  await retireActiveRounds();
});

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

/**
 * REFUSE TO RUN AGAINST A NON-TEST DATABASE.
 *
 * This suite is destructive by design: retireActiveRounds() below resolves
 * whatever round it finds before every single test, and the round-lifecycle,
 * wheel and archive files create and resolve rounds freely. It reads whatever
 * DATABASE_URL happens to be in the environment and has no idea which database
 * that is.
 *
 * On 2026-08-14 that was production. A single run created 90 rounds, and
 * because starting a round calls announceRoundStarted(), the announcer posted
 * 87 casts to Farcaster from the live bot account before it was stopped.
 * Nothing in the suite objected, because nothing was watching.
 *
 * Localhost is allowed because a developer database is disposable; a database
 * named *test* is allowed because CI's is (postgres://…/lhaw_test). A managed
 * remote host with a production name is not, and that is the whole point.
 */
function assertDisposableDatabase(): void {
  const raw = process.env.DATABASE_URL;
  if (!raw) return; // db/index.ts raises its own error; not this guard's job.

  if (process.env.LHAW_ALLOW_NONTEST_DB === 'yes-i-mean-it') {
    console.warn('[test-setup] non-test database override is active');
    return;
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('[test-setup] DATABASE_URL is not a valid URL — refusing to run.');
  }

  const host = url.hostname.toLowerCase();
  const database = url.pathname.replace(/^\//, '').toLowerCase();

  const isLocal = ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(host);
  const isNamedTest = /test/.test(database);

  if (isLocal || isNamedTest) return;

  throw new Error(
    [
      '',
      '  REFUSING TO RUN TESTS AGAINST THIS DATABASE.',
      '',
      `    host:     ${host}`,
      `    database: ${database}`,
      '',
      '  This suite deletes and creates rounds, and starting a round posts to',
      '  Farcaster. It may only run against a local database or one whose name',
      '  contains "test".',
      '',
      '  If you sourced .env.local to get DATABASE_URL, that is production.',
      '  Point DATABASE_URL at a scratch database instead.',
      '',
    ].join('\n')
  );
}

assertDisposableDatabase();

/**
 * Second layer: silence every outbound side channel regardless of what the
 * environment says.
 *
 * The database guard above is the real fix, but it only covers the database.
 * The announcer reads ANNOUNCER_ENABLED into a module-level const at import
 * time, so this has to happen at setup top level — before any test file pulls
 * announcer.ts in — rather than inside beforeAll.
 *
 * A test run must not be able to speak to the outside world even if someone
 * later adds a legitimate reason to point it at a remote database.
 */
process.env.ANNOUNCER_ENABLED = 'false';
process.env.TWITTER_ENABLED = 'false';
delete process.env.NEYNAR_SIGNER_UUID;

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

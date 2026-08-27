/**
 * Runs before setup.ts and before any module under test is imported.
 *
 * THIS FILE MUST NOT IMPORT ANYTHING FROM src/.
 *
 * That is the whole reason it exists. ES imports are evaluated before the
 * module body that follows them, so guards written at the top of setup.ts ran
 * *after* its own imports had already pulled in economics.ts and
 * helpers/rounds.ts — and both of those reach announcer.ts, which snapshots
 * ANNOUNCER_ENABLED into a module-level const at import time. Assigning the env
 * var afterwards changed nothing. Adding an import here would silently
 * reintroduce that.
 *
 * vitest.config.ts also sets these through `test.env`, which lands earlier
 * still. This file is the belt to that pair of braces, and carries the database
 * check, which has nowhere else to live.
 */

/**
 * REFUSE TO RUN AGAINST A NON-TEST DATABASE.
 *
 * This suite is destructive by design: retireActiveRounds() resolves whatever
 * round it finds before every single test, and the round-lifecycle, wheel and
 * archive files create and resolve rounds freely. It reads whatever
 * DATABASE_URL is in the environment and has no idea which database that is.
 *
 * On 2026-08-14 that was production, because .env.local was sourced to get a
 * connection string. One run created 90 rounds. That file also sets
 * NODE_ENV=production and ANNOUNCER_ENABLED=true, which defeated the
 * announcer's own "never post outside production" check — so starting each
 * round posted a cast, and 87 went out from the live bot account before it was
 * stopped. Every individual guard was reasonable; sourcing one file turned off
 * all of them at once.
 *
 * Localhost is allowed because a developer database is disposable, and a
 * database named *test* is allowed because CI's is (postgres://…/lhaw_test).
 * A managed remote host with a production name is not, and that is the point.
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
 * Silence every outbound side channel, whatever the environment says.
 *
 * NODE_ENV matters most: announcer.ts, twitter.ts and notifications.ts each
 * hard-stop unless it is exactly 'production', so restoring it to 'test'
 * re-arms guards those files already had.
 */
// Cast: @types/node types NODE_ENV as a readonly literal union, but the whole
// point here is to override whatever the shell exported.
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.ANNOUNCER_ENABLED = 'false';
process.env.TWITTER_ENABLED = 'false';

/**
 * Third layer: remove the credentials the two irreversible channels need, so a
 * post cannot land even if every flag above is somehow wrong.
 *
 * This is not belt-and-braces pedantry. While verifying the flag guards were
 * load-bearing — by removing them and re-running — a test called
 * `castFromAnnouncer` and **posted a real cast**. The
 * `vi.mock('../lib/farcaster')` in that test looked like protection and was
 * not: setup.ts had already pulled announcer.ts into the module graph via
 * economics.ts, so it held the real client. The same ordering trap that
 * produced the original bug, one layer up.
 *
 * A cast can be deleted. A broadcast push notification cannot — sendNotification
 * sends `target_fids: []`, meaning every user with notifications enabled. So a
 * feature flag is not allowed to be the only thing standing in front of either.
 *
 * NEYNAR_SIGNER_UUID is what publishCast signs with; NEYNAR_APP_UUID is what
 * the notification broadcast requires. NEYNAR_API_KEY is deliberately left
 * alone, because `isDevelopment` in /api/guess keys off its absence and
 * clearing it would silently change which auth path the handler tests take.
 *
 * ASSIGNED EMPTY, NOT DELETED. `delete` leaves the key *missing*, and missing
 * is exactly what `dotenv.config()` refills — it never overwrites a key that is
 * already present, but it will happily supply one that is not. farcaster.ts
 * calls it at import time and setup.ts reaches it via economics.ts →
 * announcer.ts, so a deleted credential came back before announcer.ts and
 * notifications.ts snapshotted it. An empty string is present, so dotenv leaves
 * it alone, and every consumer treats it as falsy either way.
 *
 * Latent in this repo, which has .env.local rather than the .env that
 * dotenv.config() reads by default — which is the reason to fix it now rather
 * than after someone adds one.
 */
process.env.NEYNAR_SIGNER_UUID = '';
process.env.NEYNAR_APP_UUID = '';
// Base App push, added 2026-08-27. Same reasoning as the two above and the same
// treatment: a broadcast to every wallet that pinned the app cannot be recalled,
// so the feature flag is not allowed to be the only thing in front of it.
// ASSIGNED EMPTY rather than deleted, for the dotenv.config() reason documented
// above — a missing key is exactly what it refills.
process.env.BASE_NOTIFICATIONS_API_KEY = '';

// Basename resolution, added 2026-08-27. Not a safety guard like the three
// above — nothing is broadcast — but a SPEED and DETERMINISM one: sign-in now
// resolves a player's basename onchain, and several suites create wallet
// players, so an unguarded run would fire a real Base RPC call per created row.
// That is slow, flaky, and rate-limited (429s observed while developing this).
// The resolver returns its normal "no basename" answer when disabled, which is
// the same shape a real address with no reverse record produces.
process.env.BASENAME_RESOLUTION_DISABLED = 'true';

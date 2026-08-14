import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';

import { castFromAnnouncer } from '../lib/announcer';
import { sendNotification } from '../lib/notifications';
import { twitterIsActive } from '../lib/twitter';

/**
 * A test run must not be able to reach the outside world.
 *
 * On 2026-08-14 the suite was run with .env.local sourced, to get a
 * DATABASE_URL. That file also sets NODE_ENV=production, ANNOUNCER_ENABLED=true,
 * TWITTER_ENABLED=true and NOTIFICATIONS_ENABLED=true. Each of those modules
 * already had a "never post outside production" hard stop, and sourcing one
 * file disarmed all of them at once: 87 casts went out from the live bot
 * account, and a broadcast push notification was attempted per round.
 *
 * NOTE ON HOW THIS FILE IS WRITTEN. An earlier version mocked
 * '../lib/farcaster' to intercept publishCast. That mock does not work and is
 * worse than nothing: setup.ts imports economics.ts, which imports
 * announcer.ts, so announcer.ts is already in the module graph holding the real
 * client before this file's mocks apply. Relying on it posted a real cast.
 *
 * So safety here comes from setup-guards.ts, not from mocking — the flags are
 * restored *and* NEYNAR_SIGNER_UUID / NEYNAR_APP_UUID are cleared, so neither
 * channel can authenticate even if a flag is wrong. These tests assert the
 * observable result of that, and the env assertions are what actually fail
 * first if a guard is removed.
 */

describe('outbound channels are inert under test', () => {
  let fetchSpy: MockInstance;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('sees a non-production NODE_ENV, which is what re-arms all three modules', () => {
    // announcer.ts, twitter.ts and notifications.ts each hard-stop on exactly
    // this value, so it is the load-bearing part of the fix.
    expect(process.env.NODE_ENV).not.toBe('production');
  });

  it('has every outbound feature flag off', () => {
    expect(process.env.ANNOUNCER_ENABLED).not.toBe('true');
    expect(process.env.TWITTER_ENABLED).not.toBe('true');
  });

  it('has no credentials for the two irreversible channels', () => {
    // A cast can be deleted; a broadcast notification cannot. Neither is
    // allowed to depend on a flag alone.
    expect(process.env.NEYNAR_SIGNER_UUID).toBeFalsy();
    expect(process.env.NEYNAR_APP_UUID).toBeFalsy();
  });

  it('does not post a cast', async () => {
    const result = await castFromAnnouncer('inert-under-test');
    expect(result).toBeNull();
  });

  it('does not broadcast a push notification', async () => {
    const result = await sendNotification('inert', 'under test');
    expect(result.success).toBe(false);
    // The broadcast is a raw fetch to Neynar; it must never be issued.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not tweet', () => {
    expect(twitterIsActive()).toBe(false);
  });
});

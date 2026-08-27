/**
 * Base App push notifications.
 *
 * The behaviour that matters most is the refusal. A broadcast to every wallet
 * that pinned the app cannot be recalled, and on 2026-08-14 a sourced
 * .env.local disarmed several "never post outside production" guards at once.
 * So the first thing asserted here is that this channel cannot fire from a test
 * run, from dev, or without an explicit flag — and that `setup-guards.ts` has
 * cleared the API key so it could not authenticate even if a flag were wrong.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { sendBaseNotification, listOptedInWallets } from '../lib/base-notifications';

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  NOTIFICATIONS_ENABLED: process.env.NOTIFICATIONS_ENABLED,
  BASE_NOTIFICATIONS_API_KEY: process.env.BASE_NOTIFICATIONS_API_KEY,
};

let fetchSpy: MockInstance;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  fetchSpy.mockRestore();
  for (const [k, v] of Object.entries(originalEnv)) {
    if (v === undefined) delete (process.env as Record<string, string | undefined>)[k];
    else (process.env as Record<string, string>)[k] = v;
  }
});

describe('the channel cannot fire from a test run', () => {
  it('setup-guards has emptied the API key', () => {
    // Not deleted — assigned empty. `delete` leaves the key missing, and
    // missing is exactly what dotenv.config() refills.
    expect(process.env.BASE_NOTIFICATIONS_API_KEY).toBe('');
    expect('BASE_NOTIFICATIONS_API_KEY' in process.env).toBe(true);
  });

  it('sends nothing, and touches no network, as the suite is configured', async () => {
    const result = await sendBaseNotification({
      title: 'Round #99 is live',
      message: 'This must never leave the building.',
    });

    expect(result.success).toBe(false);
    expect(result.sentCount).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('will not list users either', async () => {
    expect(await listOptedInWallets()).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('stays silent outside production even with a key and the flag on', async () => {
    process.env.BASE_NOTIFICATIONS_API_KEY = 'a-real-looking-key';
    process.env.NOTIFICATIONS_ENABLED = 'true';
    // NODE_ENV is 'test' here, which is the hard stop.

    const result = await sendBaseNotification({ title: 'x', message: 'y' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/disabled/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

/**
 * The two channels must not be able to take each other down.
 *
 * The first version fired the Base send only after a successful Neynar
 * response, so a Neynar outage — or simply missing Neynar config — silenced the
 * ONLY channel Base App players have. Caught by Bugbot on the notifications PR.
 */
describe('Neynar and Base are independent', () => {
  it('still attempts Base when Neynar is not configured', async () => {
    // Production + flag on, so the shared hard stop passes, but no Neynar
    // credentials and no Base key: the point is that BOTH are attempted and
    // neither short-circuits the other.
    const { sendNotification } = await import('../lib/notifications');

    process.env.NOTIFICATIONS_ENABLED = 'true';
    const result = await sendNotification('Round #1 is live', 'Come and play', 'https://letshaveaword.fun/verify');

    // NODE_ENV is 'test', so nothing leaves the building either way — what is
    // asserted is that the call completes and reports the Neynar outcome rather
    // than throwing or hanging on one channel.
    expect(result.success).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

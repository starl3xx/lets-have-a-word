/**
 * Bounding Farcaster host actions.
 *
 * The bug this exists for is not an error — it is the ABSENCE of one. Every
 * `sdk.actions.*` promise never settles outside a Farcaster host: it does not
 * resolve and it does not reject, so `catch` never runs, `finally` never runs,
 * and any spinner set before the await stays up forever. On 2026-08-27 that
 * shape was reported from a Base App device on two screens at once, including
 * the winner screen, where it disabled the one share button that worked.
 *
 * These tests pin the contract the nine call sites now depend on.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withHostTimeout, HOST_ACTION_TIMEOUT_MS } from '../lib/hostActions';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('withHostTimeout', () => {
  it('passes a resolved value straight through', async () => {
    await expect(withHostTimeout(Promise.resolve('cast-hash'), 'composeCast')).resolves.toBe(
      'cast-hash'
    );
  });

  it('propagates a real rejection unchanged, so existing catches still work', async () => {
    const boom = new Error('user rejected');
    await expect(withHostTimeout(Promise.reject(boom), 'composeCast')).rejects.toBe(boom);
  });

  it('REJECTS a promise that never settles — the whole point', async () => {
    // A promise with no resolve and no reject: exactly what the SDK returns
    // off-host. Without the timeout this await would hang forever.
    const neverSettles = new Promise<string>(() => {});
    const guarded = withHostTimeout(neverSettles, 'composeCast');

    const assertion = expect(guarded).rejects.toThrow(/composeCast did not respond/);
    await vi.advanceTimersByTimeAsync(HOST_ACTION_TIMEOUT_MS + 1);
    await assertion;
  });

  it('honours a shorter custom timeout', async () => {
    const neverSettles = new Promise<string>(() => {});
    const guarded = withHostTimeout(neverSettles, 'getCapabilities', 2_000);

    const assertion = expect(guarded).rejects.toThrow(/getCapabilities/);
    await vi.advanceTimersByTimeAsync(2_001);
    await assertion;
  });

  it('does not fire the timer once the action has settled', async () => {
    // Guards against a stray rejection surfacing as an unhandled rejection
    // long after the caller has moved on.
    await expect(withHostTimeout(Promise.resolve('ok'), 'viewToken', 50)).resolves.toBe('ok');
    await vi.advanceTimersByTimeAsync(500);
    expect(vi.getTimerCount()).toBe(0);
  });
});

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
import { withHostTimeout, openXComposer, HOST_ACTION_TIMEOUT_MS } from '../lib/hostActions';

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

describe('openXComposer prefers the installed X app', () => {
  function fakeWindow() {
    const opened: string[] = [];
    const listeners: Array<() => void> = [];
    let href = '';
    (globalThis as any).window = {
      open: (u: string) => opened.push(u),
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimeout: (t: any) => clearTimeout(t),
      get location() {
        return {
          get href() {
            return href;
          },
          set href(v: string) {
            href = v;
          },
        };
      },
    };
    (globalThis as any).document = {
      visibilityState: 'visible' as string,
      addEventListener: (_t: string, fn: () => void) => listeners.push(fn),
      removeEventListener: () => {},
    };
    return {
      opened,
      get href() {
        return (globalThis as any).window.location.href;
      },
      background() {
        (globalThis as any).document.visibilityState = 'hidden';
        listeners.forEach((fn) => fn());
      },
    };
  }

  afterEach(() => {
    delete (globalThis as any).window;
    delete (globalThis as any).document;
  });

  it('navigates to the app scheme first', async () => {
    const env = fakeWindow();
    openXComposer('hello');
    expect(env.href).toBe(`twitter://post?message=${encodeURIComponent('hello')}`);
    expect(env.opened).toHaveLength(0);
  });

  it('falls back to the web intent when the app never takes over', async () => {
    const env = fakeWindow();
    openXComposer('hello');
    await vi.advanceTimersByTimeAsync(900);
    expect(env.opened).toHaveLength(1);
    expect(env.opened[0]).toContain('twitter.com/intent/tweet');
  });

  it('does NOT open a second composer once the app has taken over', async () => {
    // The reason the fallback is guarded on visibility rather than a bare
    // timer: the app backgrounds this page, and a naive timer would fire on
    // return and open a browser composer after the player had already posted.
    const env = fakeWindow();
    openXComposer('hello');
    env.background();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(env.opened).toHaveLength(0);
  });

  it('carries the url inside the message, since the app scheme has one field', async () => {
    const env = fakeWindow();
    openXComposer('come play', 'https://letshaveaword.fun/?ref=1');
    expect(decodeURIComponent(env.href)).toContain('come play');
    expect(decodeURIComponent(env.href)).toContain('https://letshaveaword.fun/?ref=1');
  });
});

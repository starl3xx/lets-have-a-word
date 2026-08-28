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

describe('openXComposer', () => {
  function fakeEnv() {
    const opened: Array<[string, string]> = [];
    const clicked: string[] = [];
    const el = {
      _src: '',
      style: {} as Record<string, string>,
      set src(v: string) {
        this._src = v;
        clicked.push(v);
      },
      get src() {
        return this._src;
      },
      remove() {},
    };
    (globalThis as any).window = {
      open: (u: string, target: string) => opened.push([u, target]),
      setTimeout: () => 0,
    };
    (globalThis as any).document = {
      createElement: () => el,
      body: { appendChild: () => {}, removeChild: () => {} },
    };
    return { opened, clicked };
  }

  afterEach(() => {
    delete (globalThis as any).window;
    delete (globalThis as any).document;
  });

  it('attempts the installed app first, inside a frame', () => {
    // A frame cannot navigate the top document, so an unhandled scheme can
    // never replace the game with an error page — the failure an anchor or a
    // location assignment both risk (Bugbot, PR #294).
    const { clicked } = fakeEnv();
    openXComposer('hello');
    expect(clicked).toHaveLength(1);
    expect(clicked[0]).toContain('twitter://post?message=');
  });

  it('ALWAYS opens the web tab as well, so the share can never do nothing', () => {
    // A delayed fallback is outside the click gesture and popup blockers
    // swallow it silently — which turned the share into a dead button.
    const { opened } = fakeEnv();
    openXComposer('hello');
    expect(opened).toHaveLength(1);
    expect(opened[0][0]).toContain('https://x.com/intent/tweet?');
  });

  it('uses x.com, not twitter.com, which costs a redirect hop', () => {
    const { opened } = fakeEnv();
    openXComposer('hello');
    expect(opened[0][0]).not.toContain('twitter.com/intent');
  });

  it('still opens the web tab when the host refuses the scheme', () => {
    const { opened } = fakeEnv();
    (globalThis as any).document.createElement = () => {
      throw new Error('scheme refused');
    };
    openXComposer('hello');
    expect(opened).toHaveLength(1);
  });

  it('passes the url as its own parameter for the web card', () => {
    const { opened } = fakeEnv();
    openXComposer('come play', 'https://letshaveaword.fun/?ref=1');
    const u = new URL(opened[0][0]);
    expect(u.searchParams.get('text')).toBe('come play');
    expect(u.searchParams.get('url')).toBe('https://letshaveaword.fun/?ref=1');
  });
});

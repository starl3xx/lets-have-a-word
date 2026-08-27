/**
 * Stale-runtime detection and self-reload.
 *
 * The incident this guards: Base App resumed a page from memory a full deploy
 * after it was built (2026-08-27), so the player re-tested a fixed bug against
 * the old code. The rules pinned here:
 *
 *  - a mismatch discovered just after arriving reloads immediately (the
 *    resumed-stale-page case — the reload is invisible to the player);
 *  - a mismatch discovered mid-session waits for the tab to hide;
 *  - one reload attempt per server sha, remembered in sessionStorage, so a
 *    webview that serves stale HTML even after reload cannot loop;
 *  - storage that throws disables reloading entirely rather than risk a loop;
 *  - 'dev' on either side disables the check.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const CLIENT_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const NEWER_SHA = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

type VisibilityListener = () => void;

function makeEnvironment(opts: { storageThrows?: boolean; seedStore?: Record<string, string> } = {}) {
  const reload = vi.fn();
  const store = new Map<string, string>(Object.entries(opts.seedStore ?? {}));
  const listeners: VisibilityListener[] = [];

  const sessionStorage = opts.storageThrows
    ? {
        getItem() {
          throw new Error('storage disabled');
        },
        setItem() {
          throw new Error('storage disabled');
        },
      }
    : {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => void store.set(k, v),
      };

  (globalThis as any).window = { location: { reload }, sessionStorage };
  (globalThis as any).document = {
    visibilityState: 'visible' as string,
    addEventListener: (type: string, fn: VisibilityListener) => {
      if (type === 'visibilitychange') listeners.push(fn);
    },
  };

  const setVisibility = (state: 'visible' | 'hidden') => {
    (globalThis as any).document.visibilityState = state;
    listeners.forEach((fn) => fn());
  };

  return { reload, setVisibility };
}

/** Import a fresh copy AFTER the fake window/document exist. */
async function freshModule() {
  vi.resetModules();
  return await import('../lib/buildFreshness');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-27T12:00:00Z'));
  process.env.NEXT_PUBLIC_BUILD_SHA = CLIENT_SHA;
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.NEXT_PUBLIC_BUILD_SHA;
  delete (globalThis as any).window;
  delete (globalThis as any).document;
});

describe('matching builds', () => {
  it('does nothing when client and server agree', async () => {
    const { reload } = makeEnvironment();
    const mod = await freshModule();
    mod.noteServerBuildSha(CLIENT_SHA);
    expect(mod.isRuntimeStale()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('the resumed-stale-page case', () => {
  it('reloads immediately when the mismatch is found just after arriving', async () => {
    const { reload } = makeEnvironment();
    const mod = await freshModule();
    // First poll lands 5s after the page came (back) to life.
    vi.advanceTimersByTime(5_000);
    mod.noteServerBuildSha(NEWER_SHA);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('retries while its own navigation has not committed — the frozen-webview case', async () => {
    // Base App can freeze the page between the sessionStorage write and the
    // navigation actually happening. If the heap is still alive, the reload
    // provably never committed, so the attempt must not count as spent.
    // (In this test env reload() never navigates, which simulates exactly
    // that: same heap, guard written, page still running.)
    const { reload } = makeEnvironment();
    const mod = await freshModule();
    mod.noteServerBuildSha(NEWER_SHA);
    mod.noteServerBuildSha(NEWER_SHA);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('a fresh heap that finds the guard set refuses — the loop guard', async () => {
    // A committed reload that STILL served stale HTML arrives in a new heap
    // with the guard already in sessionStorage. Reloading again would loop.
    const { reload } = makeEnvironment({
      seedStore: { 'lhaw.reloadedForBuild': NEWER_SHA },
    });
    const mod = await freshModule();
    mod.noteServerBuildSha(NEWER_SHA);
    expect(reload).not.toHaveBeenCalled();
    expect(mod.reloadIfStale()).toBe(false);
  });
});

describe('the mid-session deploy case', () => {
  it('does not yank a page the player has been looking at — waits for hidden', async () => {
    const { reload, setVisibility } = makeEnvironment();
    const mod = await freshModule();

    // A poll keeps the visibility listener installed from the start.
    mod.noteServerBuildSha(CLIENT_SHA);

    // Ten minutes into the session, a deploy lands.
    vi.advanceTimersByTime(10 * 60_000);
    mod.noteServerBuildSha(NEWER_SHA);
    expect(reload).not.toHaveBeenCalled();
    expect(mod.isRuntimeStale()).toBe(true);

    // The player backgrounds the app: reload out of sight.
    setVisibility('hidden');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a resume resets the just-arrived window', async () => {
    const { reload, setVisibility } = makeEnvironment();
    const mod = await freshModule();
    mod.noteServerBuildSha(CLIENT_SHA);

    // Long session, then background and resume much later.
    vi.advanceTimersByTime(60 * 60_000);
    setVisibility('hidden');
    vi.advanceTimersByTime(60 * 60_000);
    setVisibility('visible');

    // First poll after the resume finds the mismatch: reload immediately.
    vi.advanceTimersByTime(5_000);
    mod.noteServerBuildSha(NEWER_SHA);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('reloadIfStale — the player is already stuck', () => {
  it('reloads on demand when stale, and same-heap retries stay allowed', async () => {
    const { reload } = makeEnvironment();
    const mod = await freshModule();
    mod.noteServerBuildSha(CLIENT_SHA);
    vi.advanceTimersByTime(10 * 60_000);
    mod.noteServerBuildSha(NEWER_SHA); // mid-session: no auto reload
    expect(reload).not.toHaveBeenCalled();

    expect(mod.reloadIfStale()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);

    // The heap survived the reload call, so the navigation never committed —
    // a second explicit request retries rather than finding the attempt spent.
    expect(mod.reloadIfStale()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('is a no-op when nothing is stale', async () => {
    const { reload } = makeEnvironment();
    const mod = await freshModule();
    mod.noteServerBuildSha(CLIENT_SHA);
    expect(mod.reloadIfStale()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('holds — critical flows defer automatic reloads', () => {
  it('a hold blocks the hidden-time reload; release re-enables the next one', async () => {
    const { reload, setVisibility } = makeEnvironment();
    const mod = await freshModule();
    mod.noteServerBuildSha(CLIENT_SHA);
    vi.advanceTimersByTime(10 * 60_000);
    mod.noteServerBuildSha(NEWER_SHA); // mid-session: waiting for hidden

    const release = mod.holdReloads();
    setVisibility('hidden'); // a purchase is in flight: must not reload
    expect(reload).not.toHaveBeenCalled();

    setVisibility('visible');
    release();
    vi.advanceTimersByTime(60_000); // past the just-arrived window
    setVisibility('hidden');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a hold blocks the just-arrived immediate reload too', async () => {
    const { reload } = makeEnvironment();
    const mod = await freshModule();
    const release = mod.holdReloads();
    vi.advanceTimersByTime(5_000);
    mod.noteServerBuildSha(NEWER_SHA);
    expect(reload).not.toHaveBeenCalled();
    expect(mod.isRuntimeStale()).toBe(true); // the flag survives the hold
    release();
  });

  it('releasing twice does not corrupt the hold count', async () => {
    const { reload, setVisibility } = makeEnvironment();
    const mod = await freshModule();
    mod.noteServerBuildSha(CLIENT_SHA);
    vi.advanceTimersByTime(10 * 60_000);
    mod.noteServerBuildSha(NEWER_SHA);

    const releaseA = mod.holdReloads();
    const releaseB = mod.holdReloads();
    releaseA();
    releaseA(); // double release must not cancel B's hold
    setVisibility('hidden');
    expect(reload).not.toHaveBeenCalled();
    releaseB();
  });

  it('reloadIfStale ignores holds — the failed request already proved the point', async () => {
    const { reload } = makeEnvironment();
    const mod = await freshModule();
    mod.noteServerBuildSha(CLIENT_SHA);
    vi.advanceTimersByTime(10 * 60_000);
    mod.noteServerBuildSha(NEWER_SHA);
    mod.holdReloads();
    expect(mod.reloadIfStale()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('safety rails', () => {
  it("never reloads when the check is disabled by 'dev' on either side", async () => {
    const { reload } = makeEnvironment();
    process.env.NEXT_PUBLIC_BUILD_SHA = 'dev';
    let mod = await freshModule();
    mod.noteServerBuildSha(NEWER_SHA);
    expect(reload).not.toHaveBeenCalled();

    process.env.NEXT_PUBLIC_BUILD_SHA = CLIENT_SHA;
    mod = await freshModule();
    mod.noteServerBuildSha('dev');
    expect(reload).not.toHaveBeenCalled();
    expect(mod.isRuntimeStale()).toBe(false);
  });

  it('refuses to reload at all when storage throws — it cannot rule out a loop', async () => {
    const { reload } = makeEnvironment({ storageThrows: true });
    const mod = await freshModule();
    mod.noteServerBuildSha(NEWER_SHA);
    expect(reload).not.toHaveBeenCalled();
    expect(mod.reloadIfStale()).toBe(false);
  });
});

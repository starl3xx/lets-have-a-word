/**
 * Client-side custody of the wallet session token.
 *
 * The rule worth pinning is when the token is DISCARDED. An earlier version
 * dropped it on any non-ok response from /api/auth/me, so a 500, a 503, a 429
 * or a dropped connection destroyed a valid 30-day session and cost the player
 * a fresh wallet signature to recover from someone else's transient fault.
 * Caught by Bugbot on PR #282.
 *
 * Only a definitive 401 means the token is dead. Everything else leaves it
 * alone and lets the next real request be the arbiter.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getStoredPlayerSession,
  setStoredPlayerSession,
  clearStoredPlayerSession,
  playerSessionHeaders,
} from '../lib/playerSessionClient';
import { PLAYER_SESSION_HEADER } from '../lib/playerSession';

/** Minimal localStorage, since these tests run in a node environment. */
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

beforeEach(() => {
  (globalThis as any).window = { localStorage: new MemoryStorage() };
  clearStoredPlayerSession();
});

describe('round-trip', () => {
  it('stores and returns the token with its fid', () => {
    setStoredPlayerSession({ token: 'tok-abc', fid: 1_000_000_050 });
    expect(getStoredPlayerSession()).toEqual({ token: 'tok-abc', fid: 1_000_000_050 });
  });

  it('presents the token as a header', () => {
    setStoredPlayerSession({ token: 'tok-abc', fid: 1_000_000_050 });
    expect(playerSessionHeaders()).toEqual({ [PLAYER_SESSION_HEADER]: 'tok-abc' });
  });

  it('sends nothing when there is no session — the Farcaster player case', () => {
    expect(playerSessionHeaders()).toEqual({});
  });

  it('carries the client build id when the page knows it', () => {
    // A stale Base App webview resumed the previous deploy's bundle on
    // 2026-08-27 and nothing server-side could tell. The build header makes
    // the client version part of every authenticated request.
    (globalThis as any).window.__NEXT_DATA__ = { buildId: 'build-test123' };
    setStoredPlayerSession({ token: 'tok-abc', fid: 1_000_000_050 });
    expect(playerSessionHeaders()).toEqual({
      'x-lhaw-build': 'build-test123',
      [PLAYER_SESSION_HEADER]: 'tok-abc',
    });
  });

  it('clears on request', () => {
    setStoredPlayerSession({ token: 'tok-abc', fid: 1 });
    clearStoredPlayerSession();
    expect(getStoredPlayerSession()).toBeNull();
    expect(playerSessionHeaders()).toEqual({});
  });
});

describe('the fid is stored so a transient fault cannot cost a signature', () => {
  it('survives a reload without asking the server who we are', async () => {
    setStoredPlayerSession({ token: 'tok-xyz', fid: 1_000_000_051 });
    const persisted = (globalThis as any).window.localStorage;

    // A reload is a FRESH MODULE over the same storage. Replacing `window`
    // alone does not simulate it: the module-level in-memory mirror survives,
    // and getStoredPlayerSession returns that before it ever reads
    // localStorage — so the first version of this test passed even with
    // persistence completely broken. vi.resetModules() is what actually drops
    // the mirror. (Caught by Bugbot on PR #282.)
    vi.resetModules();
    (globalThis as any).window = { localStorage: persisted };
    const fresh = await import('../lib/playerSessionClient');

    const restored = fresh.getStoredPlayerSession();
    expect(restored?.fid).toBe(1_000_000_051);
    expect(restored?.token).toBe('tok-xyz');
  });

  it('reports no session after a reload when nothing was persisted', async () => {
    // The other half: proves the case above is reading storage rather than a
    // leftover mirror.
    vi.resetModules();
    (globalThis as any).window = { localStorage: new MemoryStorage() };
    const fresh = await import('../lib/playerSessionClient');

    expect(fresh.getStoredPlayerSession()).toBeNull();
  });
});

describe('bad storage is treated as absent, never as a crash', () => {
  it('ignores unparseable contents', () => {
    (globalThis as any).window.localStorage.setItem('lhaw.playerSession', 'not json');
    expect(getStoredPlayerSession()).toBeNull();
  });

  it('ignores a record missing its fid', () => {
    (globalThis as any).window.localStorage.setItem(
      'lhaw.playerSession',
      JSON.stringify({ token: 'tok-only' })
    );
    expect(getStoredPlayerSession()).toBeNull();
  });

  it('survives storage that throws, as a locked-down webview would', () => {
    (globalThis as any).window = {
      localStorage: {
        getItem() {
          throw new Error('storage disabled');
        },
        setItem() {
          throw new Error('storage disabled');
        },
        removeItem() {
          throw new Error('storage disabled');
        },
      },
    };

    // Must not throw. The in-memory copy still carries the visit.
    expect(() => setStoredPlayerSession({ token: 'tok-mem', fid: 7 })).not.toThrow();
    expect(getStoredPlayerSession()).toEqual({ token: 'tok-mem', fid: 7 });
  });
});

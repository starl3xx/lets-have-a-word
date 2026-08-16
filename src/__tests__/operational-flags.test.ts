/**
 * Operational flag read-path regression tests
 *
 * The Upstash SDK auto-JSON.parses values on read, so a flag stored with
 * redis.set(key, 'true') comes back as BOOLEAN true. Until 2026-08-16 the
 * reads compared against the STRING 'true', which never matched — the kill
 * switch and dead day were silently no-ops in production. These tests drive
 * the real read functions through a mocked client that returns exactly what
 * the SDK returns.
 *
 * Mock wiring: setup.ts pulls the real module graph in before a static
 * vi.mock can bind (the ordering trap documented in setup-guards.ts), so
 * this file uses resetModules + doMock + dynamic import instead.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const redisGet = vi.fn();

async function loadOperational() {
  vi.resetModules();
  vi.doMock('../lib/redis', () => ({
    getRedisClient: () => ({ get: redisGet }),
    CACHE_PREFIX: 'lhaw:',
  }));
  return import('../lib/operational');
}

beforeEach(() => {
  redisGet.mockReset();
});

describe('flag reads accept the SDK boolean shape', () => {
  it('isDeadDayEnabled: boolean true (what the SDK actually returns)', async () => {
    const ops = await loadOperational();
    redisGet.mockResolvedValue(true);
    expect(await ops.isDeadDayEnabled()).toBe(true);
  });

  it('isDeadDayEnabled: string true (defensive, pre-parse shape)', async () => {
    const ops = await loadOperational();
    redisGet.mockResolvedValue('true');
    expect(await ops.isDeadDayEnabled()).toBe(true);
  });

  it('isDeadDayEnabled: off shapes stay off', async () => {
    const ops = await loadOperational();
    for (const v of [null, undefined, false, 'false', 0, '']) {
      redisGet.mockResolvedValue(v);
      expect(await ops.isDeadDayEnabled()).toBe(false);
    }
  });

  it('isKillSwitchEnabled: boolean true', async () => {
    const ops = await loadOperational();
    redisGet.mockResolvedValue(true);
    expect(await ops.isKillSwitchEnabled()).toBe(true);
  });

  it('getDeadDayState.enabled: boolean true', async () => {
    const ops = await loadOperational();
    redisGet.mockResolvedValue(true);
    const state = await ops.getDeadDayState();
    expect(state.enabled).toBe(true);
  });

  it('getKillSwitchState.enabled: boolean true', async () => {
    const ops = await loadOperational();
    redisGet.mockResolvedValue(true);
    const state = await ops.getKillSwitchState();
    expect(state.enabled).toBe(true);
  });
});

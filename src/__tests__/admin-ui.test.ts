/**
 * Admin UI shared vocabulary — pure helper tests (Phase 0)
 */

import { describe, it, expect } from 'vitest';
import { worstSeverity, isStale, formatStampTime } from '../../components/admin/ui';

describe('worstSeverity', () => {
  it('rolls a mixed strip up to the worst child', () => {
    expect(worstSeverity(['ok', 'watch', 'ok'])).toBe('watch');
    expect(worstSeverity(['ok', 'watch', 'alert'])).toBe('alert');
    expect(worstSeverity(['info', 'ok'])).toBe('info');
  });

  it('is ok when everything is ok, and for an empty strip', () => {
    expect(worstSeverity(['ok', 'ok'])).toBe('ok');
    expect(worstSeverity([])).toBe('ok');
  });
});

describe('isStale', () => {
  const now = 1_800_000_000_000;

  it('fresh inside the threshold, stale past it', () => {
    expect(isStale(now - 60_000, now, 5 * 60 * 1000)).toBe(false);
    expect(isStale(now - 6 * 60 * 1000, now, 5 * 60 * 1000)).toBe(true);
  });

  it('an unparseable timestamp reads as stale, never as fresh', () => {
    expect(isStale('garbage', now)).toBe(true);
  });
});

describe('formatStampTime', () => {
  it('renders Central wall time for valid input and null for garbage', () => {
    // 2026-08-16 is CDT (UTC-5): 14:32:05Z is 09:32:05 CT.
    expect(formatStampTime('2026-08-16T14:32:05.000Z')).toBe('09:32:05');
    expect(formatStampTime('garbage')).toBeNull();
  });

  it('follows the DST offset, not a fixed one', () => {
    // Same wall clock in UTC, six months apart: CST (UTC-6) in January.
    expect(formatStampTime('2026-01-16T14:32:05.000Z')).toBe('08:32:05');
  });

  it('is the same string whatever zone the machine sits in', () => {
    // The old implementation sliced the UTC wall clock out of an ISO string,
    // which was zone-proof by accident; a locale render is only zone-proof if
    // timeZone is pinned. Tokyo and Honolulu straddle Central in both
    // directions and cross the date line relative to it.
    const instant = '2026-08-16T14:32:05.000Z';
    const original = process.env.TZ;
    try {
      for (const tz of ['UTC', 'Asia/Tokyo', 'Pacific/Honolulu', 'America/Chicago']) {
        process.env.TZ = tz;
        expect(formatStampTime(instant)).toBe('09:32:05');
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it('renders midnight as 00:00:00, never 24:00:00', () => {
    // en-US + hour12:false emits "24:00:00" on some ICU builds; en-GB does not.
    expect(formatStampTime('2026-08-16T05:00:00.000Z')).toBe('00:00:00');
  });
});

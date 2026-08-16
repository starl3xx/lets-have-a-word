/**
 * Admin UI shared vocabulary — pure helper tests (Phase 0)
 */

import { describe, it, expect } from 'vitest';
import { worstSeverity, isStale } from '../../components/admin/ui';

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

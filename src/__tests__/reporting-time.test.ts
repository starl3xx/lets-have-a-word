/**
 * Central-time reporting.
 *
 * These pin the two silent failures behind the 2026-08-18 "admin says 1 pack,
 * the game says 6" report: a naive UTC timestamp parsed as local time, and a
 * fixed offset that is wrong for half the year.
 */

import { describe, it, expect } from 'vitest';
import {
  formatCentral,
  formatCentralDate,
  formatCentralTime,
} from '../../components/admin/format';

describe('Central-time formatting', () => {
  describe('naive timestamps are UTC, not local', () => {
    it('reads a bare Postgres timestamp as UTC', () => {
      // The real row behind the report: pack_purchases id 1065, stored naive
      // UTC. Central is CDT (-5) in August, so this is 07:11 in the morning.
      expect(formatCentral('2026-08-18 12:11:09.541124')).toBe('Aug 18, 2026, 7:11 AM CT');
    });

    it('agrees with the same instant written as ISO with a Z', () => {
      expect(formatCentral('2026-08-18T12:11:09.541Z')).toBe(
        formatCentral('2026-08-18 12:11:09.541')
      );
    });

    it('respects an explicit offset when the string carries one', () => {
      // 17:11+05:00 is 12:11 UTC is 07:11 Central — same instant as above.
      expect(formatCentral('2026-08-18T17:11:09.541+05:00')).toBe('Aug 18, 2026, 7:11 AM CT');
    });

    it('crosses the date line when UTC is past midnight but Central is not', () => {
      // The other purchase: 23:00 UTC on the 17th is 18:00 Central, still the
      // 17th. Bucketing this as the 18th is exactly the reported bug.
      expect(formatCentralDate('2026-08-17 23:00:23.085395')).toBe('Aug 17, 2026');
    });

    it('puts an early-morning UTC timestamp on the previous Central day', () => {
      expect(formatCentralDate('2026-08-18 04:30:00')).toBe('Aug 17, 2026');
    });
  });

  describe('daylight saving is observed, not assumed', () => {
    it('uses CDT (-5) in summer', () => {
      expect(formatCentralTime('2026-07-01 18:00:00')).toBe('1:00 PM CT');
    });

    it('uses CST (-6) in winter', () => {
      // Same clock time in UTC, one hour earlier in Central. A hardcoded -5
      // offset would render 1:00 PM here and be wrong for half the year.
      expect(formatCentralTime('2026-01-01 18:00:00')).toBe('12:00 PM CT');
    });
  });

  describe('input handling', () => {
    it('accepts a Date', () => {
      expect(formatCentral(new Date('2026-08-18T12:11:09.541Z'))).toBe(
        'Aug 18, 2026, 7:11 AM CT'
      );
    });

    it('accepts an epoch milliseconds number', () => {
      expect(formatCentral(Date.parse('2026-08-18T12:11:09.541Z'))).toBe(
        'Aug 18, 2026, 7:11 AM CT'
      );
    });

    it('renders a dash rather than "Invalid Date" for empty input', () => {
      expect(formatCentral(null)).toBe('—');
      expect(formatCentral(undefined)).toBe('—');
      expect(formatCentral('')).toBe('—');
      expect(formatCentralDate('not a date')).toBe('—');
    });
  });
});

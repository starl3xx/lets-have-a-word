/**
 * Shared admin formatters (Phase D3): every section carried private copies of
 * these; four implementations of "shorten an address" is three too many.
 */

export function formatEth(value: number | string, decimals = 4): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0';
  return num.toFixed(decimals);
}

export function formatNumber(value: number): string {
  return value.toLocaleString();
}

export function shortenAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/**
 * Every timestamp the admin reads is rendered in US Central, labelled CT, so a
 * date on screen always means the same thing as a day bucket in a query.
 *
 * Two traps live in here, both silent:
 *
 * 1. `toLocaleString()` with no `timeZone` renders in the VIEWER'S zone. That
 *    looked correct only because the person reading it sits in Central; it
 *    would disagree with the server's buckets from anywhere else.
 * 2. Naive timestamps arrive as strings with no zone marker
 *    (`2026-08-18 12:11:09.541124`), and `new Date()` reads those as LOCAL
 *    time. Almost every column in this schema is naive UTC, so a bare parse
 *    shifts them by the viewer's offset. `toDate` pins them to UTC first.
 */
const REPORTING_TZ = 'America/Chicago';

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const fromEpoch = new Date(value);
    return isNaN(fromEpoch.getTime()) ? null : fromEpoch;
  }
  const raw = value.trim();
  if (!raw) return null;
  // A trailing Z or ±HH:MM means the string already carries its zone.
  const hasZone = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(raw);
  const parsed = new Date(hasZone ? raw : `${raw.replace(' ', 'T')}Z`);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/** Date and time in Central, e.g. "Aug 18, 2026, 7:11 AM CT". */
export function formatCentral(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '—';
  return `${date.toLocaleString('en-US', {
    timeZone: REPORTING_TZ,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })} CT`;
}

/** Date only in Central, e.g. "Aug 18, 2026". */
export function formatCentralDate(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '—';
  return date.toLocaleString('en-US', {
    timeZone: REPORTING_TZ,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Time only in Central, e.g. "7:11 AM CT" — for rows already grouped by day. */
export function formatCentralTime(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '—';
  return `${date.toLocaleString('en-US', {
    timeZone: REPORTING_TZ,
    hour: 'numeric',
    minute: '2-digit',
  })} CT`;
}

/** B/M/K compact token counts for admin tables (one decimal). */
export function formatTokenCompact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return formatNumber(n);
}

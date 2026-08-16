/**
 * Admin UI primitives — the ONE shared vocabulary for admin sections
 *
 * Phase 0 of the admin redesign (see the 2026-08-16 research report): eight
 * section files each carried a private `styles = {}` copy of the same ideas,
 * and the drift between them is why the panel reads slowly. New admin code
 * imports from here; old sections migrate opportunistically.
 *
 * The evidence-based rules baked in (Carbon, NN/g, GOV.UK, Grafana, WCAG):
 * - Status is never color alone: every StatusPill pairs color + icon + word,
 *   and reads correctly in grayscale (WCAG 1.4.1).
 * - Rollups show the worst child: worstSeverity() exists so a strip of
 *   subsystem states collapses to one honest verdict.
 * - Red means "act now"; watch states are amber; quiet states say so in
 *   words ("All clear"), because an empty region is indistinguishable from
 *   a broken data feed.
 * - Numbers use tabular numerals; numeric table cells right-align.
 * - Data gets a timestamp, and a stale timestamp LOOKS stale.
 */

import React, { useEffect, useState } from 'react';

export const adminFont =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
export const adminMono = "ui-monospace, SFMono-Regular, Menlo, monospace";

// ---------------------------------------------------------------------------
// Severity — the one scale every admin status maps onto
// ---------------------------------------------------------------------------

export type Severity = 'ok' | 'info' | 'watch' | 'alert';

const SEVERITY_RANK: Record<Severity, number> = { ok: 0, info: 1, watch: 2, alert: 3 };

/** Roll several subsystem severities up to the one the header must show. */
export function worstSeverity(severities: Severity[]): Severity {
  return severities.reduce<Severity>(
    (worst, s) => (SEVERITY_RANK[s] > SEVERITY_RANK[worst] ? s : worst),
    'ok'
  );
}

const SEVERITY_STYLE: Record<Severity, { bg: string; fg: string; icon: string }> = {
  ok: { bg: 'rgba(34, 197, 94, 0.12)', fg: '#166534', icon: '✓' },
  info: { bg: 'rgba(59, 130, 246, 0.12)', fg: '#1e40af', icon: '●' },
  watch: { bg: 'rgba(245, 158, 11, 0.14)', fg: '#92400e', icon: '▲' },
  alert: { bg: 'rgba(239, 68, 68, 0.12)', fg: '#b91c1c', icon: '■' },
};

/**
 * Color + icon + word, always all three. The word carries the meaning; the
 * icon shape survives grayscale; the color is reinforcement.
 */
export function StatusPill({
  severity,
  children,
  title,
}: {
  severity: Severity;
  children: React.ReactNode;
  title?: string;
}) {
  const s = SEVERITY_STYLE[severity];
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '3px 10px',
        borderRadius: '999px',
        fontSize: '12px',
        fontWeight: 600,
        background: s.bg,
        color: s.fg,
        whiteSpace: 'nowrap',
        fontFamily: adminFont,
      }}
    >
      <span aria-hidden="true">{s.icon}</span>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Layout: Module (section card) and StatCard
// ---------------------------------------------------------------------------

/** Section card. `aside` renders right of the title — a pill or a stamp. */
export function Module({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: 'white',
        borderRadius: '12px',
        border: '1px solid #e5e7eb',
        padding: '24px',
        marginBottom: '24px',
        fontFamily: adminFont,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '8px',
          marginBottom: '16px',
        }}
      >
        <h3
          style={{
            fontSize: '15px',
            fontWeight: 600,
            color: '#111827',
            margin: 0,
            letterSpacing: '-0.01em',
          }}
        >
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </div>
  );
}

/**
 * One stat-card anatomy everywhere: value (largest) → label → context.
 * Abbreviate on cards; keep precision in tables.
 */
export function StatCard({
  label,
  value,
  subtext,
  loading,
}: {
  label: string;
  value: React.ReactNode;
  subtext?: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <div
      style={{
        padding: '16px',
        background: '#f9fafb',
        borderRadius: '8px',
        border: '1px solid #f3f4f6',
        fontFamily: adminFont,
      }}
    >
      <div
        style={{
          fontSize: '12px',
          color: '#6b7280',
          fontWeight: 500,
          marginBottom: '4px',
          textTransform: 'uppercase',
          letterSpacing: '0.03em',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: '22px',
          fontWeight: 600,
          color: '#111827',
          letterSpacing: '-0.02em',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {loading ? '…' : value}
      </div>
      {subtext && (
        <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>{subtext}</div>
      )}
    </div>
  );
}

/** Responsive grid the StatCards sit in. */
export const statGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
  gap: '12px',
};

// ---------------------------------------------------------------------------
// UpdatedStamp — data has a timestamp, stale data looks stale
// ---------------------------------------------------------------------------

const STALE_AFTER_MS_DEFAULT = 5 * 60 * 1000;

/** Exported for tests: is this timestamp stale relative to now? */
export function isStale(
  updatedAt: Date | string | number,
  now: number,
  staleAfterMs: number = STALE_AFTER_MS_DEFAULT
): boolean {
  const t = new Date(updatedAt).getTime();
  if (!Number.isFinite(t)) return true;
  return now - t > staleAfterMs;
}

/** Exported for tests: "14:32:05" UTC wall time, or null if unparseable. */
export function formatStampTime(updatedAt: Date | string | number): string | null {
  const t = new Date(updatedAt).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().slice(11, 19);
}

/** "updated 14:32:05 UTC" — turns amber past the staleness threshold. */
export function UpdatedStamp({
  updatedAt,
  staleAfterMs = STALE_AFTER_MS_DEFAULT,
}: {
  updatedAt: Date | string | number | null;
  staleAfterMs?: number;
}) {
  // Re-evaluate staleness on a slow tick: the whole point of the stamp is
  // that stale data LOOKS stale, even when nothing else re-renders.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  if (!updatedAt) return null;
  const stale = isStale(updatedAt, now, staleAfterMs);
  // An unparseable timestamp reads as stale (isStale already said so) and
  // must not crash the panel — toISOString throws on an Invalid Date.
  const time = formatStampTime(updatedAt);
  return (
    <span
      style={{
        fontSize: '12px',
        fontFamily: adminFont,
        fontVariantNumeric: 'tabular-nums',
        color: stale ? '#92400e' : '#9ca3af',
        background: stale ? 'rgba(245, 158, 11, 0.14)' : 'transparent',
        borderRadius: '4px',
        padding: stale ? '1px 6px' : '0',
        whiteSpace: 'nowrap',
      }}
    >
      {stale ? '⚠ stale — updated ' : 'updated '}
      {time ?? 'unknown time'}
      {time ? ' UTC' : ''}
    </span>
  );
}

// ---------------------------------------------------------------------------
// AlertBanner — page-level conditions. One per page, used sparingly.
// ---------------------------------------------------------------------------

const ALERT_STYLE = {
  error: { bg: '#fef2f2', fg: '#dc2626', border: '#fecaca', icon: '■' },
  warning: { bg: '#fffbeb', fg: '#b45309', border: '#fde68a', icon: '▲' },
  success: { bg: '#f0fdf4', fg: '#15803d', border: '#bbf7d0', icon: '✓' },
  info: { bg: '#eff6ff', fg: '#2563eb', border: '#bfdbfe', icon: '●' },
} as const;

export function AlertBanner({
  kind,
  children,
}: {
  kind: keyof typeof ALERT_STYLE;
  children: React.ReactNode;
}) {
  const s = ALERT_STYLE[kind];
  return (
    <div
      role={kind === 'error' ? 'alert' : undefined}
      style={{
        padding: '12px 16px',
        borderRadius: '8px',
        marginBottom: '16px',
        fontSize: '14px',
        background: s.bg,
        color: s.fg,
        border: `1px solid ${s.border}`,
        fontFamily: adminFont,
      }}
    >
      <span aria-hidden="true" style={{ marginRight: '8px' }}>
        {s.icon}
      </span>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tables — text left, numbers right in tabular numerals, sticky-ready
// ---------------------------------------------------------------------------

export const tableStyles = {
  wrap: { overflowX: 'auto' } as React.CSSProperties,
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '12px',
    fontFamily: adminFont,
  } as React.CSSProperties,
  th: {
    textAlign: 'left',
    padding: '6px 8px',
    color: '#6b7280',
    fontWeight: 500,
    borderBottom: '1px solid #e5e7eb',
    whiteSpace: 'nowrap',
  } as React.CSSProperties,
  thNum: {
    textAlign: 'right',
    padding: '6px 8px',
    color: '#6b7280',
    fontWeight: 500,
    borderBottom: '1px solid #e5e7eb',
    whiteSpace: 'nowrap',
  } as React.CSSProperties,
  td: {
    padding: '6px 8px',
    color: '#111827',
    borderBottom: '1px solid #f3f4f6',
  } as React.CSSProperties,
  tdNum: {
    padding: '6px 8px',
    color: '#111827',
    borderBottom: '1px solid #f3f4f6',
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
  } as React.CSSProperties,
  tdMono: {
    padding: '6px 8px',
    color: '#111827',
    borderBottom: '1px solid #f3f4f6',
    fontFamily: adminMono,
    fontSize: '11px',
  } as React.CSSProperties,
};

/** Label/value pair used by the Operations info cards. */
export function InfoRow({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '8px 0',
        borderBottom: '1px solid #f3f4f6',
        fontSize: '14px',
        fontFamily: adminFont,
      }}
    >
      <span style={{ color: '#6b7280' }}>{label}</span>
      <span style={{ color: '#111827', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </span>
    </div>
  );
}

/** The quiet state says so — never leave a healthy region blank. */
export function AllClear({ children = 'All clear' }: { children?: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: '13px',
        color: '#166534',
        fontFamily: adminFont,
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
      }}
    >
      <span aria-hidden="true">✓</span>
      {children}
    </div>
  );
}

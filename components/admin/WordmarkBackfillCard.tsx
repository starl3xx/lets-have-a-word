/**
 * Round 34 Wordmarks Backfill — one-time launch tool.
 *
 * Front-end for /api/admin/operational/round34-wordmarks-backfill: grants
 * Early Adopter 💅 (first guess in rounds 1–18) and Trailblazer 🚩 (the
 * rounds 1–33 first guessers). Dry run first; Execute unlocks only after a
 * dry run has shown the counts. Idempotent, and the marks stay hidden from
 * players until the first $WORD round exists.
 *
 * Expiry: delete this card and its endpoint once the backfill has run and
 * round 34 is live (per the "Before You Write New Code" ladder in CLAUDE.md).
 */

import React, { useState } from 'react';
import { adminFont as fontFamily } from './ui';

interface MarkCounts {
  cutoffRound?: number;
  eligible?: number;
  toInsert?: number;
  inserted?: number;
}

interface BackfillResponse {
  dryRun: boolean;
  earlyAdopter: MarkCounts;
  trailblazer: MarkCounts;
}

const styles = {
  card: {
    background: 'white',
    borderRadius: '12px',
    border: '1px solid #e5e7eb',
    padding: '24px',
    marginBottom: '16px',
  },
  cardTitle: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#111827',
    margin: '0 0 8px 0',
    fontFamily,
  },
  cardSubtitle: {
    fontSize: '13px',
    color: '#6b7280',
    margin: '0 0 16px 0',
    lineHeight: 1.5,
    fontFamily,
  },
  buttonRow: {
    display: 'flex',
    gap: '12px',
    marginBottom: '16px',
  },
  btnSecondary: {
    padding: '10px 20px',
    background: 'white',
    color: '#374151',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily,
  },
  btnPrimary: {
    padding: '10px 20px',
    background: '#7c3aed',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily,
  },
  btnDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  resultBox: (kind: 'info' | 'success' | 'error') => ({
    padding: '12px 16px',
    borderRadius: '8px',
    background: kind === 'error' ? '#fef2f2' : kind === 'success' ? '#f0fdf4' : '#eff6ff',
    border: `1px solid ${kind === 'error' ? '#fecaca' : kind === 'success' ? '#bbf7d0' : '#bfdbfe'}`,
    color: kind === 'error' ? '#991b1b' : kind === 'success' ? '#166534' : '#1e40af',
    fontSize: '13px',
    lineHeight: 1.6,
    fontFamily,
  }),
};

export default function WordmarkBackfillCard({ fid }: { fid: number }) {
  const [busy, setBusy] = useState<'dry' | 'run' | null>(null);
  const [dryResult, setDryResult] = useState<BackfillResponse | null>(null);
  const [runResult, setRunResult] = useState<BackfillResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const call = async (dryRun: boolean) => {
    setBusy(dryRun ? 'dry' : 'run');
    setError(null);
    if (dryRun) setRunResult(null);
    try {
      const res = await fetch(`/api/admin/operational/round34-wordmarks-backfill?devFid=${fid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dryRun ? {} : { dryRun: false }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Backfill request failed');
      } else if (dryRun) {
        setDryResult(data);
      } else {
        setRunResult(data);
      }
    } catch {
      setError('Backfill request failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={styles.card}>
      <h2 style={styles.cardTitle}>Round 34 Wordmarks Backfill</h2>
      <p style={styles.cardSubtitle}>
        One-time launch tool: grants <strong>Early Adopter 💅</strong> (first guess in rounds
        1–18, before the first botted round) and <strong>Trailblazer 🚩</strong> (the rounds
        1–33 first guessers). Safe to run any time before launch — the marks stay hidden until
        the first $WORD round starts — and safe to re-run. Delete this card and its endpoint
        after launch.
      </p>

      <div style={styles.buttonRow}>
        <button
          style={{ ...styles.btnSecondary, ...(busy ? styles.btnDisabled : {}) }}
          disabled={busy !== null}
          onClick={() => call(true)}
        >
          {busy === 'dry' ? 'Checking…' : 'Dry Run'}
        </button>
        <button
          style={{ ...styles.btnPrimary, ...(busy || !dryResult ? styles.btnDisabled : {}) }}
          disabled={busy !== null || !dryResult}
          title={dryResult ? undefined : 'Run a dry run first'}
          onClick={() => call(false)}
        >
          {busy === 'run' ? 'Granting…' : 'Run Backfill'}
        </button>
      </div>

      {error && <div style={styles.resultBox('error')}>{error}</div>}

      {!error && runResult && (
        <div style={styles.resultBox('success')}>
          <strong>Backfill complete.</strong><br />
          Early Adopter 💅: {runResult.earlyAdopter.inserted} granted (cutoff round {runResult.earlyAdopter.cutoffRound})<br />
          Trailblazer 🚩: {runResult.trailblazer.inserted} granted
        </div>
      )}

      {!error && !runResult && dryResult && (
        <div style={styles.resultBox('info')}>
          <strong>Dry run</strong> — nothing written yet.<br />
          Early Adopter 💅: {dryResult.earlyAdopter.eligible} eligible, {dryResult.earlyAdopter.toInsert} to grant (cutoff round {dryResult.earlyAdopter.cutoffRound})<br />
          Trailblazer 🚩: {dryResult.trailblazer.eligible} eligible, {dryResult.trailblazer.toInsert} to grant
        </div>
      )}
    </div>
  );
}

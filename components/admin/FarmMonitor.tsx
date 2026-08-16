/**
 * Farm Monitor — admin Analytics module
 *
 * Surfaces /api/admin/operational/farm-monitor: the farm signature for a
 * round (new-guesser cohort, username shapes, reward-gate claim wallets and
 * their $WORD funders). Loads the latest round on mount; any round is
 * checkable for backtesting. Funding enrichment is opt-in because it walks
 * Blockscout one wallet at a time.
 */

import { useCallback, useEffect, useState } from 'react';

const fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

const VERDICT_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  quiet: { bg: 'rgba(34, 197, 94, 0.12)', fg: '#166534', label: 'Quiet' },
  watch: { bg: 'rgba(245, 158, 11, 0.14)', fg: '#92400e', label: 'Watch' },
  'farm-signature': { bg: 'rgba(239, 68, 68, 0.12)', fg: '#b91c1c', label: 'Farm signature' },
};

interface FarmMonitorProps {
  fid: number;
}

export default function FarmMonitor({ fid }: FarmMonitorProps) {
  const [roundInput, setRoundInput] = useState('');
  const [enrich, setEnrich] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<any>(null);

  const run = useCallback(
    async (opts?: { roundId?: string; enrich?: boolean }) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ devFid: String(fid) });
        const roundId = opts?.roundId ?? roundInput;
        if (roundId.trim()) params.set('roundId', roundId.trim());
        if (opts?.enrich ?? enrich) params.set('enrich', '1');
        const res = await fetch(`/api/admin/operational/farm-monitor?${params}`);
        const body = await res.json();
        if (!res.ok) {
          setError(body?.error ?? `Request failed (${res.status})`);
          setReport(null);
        } else {
          setReport(body);
        }
      } catch (e: any) {
        setError(e?.message ?? 'Request failed');
        setReport(null);
      } finally {
        setLoading(false);
      }
    },
    [fid, roundInput, enrich]
  );

  // First paint: latest round, no enrichment (fast, DB-only).
  useEffect(() => {
    run({ roundId: '', enrich: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verdict = report?.assessment?.verdict as string | undefined;
  const verdictStyle = (verdict && VERDICT_STYLE[verdict]) || null;
  const cohorts = report?.cohorts;
  const newGuessers: any[] = report?.newGuesserList ?? [];
  const funders: any[] = report?.funding?.funders ?? [];

  return (
    <div style={styles.section}>
      <div style={styles.headerRow}>
        <h3 style={styles.sectionTitle}>Farm Monitor</h3>
        {verdictStyle && (
          <span style={{ ...styles.verdictPill, background: verdictStyle.bg, color: verdictStyle.fg }}>
            {verdictStyle.label}
            {report?.round?.id != null && ` · Round ${report.round.id}`}
          </span>
        )}
      </div>

      <div style={styles.controls}>
        <input
          type="number"
          placeholder="Round (blank = latest)"
          value={roundInput}
          onChange={(e) => setRoundInput(e.target.value)}
          style={styles.input}
        />
        <label style={styles.checkboxLabel}>
          <input type="checkbox" checked={enrich} onChange={(e) => setEnrich(e.target.checked)} />
          Trace $WORD funding (slow)
        </label>
        <button onClick={() => run()} disabled={loading} style={styles.button}>
          {loading ? 'Checking…' : 'Check'}
        </button>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {report && !error && (
        <>
          {report.assessment?.reasons?.length > 0 && (
            <ul style={styles.reasons}>
              {report.assessment.reasons.map((r: string, i: number) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}

          <div style={styles.statGrid}>
            <Stat label="Guessers" value={cohorts?.guessers} />
            <Stat
              label="New guessers"
              value={cohorts?.newGuessers}
              subtext={`${cohorts?.newGuessersSuspicious ?? 0} suspicious names · ${cohorts?.newAgedRows ?? 0} aged rows`}
            />
            <Stat
              label="Drive-by"
              value={cohorts?.driveBy}
              subtext={report.round?.isLatest ? 'latest round — not meaningful yet' : 'guessed in no other round'}
            />
            <Stat
              label="Gated / grandfathered"
              value={`${cohorts?.gatedGuessers ?? 0} / ${cohorts?.grandfatheredGuessers ?? 0}`}
            />
            <Stat
              label="Gate claims"
              value={report.gate?.claims}
              subtext={`${report.gate?.distinctClaimWallets ?? 0} wallets`}
            />
            <Stat
              label="Usernames"
              value={`${cohorts?.usernames?.baseEth ?? 0} · ${cohorts?.usernames?.placeholder ?? 0} · ${cohorts?.usernames?.none ?? 0}`}
              subtext=".base.eth · placeholder · none"
            />
          </div>

          {report.funding && (
            <div style={styles.subBlock}>
              <div style={styles.subTitle}>
                $WORD funders ({report.funding.walletsChecked} claim wallets checked
                {report.funding.walletsUnverified > 0 &&
                  `, ${report.funding.walletsUnverified} unverified`}
                )
              </div>
              {report.funding.traceFailed ? (
                <div style={styles.error}>
                  Funding trace failed — every Blockscout lookup errored. Run the check again.
                </div>
              ) : funders.length === 0 ? (
                <div style={styles.muted}>No sender funded two or more of the checked wallets.</div>
              ) : (
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Sender</th>
                      <th style={styles.th}>Wallets funded</th>
                      <th style={styles.th}>FIDs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {funders.map((f) => (
                      <tr key={f.sender}>
                        <td style={styles.tdMono}>{f.sender}</td>
                        <td style={styles.td}>{f.walletsFunded}</td>
                        <td style={styles.td}>{f.fids.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div style={styles.muted}>{report.funding.note}</div>
            </div>
          )}

          {newGuessers.length > 0 && (
            <div style={styles.subBlock}>
              <div style={styles.subTitle}>
                New guessers ({newGuessers.length}
                {newGuessers.length >= (report.newGuesserListCap ?? 100) && '+, capped'})
              </div>
              <div style={{ overflowX: 'auto' as const }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>FID</th>
                      <th style={styles.th}>Username</th>
                      <th style={styles.th}>Score</th>
                      <th style={styles.th}>Row created</th>
                      <th style={styles.th}>Guesses</th>
                      <th style={styles.th}>Aged row</th>
                    </tr>
                  </thead>
                  <tbody>
                    {newGuessers.slice(0, 15).map((s) => (
                      <tr key={s.fid}>
                        <td style={styles.td}>{s.fid}</td>
                        <td style={styles.td}>{s.username ?? '—'}</td>
                        <td style={styles.td}>{s.userScore ?? '—'}</td>
                        <td style={styles.td}>{s.createdAt ? String(s.createdAt).slice(0, 10) : '—'}</td>
                        <td style={styles.td}>{s.guessCount}</td>
                        <td style={styles.td}>{s.agedRow ? 'yes' : 'no'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {newGuessers.length > 15 && (
                <div style={styles.muted}>…and {newGuessers.length - 15} more in the API response.</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, subtext }: { label: string; value: any; subtext?: string }) {
  return (
    <div style={styles.statCard}>
      <div style={styles.statLabel}>{label}</div>
      <div style={styles.statValue}>{value ?? '—'}</div>
      {subtext && <div style={styles.statSubtext}>{subtext}</div>}
    </div>
  );
}

const styles = {
  section: {
    background: 'white',
    borderRadius: '12px',
    border: '1px solid #e5e7eb',
    padding: '24px',
    marginBottom: '24px',
  },
  headerRow: {
    display: 'flex' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    flexWrap: 'wrap' as const,
    gap: '8px',
    marginBottom: '16px',
  },
  sectionTitle: {
    fontSize: '15px',
    fontWeight: 600,
    color: '#111827',
    margin: 0,
    letterSpacing: '-0.01em',
    fontFamily,
  },
  verdictPill: {
    fontSize: '12px',
    fontWeight: 600,
    padding: '3px 10px',
    borderRadius: '999px',
    fontFamily,
  },
  controls: {
    display: 'flex' as const,
    alignItems: 'center' as const,
    flexWrap: 'wrap' as const,
    gap: '12px',
    marginBottom: '16px',
  },
  input: {
    padding: '6px 10px',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    fontSize: '13px',
    width: '170px',
    fontFamily,
  },
  checkboxLabel: {
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: '6px',
    fontSize: '13px',
    color: '#4b5563',
    fontFamily,
  },
  button: {
    padding: '6px 14px',
    background: '#111827',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily,
  },
  error: {
    fontSize: '13px',
    color: '#b91c1c',
    marginBottom: '12px',
    fontFamily,
  },
  reasons: {
    fontSize: '13px',
    color: '#4b5563',
    margin: '0 0 16px 0',
    paddingLeft: '18px',
    fontFamily,
  },
  statGrid: {
    display: 'grid' as const,
    gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
    gap: '12px',
  },
  statCard: {
    padding: '16px',
    background: '#f9fafb',
    borderRadius: '8px',
    border: '1px solid #f3f4f6',
  },
  statLabel: {
    fontSize: '12px',
    color: '#6b7280',
    fontWeight: 500,
    marginBottom: '4px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.03em',
    fontFamily,
  },
  statValue: {
    fontSize: '22px',
    fontWeight: 600,
    color: '#111827',
    letterSpacing: '-0.02em',
    fontFamily,
  },
  statSubtext: {
    fontSize: '12px',
    color: '#9ca3af',
    marginTop: '2px',
    fontFamily,
  },
  subBlock: {
    marginTop: '20px',
  },
  subTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#374151',
    marginBottom: '8px',
    fontFamily,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '12px',
    fontFamily,
  },
  th: {
    textAlign: 'left' as const,
    padding: '6px 8px',
    color: '#6b7280',
    fontWeight: 500,
    borderBottom: '1px solid #e5e7eb',
  },
  td: {
    padding: '6px 8px',
    color: '#111827',
    borderBottom: '1px solid #f3f4f6',
  },
  tdMono: {
    padding: '6px 8px',
    color: '#111827',
    borderBottom: '1px solid #f3f4f6',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '11px',
  },
  muted: {
    fontSize: '12px',
    color: '#9ca3af',
    marginTop: '8px',
    fontFamily,
  },
};

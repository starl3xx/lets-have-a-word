/**
 * Farm Monitor — admin Analytics module
 *
 * Surfaces /api/admin/operational/farm-monitor: the farm signature for a
 * round (new-guesser cohort, username shapes, reward-gate claim wallets and
 * their $WORD funders). Loads the latest round on mount; any round is
 * checkable for backtesting. Funding enrichment is opt-in because it walks
 * Blockscout one wallet at a time.
 *
 * First consumer of the shared admin vocabulary (./ui) — Phase 0 of the
 * admin redesign. Only the controls (input/checkbox/button) stay local.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  adminFont,
  AlertBanner,
  Module,
  StatCard,
  statGridStyle,
  StatusPill,
  tableStyles,
  UpdatedStamp,
  type Severity,
} from './ui';

const VERDICT_TO_SEVERITY: Record<string, { severity: Severity; label: string }> = {
  quiet: { severity: 'ok', label: 'Quiet' },
  watch: { severity: 'watch', label: 'Watch' },
  'farm-signature': { severity: 'alert', label: 'Farm signature' },
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

  const verdict = VERDICT_TO_SEVERITY[report?.assessment?.verdict as string] ?? null;
  const cohorts = report?.cohorts;
  const newGuessers: any[] = report?.newGuesserList ?? [];
  const funders: any[] = report?.funding?.funders ?? [];

  return (
    <Module
      title="Farm Monitor"
      aside={
        verdict && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
            <UpdatedStamp updatedAt={report?.generatedAt ?? null} staleAfterMs={10 * 60 * 1000} />
            <StatusPill severity={verdict.severity}>
              {verdict.label}
              {report?.round?.id != null && ` · Round ${report.round.id}`}
            </StatusPill>
          </span>
        )
      }
    >
      <div style={localStyles.controls}>
        <input
          type="number"
          placeholder="Round (blank = latest)"
          value={roundInput}
          onChange={(e) => setRoundInput(e.target.value)}
          style={localStyles.input}
        />
        <label style={localStyles.checkboxLabel}>
          <input type="checkbox" checked={enrich} onChange={(e) => setEnrich(e.target.checked)} />
          Trace $WORD funding (slow)
        </label>
        <button onClick={() => run()} disabled={loading} style={localStyles.button}>
          {loading ? 'Checking…' : 'Check'}
        </button>
      </div>

      {error && <AlertBanner kind="error">{error}</AlertBanner>}

      {report && !error && (
        <>
          {report.assessment?.reasons?.length > 0 && (
            <ul style={localStyles.reasons}>
              {report.assessment.reasons.map((r: string, i: number) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}

          <div style={statGridStyle}>
            <StatCard label="Guessers" value={cohorts?.guessers ?? '—'} />
            <StatCard
              label="New guessers"
              value={cohorts?.newGuessers ?? '—'}
              subtext={`${cohorts?.newGuessersSuspicious ?? 0} suspicious names · ${cohorts?.newAgedRows ?? 0} aged rows`}
            />
            <StatCard
              label="Drive-by"
              value={cohorts?.driveBy ?? '—'}
              subtext={
                report.round?.isLatest ? 'latest round — not meaningful yet' : 'guessed in no other round'
              }
            />
            <StatCard
              label="Gated / grandfathered"
              value={`${cohorts?.gatedGuessers ?? 0} / ${cohorts?.grandfatheredGuessers ?? 0}`}
            />
            <StatCard
              label="Gate claims"
              value={report.gate?.claims ?? '—'}
              subtext={`${report.gate?.distinctClaimWallets ?? 0} wallets`}
            />
            <StatCard
              label="Usernames"
              value={`${cohorts?.usernames?.baseEth ?? 0} · ${cohorts?.usernames?.placeholder ?? 0} · ${cohorts?.usernames?.none ?? 0}`}
              subtext=".base.eth · placeholder · none"
            />
          </div>

          {report.funding && (
            <div style={localStyles.subBlock}>
              <div style={localStyles.subTitle}>
                $WORD funders ({report.funding.walletsChecked} claim wallets checked
                {report.funding.walletsUnverified > 0 &&
                  `, ${report.funding.walletsUnverified} unverified`}
                )
              </div>
              {report.funding.traceFailed ? (
                <AlertBanner kind="error">
                  Funding trace failed — every Blockscout lookup errored. Run the check again.
                </AlertBanner>
              ) : funders.length === 0 ? (
                <div style={localStyles.muted}>
                  No sender funded two or more of the checked wallets.
                </div>
              ) : (
                <div style={tableStyles.wrap}>
                  <table style={tableStyles.table}>
                    <thead>
                      <tr>
                        <th style={tableStyles.th}>Sender</th>
                        <th style={tableStyles.thNum}>Wallets funded</th>
                        <th style={tableStyles.th}>FIDs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {funders.map((f) => (
                        <tr key={f.sender}>
                          <td style={tableStyles.tdMono}>{f.sender}</td>
                          <td style={tableStyles.tdNum}>{f.walletsFunded}</td>
                          <td style={tableStyles.td}>{f.fids.join(', ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div style={localStyles.muted}>{report.funding.note}</div>
            </div>
          )}

          {newGuessers.length > 0 && (
            <div style={localStyles.subBlock}>
              <div style={localStyles.subTitle}>
                New guessers ({newGuessers.length}
                {newGuessers.length >= (report.newGuesserListCap ?? 100) && '+, capped'})
              </div>
              <div style={tableStyles.wrap}>
                <table style={tableStyles.table}>
                  <thead>
                    <tr>
                      <th style={tableStyles.th}>FID</th>
                      <th style={tableStyles.th}>Username</th>
                      <th style={tableStyles.thNum}>Score</th>
                      <th style={tableStyles.th}>Row created (CT)</th>
                      <th style={tableStyles.thNum}>Guesses</th>
                      <th style={tableStyles.th}>Aged row</th>
                    </tr>
                  </thead>
                  <tbody>
                    {newGuessers.slice(0, 15).map((s) => (
                      <tr key={s.fid}>
                        <td style={tableStyles.td}>{s.fid}</td>
                        <td style={tableStyles.td}>{s.username ?? '—'}</td>
                        <td style={tableStyles.tdNum}>{s.userScore ?? '—'}</td>
                        <td style={tableStyles.td}>
                          {/* Central calendar day, not the UTC day sliced off the
                              front of the ISO string — this is the column a batch
                              is read off, and a UTC cut smears one batch over two
                              days. en-CA keeps the compact YYYY-MM-DD. */}
                          {s.createdAt
                            ? new Date(s.createdAt).toLocaleDateString('en-CA', {
                                timeZone: 'America/Chicago',
                              })
                            : '—'}
                        </td>
                        <td style={tableStyles.tdNum}>{s.guessCount}</td>
                        <td style={tableStyles.td}>{s.agedRow ? 'yes' : 'no'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {newGuessers.length > 15 && (
                <div style={localStyles.muted}>
                  …and {newGuessers.length - 15} more in the API response.
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Module>
  );
}

/** Controls and small text bits unique to this module. */
const localStyles = {
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
    fontFamily: adminFont,
  },
  checkboxLabel: {
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: '6px',
    fontSize: '13px',
    color: '#4b5563',
    fontFamily: adminFont,
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
    fontFamily: adminFont,
  },
  reasons: {
    fontSize: '13px',
    color: '#4b5563',
    margin: '0 0 16px 0',
    paddingLeft: '18px',
    fontFamily: adminFont,
  },
  subBlock: {
    marginTop: '20px',
  },
  subTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#374151',
    marginBottom: '8px',
    fontFamily: adminFont,
  },
  muted: {
    fontSize: '12px',
    color: '#9ca3af',
    marginTop: '8px',
    fontFamily: adminFont,
  },
};

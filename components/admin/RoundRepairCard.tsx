/**
 * Round Data Repair — moved from Treasury to Operations (Phase D):
 * DB field surgery is incident tooling, not treasury work. Backed by
 * debug-round2 (inspect) and fix-round-field (repair).
 */

import React, { useState } from 'react';
import { adminFont as fontFamily } from "./ui"


interface RoundFieldAnalysis {
  type: string;
  isDate: boolean;
  constructorName: string;
  value: any;
  length: number | null;
}

interface RoundDebugResult {
  roundId: number;
  status: string;
  fieldAnalysis: Record<string, RoundFieldAnalysis>;
  problemFields: Array<{ field: string } & RoundFieldAnalysis>;
}
interface FixFieldResult {
  success: boolean;
  field: string;
  oldValue: any;
  newValue: any;
  error?: string;
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
    margin: '0 0 16px 0',
    fontFamily,
  },
  cardSubtitle: {
    fontSize: '13px',
    color: '#6b7280',
    margin: '0 0 16px 0',
    fontFamily,
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    fontSize: '14px',
    outline: 'none',
    fontFamily,
    boxSizing: 'border-box' as const,
  },
  btnPrimary: {
    padding: '10px 20px',
    background: '#2563eb',
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
  alert: (type: 'warning' | 'error' | 'info' | 'success') => ({
    padding: '12px 16px',
    borderRadius: '8px',
    marginBottom: '12px',
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    background: type === 'error' ? '#fef2f2' :
                type === 'warning' ? '#fffbeb' :
                type === 'success' ? '#f0fdf4' :
                '#eff6ff',
    border: `1px solid ${
      type === 'error' ? '#fecaca' :
      type === 'warning' ? '#fde68a' :
      type === 'success' ? '#bbf7d0' :
      '#bfdbfe'
    }`,
    color: type === 'error' ? '#991b1b' :
           type === 'warning' ? '#92400e' :
           type === 'success' ? '#166534' :
           '#1e40af',
    fontSize: '13px',
    fontFamily,
  }),
  statCard: {
    background: '#f9fafb',
    borderRadius: '8px',
    padding: '16px',
    textAlign: 'center' as const,
  },
  statLabel: {
    fontSize: '12px',
    color: '#6b7280',
    marginBottom: '4px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.03em',
    fontFamily,
  },
  statValueSmall: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#111827',
    fontFamily,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '13px',
    fontFamily,
  },
  th: {
    textAlign: 'left' as const,
    padding: '10px 12px',
    borderBottom: '1px solid #e5e7eb',
    color: '#6b7280',
    fontWeight: 500,
    fontSize: '11px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.03em',
  },
  td: {
    padding: '10px 12px',
    borderBottom: '1px solid #f3f4f6',
    color: '#374151',
  },
  badge: (color: string) => ({
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '9999px',
    fontSize: '11px',
    fontWeight: 500,
    background: color === 'green' ? '#dcfce7' :
                color === 'yellow' ? '#fef3c7' :
                color === 'red' ? '#fee2e2' :
                '#f3f4f6',
    color: color === 'green' ? '#166534' :
           color === 'yellow' ? '#92400e' :
           color === 'red' ? '#991b1b' :
           '#374151',
    fontFamily,
  }),
  btnDanger: {
    padding: '10px 20px',
    background: '#dc2626',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily,
  },
  btnSmall: {
    padding: '6px 12px',
    fontSize: '12px',
    borderRadius: '6px',
  },
}

export default function RoundRepairCard({ fid }: { fid: number }) {
  const [roundDebugId, setRoundDebugId] = useState<string>('');
  const [roundDebugLoading, setRoundDebugLoading] = useState(false);
  const [roundDebugError, setRoundDebugError] = useState<string | null>(null);
  const [roundDebugResult, setRoundDebugResult] = useState<RoundDebugResult | null>(null);
  const [fixFieldValue, setFixFieldValue] = useState<string>('');
  const [fixingField, setFixingField] = useState<string | null>(null);
  const [fixFieldResult, setFixFieldResult] = useState<FixFieldResult | null>(null);

  const debugRound = async (roundId: string) => {
    if (!fid || !roundId) return;

    setRoundDebugLoading(true);
    setRoundDebugError(null);
    setRoundDebugResult(null);
    setFixFieldResult(null);

    try {
      const res = await fetch(`/api/admin/debug-round2?devFid=${fid}&roundId=${roundId}`);
      if (res.ok) {
        const data = await res.json();
        setRoundDebugResult(data);
      } else {
        const err = await res.json();
        setRoundDebugError(err.error || 'Failed to debug round');
      }
    } catch (err) {
      setRoundDebugError('Failed to debug round');
    } finally {
      setRoundDebugLoading(false);
    }
  };
  const fixRoundField = async (roundId: number, field: string, value: string) => {
    if (!fid) return;

    setFixingField(field);
    setFixFieldResult(null);

    try {
      const res = await fetch('/api/admin/fix-round-field', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fid: fid,
          roundId,
          field,
          value,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setFixFieldResult({
          success: true,
          field,
          oldValue: data.oldValue,
          newValue: data.newValue,
        });
        // Refresh the debug info
        await debugRound(String(roundId));
      } else {
        setFixFieldResult({
          success: false,
          field,
          oldValue: null,
          newValue: null,
          error: data.error || 'Unknown error',
        });
      }
    } catch (err: any) {
      setFixFieldResult({
        success: false,
        field,
        oldValue: null,
        newValue: null,
        error: err.message || 'Request failed',
      });
    } finally {
      setFixingField(null);
      setFixFieldValue('');
    }
  };

  return (
    <>
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>🔧 Round Data Repair</h3>
        <p style={styles.cardSubtitle}>
          Debug and fix corrupted round fields (e.g., string fields stored as Date objects)
        </p>

        {/* Debug Round Form */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
          <input
            type="number"
            placeholder="Round ID (e.g., 2)"
            value={roundDebugId}
            onChange={(e) => setRoundDebugId(e.target.value)}
            style={{ ...styles.input, width: '200px' }}
          />
          <button
            onClick={() => debugRound(roundDebugId)}
            disabled={roundDebugLoading || !roundDebugId}
            style={{
              ...styles.btnPrimary,
              ...(roundDebugLoading || !roundDebugId ? styles.btnDisabled : {}),
            }}
          >
            {roundDebugLoading ? 'Loading...' : 'Debug Round'}
          </button>
        </div>

        {/* Error */}
        {roundDebugError && (
          <div style={styles.alert('error')}>{roundDebugError}</div>
        )}

        {/* Fix Result */}
        {fixFieldResult && (
          <div style={styles.alert(fixFieldResult.success ? 'success' : 'error')}>
            {fixFieldResult.success ? (
              <>
                <span>✅</span>
                <span>
                  Field "{fixFieldResult.field}" fixed! Changed from "{String(fixFieldResult.oldValue)}" to "{fixFieldResult.newValue}"
                </span>
              </>
            ) : (
              <>
                <span>❌</span>
                <span>Failed to fix field "{fixFieldResult.field}": {fixFieldResult.error}</span>
              </>
            )}
            <button
              onClick={() => setFixFieldResult(null)}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px' }}
            >
              ×
            </button>
          </div>
        )}

        {/* Debug Results */}
        {roundDebugResult && (
          <div>
            <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
              <div style={{ ...styles.statCard, flex: 1 }}>
                <div style={styles.statLabel}>Round</div>
                <div style={styles.statValueSmall}>#{roundDebugResult.roundId}</div>
              </div>
              <div style={{ ...styles.statCard, flex: 1 }}>
                <div style={styles.statLabel}>Status</div>
                <div style={styles.statValueSmall}>{roundDebugResult.status}</div>
              </div>
              <div style={{ ...styles.statCard, flex: 1 }}>
                <div style={styles.statLabel}>Problem Fields</div>
                <div style={styles.statValueSmall}>
                  <span style={{ color: roundDebugResult.problemFields.length > 0 ? '#dc2626' : '#16a34a' }}>
                    {roundDebugResult.problemFields.length}
                  </span>
                </div>
              </div>
            </div>

            {/* Problem Fields Alert */}
            {roundDebugResult.problemFields.length > 0 && (
              <div style={{ ...styles.alert('error'), marginBottom: '16px' }}>
                <span>⚠️</span>
                <span>
                  <strong>Corrupted fields found:</strong>{' '}
                  {roundDebugResult.problemFields.map(pf => pf.field).join(', ')}
                </span>
              </div>
            )}

            {/* Problem Fields Fix UI */}
            {roundDebugResult.problemFields.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 600, color: '#374151' }}>
                  Fix Corrupted Fields
                </h4>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Field</th>
                      <th style={styles.th}>Current Type</th>
                      <th style={styles.th}>Current Value</th>
                      <th style={styles.th}>New Value</th>
                      <th style={styles.th}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roundDebugResult.problemFields.map((pf) => (
                      <tr key={pf.field}>
                        <td style={styles.td}>
                          <code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: '4px' }}>
                            {pf.field}
                          </code>
                        </td>
                        <td style={styles.td}>
                          <span style={styles.badge('red')}>
                            {pf.isDate ? 'Date' : pf.constructorName || pf.type}
                          </span>
                        </td>
                        <td style={{ ...styles.td, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <span style={{ fontFamily: 'monospace', fontSize: '11px' }} title={String(pf.value)}>
                            {String(pf.value)}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <input
                            type="text"
                            placeholder="Enter correct value"
                            onChange={(e) => setFixFieldValue(e.target.value)}
                            style={{ ...styles.input, width: '150px', padding: '6px 8px', fontSize: '12px' }}
                          />
                        </td>
                        <td style={styles.td}>
                          <button
                            onClick={() => fixRoundField(roundDebugResult.roundId, pf.field, fixFieldValue)}
                            disabled={fixingField === pf.field || !fixFieldValue}
                            style={{
                              ...styles.btnDanger,
                              ...styles.btnSmall,
                              ...(fixingField === pf.field || !fixFieldValue ? styles.btnDisabled : {}),
                            }}
                          >
                            {fixingField === pf.field ? 'Fixing...' : 'Fix Field'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* All Fields Table */}
            <details style={{ marginTop: '16px' }}>
              <summary style={{ cursor: 'pointer', fontSize: '14px', fontWeight: 500, color: '#374151', marginBottom: '8px' }}>
                View All Fields ({Object.keys(roundDebugResult.fieldAnalysis).length})
              </summary>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Field</th>
                    <th style={styles.th}>Type</th>
                    <th style={styles.th}>Is Date?</th>
                    <th style={styles.th}>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(roundDebugResult.fieldAnalysis).map(([field, info]) => {
                    // Fields that SHOULD be strings (if these are Date, it's a problem)
                    const shouldBeStringFields = ['answer', 'salt', 'commitHash', 'prizePoolEth', 'seedNextRoundEth', 'txHash', 'bonusWordsCommitHash', 'cancelledReason', 'cancelledBy', 'status', 'prizePoolWord', 'seedNextRoundWord', 'prizeCurrency'];
                    // Fields that SHOULD be dates (these are expected to be Date)
                    const shouldBeDateFields = ['startedAt', 'resolvedAt', 'cancelledAt', 'refundsStartedAt', 'refundsCompletedAt', 'createdAt', 'updatedAt'];
                    const isCorrupted = shouldBeStringFields.includes(field) && info.isDate;
                    const isExpectedDate = shouldBeDateFields.includes(field) && info.isDate;

                    return (
                      <tr key={field} style={{ background: isCorrupted ? '#fef2f2' : undefined }}>
                        <td style={styles.td}>
                          <code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: '4px' }}>
                            {field}
                          </code>
                        </td>
                        <td style={styles.td}>{info.constructorName || info.type}</td>
                        <td style={styles.td}>
                          {info.isDate ? (
                            isCorrupted ? (
                              <span style={styles.badge('red')}>Yes ⚠️</span>
                            ) : (
                              <span style={styles.badge('green')}>Yes ✓</span>
                            )
                          ) : (
                            <span style={styles.badge('green')}>No</span>
                          )}
                        </td>
                        <td style={{ ...styles.td, maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <span style={{ fontFamily: 'monospace', fontSize: '11px' }} title={String(info.value)}>
                            {String(info.value)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </details>

            {/* No Problems */}
            {roundDebugResult.problemFields.length === 0 && (
              <div style={styles.alert('success')}>
                <span>✅</span>
                <span>No corrupted fields found! All string fields have correct types.</span>
              </div>
            )}
          </div>
        )}

        {/* Instructions */}
        {!roundDebugResult && !roundDebugLoading && (
          <div style={styles.alert('info')}>
            <span>ℹ️</span>
            <span>
              Enter a round ID to debug its database fields. This will check for any fields that have been corrupted
              (e.g., string fields accidentally stored as Date objects), which can cause archive sync failures.
            </span>
          </div>
        )}
      </div>
    </>
  );
}

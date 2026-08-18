/**
 * Bonus word distributions — moved from Treasury to Operations (Phase D):
 * a retry queue for failed game payouts is incident tooling. Backed by
 * retry-bonus-distribution (list + retry).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { adminFont as fontFamily } from "./ui"
import { formatCentral, formatTokenCompact, shortenAddress } from "./format";


interface RetrySuccess {
  id: number | string;
  txHash: string;
  walletAddress?: string;
}

interface FailedBonusClaim {
  claimId: number;
  bonusWordId: number;
  fid: number;
  username: string | null;
  walletAddress: string;
  txStatus: string;
  txHash: string | null;
  errorMessage: string | null;
  claimedAt: string;
  retryCount: number;
  wordIndex: number;
  roundId: number;
}
interface BonusWordWithoutTx {
  bonusWordId: number;
  roundId: number;
  wordIndex: number;
  claimedByFid: number;
  username: string | null;
  claimedAt: string;
  txHash: string | null;
}

interface BonusDistributionStatus {
  failedClaims: FailedBonusClaim[];
  claimedWithoutTx: BonusWordWithoutTx[];
  contractWordTokenBalance: string;
  totalFailedOrPending: number;
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
  btnSecondary: {
    padding: '10px 20px',
    background: '#f3f4f6',
    color: '#374151',
    border: '1px solid #d1d5db',
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
  grid2: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '16px',
  },
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
  statSubtext: {
    fontSize: '11px',
    color: '#9ca3af',
    marginTop: '4px',
    fontFamily,
  },
  link: {
    color: '#2563eb',
    textDecoration: 'none',
  },
  btnSuccess: {
    padding: '10px 20px',
    background: '#16a34a',
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
}

export default function BonusDistributionsCard({ fid }: { fid: number }) {
  const [retryAllResult, setRetryAllResult] = useState<{ successful: number; failed: number } | null>(null);
  const [retryingAll, setRetryingAll] = useState(false);

  const [retrySuccesses, setRetrySuccesses] = useState<RetrySuccess[]>([]);

  const [bonusDistStatus, setBonusDistStatus] = useState<BonusDistributionStatus | null>(null);
  const [bonusDistLoading, setBonusDistLoading] = useState(false);
  const [bonusDistError, setBonusDistError] = useState<string | null>(null);
  const [retryingClaimId, setRetryingClaimId] = useState<number | null>(null);
  const [retryingBonusWordId, setRetryingBonusWordId] = useState<number | null>(null);

  const fetchBonusDistStatus = useCallback(async () => {
    if (!fid) return;

    setBonusDistLoading(true);
    setBonusDistError(null);
    try {
      const res = await fetch(`/api/admin/operational/retry-bonus-distribution?devFid=${fid}`);
      if (res.ok) {
        const data = await res.json();
        setBonusDistStatus(data);
      } else {
        const err = await res.json();
        setBonusDistError(err.error || 'Failed to fetch bonus distribution status');
      }
    } catch (err) {
      setBonusDistError('Failed to fetch bonus distribution status');
    } finally {
      setBonusDistLoading(false);
    }
  }, [fid]);
  const retryBonusClaim = async (claimId: number) => {
    if (!fid) return;

    setRetryingClaimId(claimId);
    try {
      const res = await fetch('/api/admin/operational/retry-bonus-distribution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fid: fid, claimId }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setRetrySuccesses((prev) => [...prev, { id: `claim-${claimId}`, txHash: data.txHash }]);
        await fetchBonusDistStatus();
      } else {
        alert(`Failed: ${data.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setRetryingClaimId(null);
    }
  };
  const retryBonusWordWithoutTx = async (bonusWordId: number) => {
    if (!fid) return;

    setRetryingBonusWordId(bonusWordId);
    try {
      const res = await fetch('/api/admin/operational/retry-bonus-distribution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fid: fid, bonusWordId }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setRetrySuccesses((prev) => [...prev, { id: `bw-${bonusWordId}`, txHash: data.txHash, walletAddress: data.walletAddress }]);
        await fetchBonusDistStatus();
      } else {
        alert(`Failed: ${data.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setRetryingBonusWordId(null);
    }
  };

  const retryAllFailed = async () => {
    if (!fid) return;
    if (!confirm('Retry all failed bonus word distributions?')) return;

    setRetryingAll(true);
    setRetryAllResult(null);
    try {
      const res = await fetch('/api/admin/operational/retry-bonus-distribution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fid: fid, all: true }),
      });

      const data = await res.json();
      if (res.ok && data.results) {
        const successful = data.results.filter((r: any) => r.success).length;
        const failed = data.results.filter((r: any) => r.error).length;
        setRetryAllResult({ successful, failed });
        // Add successful transactions to the list
        const successfulTxs = data.results
          .filter((r: any) => r.success)
          .map((r: any) => ({ id: `claim-${r.claimId}`, txHash: r.txHash }));
        setRetrySuccesses((prev) => [...prev, ...successfulTxs]);
        await fetchBonusDistStatus();
      } else {
        alert(`Failed: ${data.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setRetryingAll(false);
    }
  };

  useEffect(() => {
    fetchBonusDistStatus();
  }, [fetchBonusDistStatus]);

  return (
    <>
      <div style={styles.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <h3 style={{ ...styles.cardTitle, margin: 0 }}>🎣 Bonus word distributions</h3>
            <p style={{ ...styles.cardSubtitle, margin: '4px 0 0 0' }}>
              Legacy JackpotManager — retry failed $WORD distributions for bonus word winners
            </p>
          </div>
          <button
            onClick={() => fetchBonusDistStatus()}
            disabled={bonusDistLoading}
            style={{ ...styles.btnSecondary, ...styles.btnSmall }}
          >
            {bonusDistLoading ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {bonusDistError ? (
          <div style={styles.alert('error')}>{bonusDistError}</div>
        ) : bonusDistLoading && !bonusDistStatus ? (
          <div style={{ padding: '24px', textAlign: 'center', color: '#6b7280' }}>Loading...</div>
        ) : bonusDistStatus ? (
          <>
            {/* Summary Stats */}
            <div style={{ ...styles.grid2, marginBottom: '16px' }}>
              <div style={styles.statCard}>
                <div style={styles.statLabel}>Contract $WORD</div>
                <div style={styles.statValueSmall}>{formatTokenBalance(bonusDistStatus.contractWordTokenBalance)}</div>
                <div style={styles.statSubtext}>Available for rewards</div>
              </div>
              <div style={styles.statCard}>
                <div style={styles.statLabel}>Failed/Pending</div>
                <div style={styles.statValueSmall}>
                  {bonusDistStatus.failedClaims.length + bonusDistStatus.claimedWithoutTx.length}
                </div>
                <div style={styles.statSubtext}>Need attention</div>
              </div>
            </div>

            {/* Retry All Result */}
            {retryAllResult && (
              <div style={{ ...styles.alert('success'), marginBottom: '16px' }}>
                <span>✅</span>
                <span>Retry complete: {retryAllResult.successful} successful, {retryAllResult.failed} failed</span>
                <button
                  onClick={() => setRetryAllResult(null)}
                  style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px' }}
                >
                  ×
                </button>
              </div>
            )}

            {/* Recent Success Messages */}
            {retrySuccesses.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                {retrySuccesses.slice(-5).map((success) => (
                  <div key={success.id} style={{ ...styles.alert('success'), marginBottom: '8px' }}>
                    <span>✅</span>
                    <span>
                      Sent!{' '}
                      <a
                        href={`https://basescan.org/tx/${success.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={styles.link}
                      >
                        View on BaseScan →
                      </a>
                    </span>
                    <button
                      onClick={() => setRetrySuccesses((prev) => prev.filter((s) => s.id !== success.id))}
                      style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px' }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Failed Claims Table */}
            {bonusDistStatus.failedClaims.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#374151' }}>
                    Failed Claims ({bonusDistStatus.failedClaims.length})
                  </h4>
                  <button
                    onClick={retryAllFailed}
                    disabled={retryingAll}
                    style={{
                      ...styles.btnSuccess,
                      ...styles.btnSmall,
                      ...(retryingAll ? styles.btnDisabled : {}),
                    }}
                  >
                    {retryingAll ? 'Retrying...' : 'Retry All Failed'}
                  </button>
                </div>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Round</th>
                      <th style={styles.th}>User</th>
                      <th style={styles.th}>Wallet</th>
                      <th style={styles.th}>Status</th>
                      <th style={styles.th}>Retries</th>
                      <th style={styles.th}>Error</th>
                      <th style={styles.th}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bonusDistStatus.failedClaims.map((claim) => (
                      <tr key={claim.claimId}>
                        <td style={styles.td}>R{claim.roundId} #{claim.wordIndex + 1}</td>
                        <td style={styles.td}>
                          {claim.username ? `@${claim.username}` : `FID ${claim.fid}`}
                        </td>
                        <td style={styles.td}>
                          <span style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                            {shortenAddress(claim.walletAddress)}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <span style={styles.badge(claim.txStatus === 'failed' ? 'red' : 'yellow')}>
                            {claim.txStatus}
                          </span>
                        </td>
                        <td style={styles.td}>{claim.retryCount}</td>
                        <td style={{ ...styles.td, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <span title={claim.errorMessage || undefined} style={{ fontSize: '11px', color: '#6b7280' }}>
                            {claim.errorMessage || '-'}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <button
                            onClick={() => retryBonusClaim(claim.claimId)}
                            disabled={retryingClaimId === claim.claimId}
                            style={{
                              ...styles.btnPrimary,
                              ...styles.btnSmall,
                              ...(retryingClaimId === claim.claimId ? styles.btnDisabled : {}),
                            }}
                          >
                            {retryingClaimId === claim.claimId ? 'Retrying...' : 'Retry'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Claimed Without TX Table */}
            {bonusDistStatus.claimedWithoutTx.length > 0 && (
              <div>
                <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 600, color: '#374151' }}>
                  Claimed Without TX ({bonusDistStatus.claimedWithoutTx.length})
                </h4>
                <p style={{ fontSize: '12px', color: '#6b7280', margin: '0 0 8px 0' }}>
                  Bonus words marked as claimed but no on-chain transaction recorded
                </p>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Round</th>
                      <th style={styles.th}>Word #</th>
                      <th style={styles.th}>User</th>
                      <th style={styles.th}>Claimed At</th>
                      <th style={styles.th}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bonusDistStatus.claimedWithoutTx.map((bw) => (
                      <tr key={bw.bonusWordId}>
                        <td style={styles.td}>R{bw.roundId}</td>
                        <td style={styles.td}>#{bw.wordIndex + 1}</td>
                        <td style={styles.td}>
                          {bw.username ? `@${bw.username}` : `FID ${bw.claimedByFid}`}
                        </td>
                        <td style={styles.td}>{formatCentral(bw.claimedAt)}</td>
                        <td style={styles.td}>
                          <button
                            onClick={() => retryBonusWordWithoutTx(bw.bonusWordId)}
                            disabled={retryingBonusWordId === bw.bonusWordId}
                            style={{
                              ...styles.btnPrimary,
                              ...styles.btnSmall,
                              ...(retryingBonusWordId === bw.bonusWordId ? styles.btnDisabled : {}),
                            }}
                          >
                            {retryingBonusWordId === bw.bonusWordId ? 'Sending...' : 'Send $WORD'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* All Clear Message */}
            {bonusDistStatus.failedClaims.length === 0 && bonusDistStatus.claimedWithoutTx.length === 0 && (
              <div style={styles.alert('success')}>
                <span>✅</span>
                <span>All bonus word distributions are confirmed on-chain!</span>
              </div>
            )}
          </>
        ) : null}
      </div>
    </>
  );
}

function formatTokenBalance(balance: string): string {
  const num = parseFloat(balance);
  if (isNaN(num) || num === 0) return '0';
  return formatTokenCompact(num);
}


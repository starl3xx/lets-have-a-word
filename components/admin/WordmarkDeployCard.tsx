/**
 * Deploy the Wordmarks ERC-1155 from the admin panel.
 *
 * THE MOST IRREVERSIBLE CONTROL IN HERE. A deployed contract cannot be edited,
 * the tokens are soulbound so a bad one cannot be recalled, and a second
 * contract silently orphans everything minted from the first. So this is built
 * to be slow on purpose:
 *
 *   - Base Sepolia is preselected. Mainnet is a deliberate switch.
 *   - Mainnet reveals a phrase field that must be typed exactly.
 *   - The result is only ever REPORTED. Wiring it up is a separate human step,
 *     so a deploy that went wrong is not also instantly live.
 *
 * The server repeats every one of these checks. Nothing here is the guard; this
 * is just the part that makes the guard visible before the click.
 */

import React, { useState } from 'react';
import { adminFont as fontFamily } from './ui';

interface DeployResult {
  ok: true;
  chain: string;
  chainId: number;
  address: string;
  txHash: string;
  deployer: string;
  owner: string;
  attestor: string;
  baseUri: string;
  gasUsed: string;
  explorerUrl: string;
  nextSteps: string[];
}

const MAINNET_PHRASE = 'DEPLOY TO MAINNET';

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: 'white',
    borderRadius: '12px',
    border: '1px solid #e5e7eb',
    padding: '24px',
    marginBottom: '16px',
  },
  cardTitle: { fontSize: '16px', fontWeight: 600, color: '#111827', margin: '0 0 8px 0', fontFamily },
  cardSubtitle: { fontSize: '13px', color: '#6b7280', margin: '0 0 16px 0', lineHeight: 1.5, fontFamily },
  label: { display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px', fontFamily },
  input: {
    width: '100%', padding: '8px 10px', fontSize: '13px', fontFamily,
    border: '1px solid #d1d5db', borderRadius: '8px', marginBottom: '12px', boxSizing: 'border-box',
  },
  mono: { fontFamily: 'ui-monospace, Menlo, monospace' },
  row: { display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' },
  btn: {
    padding: '10px 20px', border: 'none', borderRadius: '8px',
    fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily,
  },
  warn: {
    background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px',
    padding: '12px 14px', fontSize: '13px', color: '#92400e', marginBottom: '16px',
    lineHeight: 1.5, fontFamily,
  },
  danger: {
    background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px',
    padding: '12px 14px', fontSize: '13px', color: '#991b1b', marginBottom: '16px',
    lineHeight: 1.5, fontFamily,
  },
  ok: {
    background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '8px',
    padding: '14px 16px', fontSize: '13px', color: '#065f46', lineHeight: 1.6, fontFamily,
  },
};

export default function WordmarkDeployCard({ fid }: { fid: number }) {
  const [chain, setChain] = useState<'base-sepolia' | 'base'>('base-sepolia');
  const [owner, setOwner] = useState('');
  const [attestor, setAttestor] = useState('');
  const [baseUri, setBaseUri] = useState('https://letshaveaword.fun/api/wordmarks/metadata/');
  const [phrase, setPhrase] = useState('');
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DeployResult | null>(null);

  const isMainnet = chain === 'base';
  const phraseOk = !isMainnet || phrase === MAINNET_PHRASE;
  const canDeploy = !busy && owner.trim() && attestor.trim() && baseUri.trim() && phraseOk;

  const deploy = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/admin/operational/deploy-wordmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          devFid: fid,
          chain,
          owner: owner.trim(),
          attestor: attestor.trim(),
          baseUri: baseUri.trim(),
          confirmPhrase: phrase,
          replaceExisting,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Deploy failed');
      setResult(data as DeployResult);
      setPhrase('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deploy failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={styles.card}>
      <h3 style={styles.cardTitle}>Deploy Wordmarks contract</h3>
      <p style={styles.cardSubtitle}>
        Soulbound ERC-1155. Deployed from the operator wallet, which pays the gas but does
        not become the owner unless you say so below.
      </p>

      <div style={isMainnet ? styles.danger : styles.warn}>
        {isMainnet ? (
          <>
            <strong>Base Mainnet. This spends real ETH and cannot be undone.</strong> The
            tokens are soulbound, so a contract deployed by mistake cannot be recalled and
            anything minted from it cannot be moved to a replacement. Deploy to Sepolia
            first and mint one there.
          </>
        ) : (
          <>
            <strong>Base Sepolia.</strong> Nothing here is real. Deploy, then mint one
            Wordmark against it and confirm the art loads in a wallet before you switch to
            mainnet.
          </>
        )}
      </div>

      <label style={styles.label}>Network</label>
      <div style={styles.row}>
        {(['base-sepolia', 'base'] as const).map((c) => (
          <label key={c} style={{ fontSize: '13px', fontFamily, cursor: 'pointer' }}>
            <input
              type="radio"
              checked={chain === c}
              onChange={() => {
                setChain(c);
                setPhrase('');
                setResult(null);
                setError(null);
              }}
              style={{ marginRight: '6px' }}
            />
            {c === 'base' ? 'Base Mainnet' : 'Base Sepolia'}
          </label>
        ))}
      </div>

      <label style={styles.label}>Owner (can rotate the attestor and change the art location)</label>
      <input
        style={{ ...styles.input, ...styles.mono }}
        value={owner}
        onChange={(e) => setOwner(e.target.value)}
        placeholder="0x..."
      />

      <label style={styles.label}>
        Attestor (signs mint vouchers only, and must NOT be the operator wallet)
      </label>
      <input
        style={{ ...styles.input, ...styles.mono }}
        value={attestor}
        onChange={(e) => setAttestor(e.target.value)}
        placeholder="0x..."
      />

      <label style={styles.label}>Base URI (must end with “/”)</label>
      <input
        style={{ ...styles.input, ...styles.mono }}
        value={baseUri}
        onChange={(e) => setBaseUri(e.target.value)}
      />

      {isMainnet && (
        <>
          <label style={styles.label}>
            Type <span style={styles.mono}>{MAINNET_PHRASE}</span> to confirm
          </label>
          <input
            style={{ ...styles.input, ...styles.mono }}
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            placeholder={MAINNET_PHRASE}
          />
          <label style={{ fontSize: '12px', color: '#991b1b', fontFamily, display: 'block', marginBottom: '12px' }}>
            <input
              type="checkbox"
              checked={replaceExisting}
              onChange={(e) => setReplaceExisting(e.target.checked)}
              style={{ marginRight: '6px' }}
            />
            Replace an already-configured contract (orphans everything minted from it)
          </label>
        </>
      )}

      <button
        onClick={() => void deploy()}
        disabled={!canDeploy}
        style={{
          ...styles.btn,
          background: canDeploy ? (isMainnet ? '#dc2626' : '#2563eb') : '#e5e7eb',
          color: canDeploy ? 'white' : '#9ca3af',
          cursor: canDeploy ? 'pointer' : 'not-allowed',
        }}
      >
        {busy ? 'Deploying...' : isMainnet ? 'Deploy to Base Mainnet' : 'Deploy to Base Sepolia'}
      </button>

      {error && (
        <div style={{ ...styles.danger, marginTop: '16px', marginBottom: 0 }}>{error}</div>
      )}

      {result && (
        <div style={{ ...styles.ok, marginTop: '16px' }}>
          <div style={{ fontWeight: 700, marginBottom: '8px' }}>
            Deployed to {result.chain}
          </div>
          <div style={styles.mono}>{result.address}</div>
          <div style={{ marginTop: '8px' }}>
            <a href={result.explorerUrl} target="_blank" rel="noopener noreferrer">
              View on explorer
            </a>{' '}
            · gas {Number(result.gasUsed).toLocaleString()} · deployer{' '}
            <span style={styles.mono}>{result.deployer.slice(0, 10)}…</span>
          </div>
          <div style={{ fontWeight: 700, margin: '12px 0 4px' }}>Next</div>
          <ol style={{ margin: 0, paddingLeft: '18px' }}>
            {result.nextSteps.map((s, i) => (
              <li key={i} style={{ marginBottom: '4px' }}>{s}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

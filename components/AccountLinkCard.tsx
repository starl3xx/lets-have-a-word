/**
 * Linking a Base App wallet to an existing Farcaster account.
 *
 * TWO HALVES, because neither side can prove both identities alone. In the
 * Farcaster mini app the connected wallet is the player's Farcaster wallet, so
 * they cannot sign as their Base Account there; in Base App there is no
 * Farcaster host, so they cannot produce a Quick Auth token. The player is the
 * only thing that spans both, so they carry a short code across.
 *
 * Without this a returning player silently starts over in Base App: no
 * grandfathering, no Early Adopter Wordmark, no XP, no history.
 */

import { useState } from 'react';
import { haptics } from '../src/lib/haptics';
import { playerSessionHeaders, setStoredPlayerSession } from '../src/lib/playerSessionClient';

/** The Farcaster half: issue a code to carry into Base App. */
export function LinkCodeIssuer({ authToken }: { authToken?: string | null }) {
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const issue = async () => {
    void haptics.buttonTapMinor();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/link-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authToken }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.code) throw new Error(data?.error || 'Could not create a code');
      setCode(data.code);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create a code');
    } finally {
      setBusy(false);
    }
  };

  if (code) {
    return (
      <div className="section-card text-center space-y-2">
        <p className="text-sm text-gray-600">Enter this in the Base app, within 10 minutes</p>
        <p className="text-3xl font-extrabold tracking-[0.3em] text-gray-900">{code}</p>
        <p className="text-xs text-gray-500">
          Your guesses, Wordmarks and XP come with you.
        </p>
      </div>
    );
  }

  return (
    <div className="section-card space-y-2">
      <p className="text-sm text-gray-700">
        Play in the Base app too? Link it so you keep this account.
      </p>
      <button onClick={issue} disabled={busy} className="btn-secondary w-full">
        {busy ? 'One moment...' : 'Get a link code'}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

/** The Base App half: redeem the code and become the Farcaster account. */
export function LinkCodeRedeemer({ onLinked }: { onLinked: (fid: number) => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redeem = async () => {
    void haptics.buttonTapMinor();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/link-redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...playerSessionHeaders() },
        body: JSON.stringify({ code: code.trim().toUpperCase() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.fid) throw new Error(data?.error || 'Could not link that account');

      // The server re-minted a session naming the Farcaster account. Store it,
      // or every later request keeps resolving to the wallet identity they
      // just linked away from — the cookie alone cannot be relied on here.
      if (data.sessionToken) {
        setStoredPlayerSession({ token: data.sessionToken, fid: data.fid });
      }
      void haptics.shareCompleted();
      onLinked(data.fid);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not link that account');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="section-card space-y-2">
      <p className="text-sm text-gray-700">
        Already play on Farcaster? Get a code there and enter it here to keep your
        guesses, Wordmarks and XP.
      </p>
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="ABC123"
        maxLength={8}
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        className="w-full text-center text-2xl font-bold tracking-[0.25em] py-3 rounded-btn border-2 border-gray-200"
      />
      <button
        onClick={redeem}
        disabled={busy || code.trim().length < 4}
        className="btn-secondary w-full"
      >
        {busy ? 'Linking...' : 'Link my Farcaster account'}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

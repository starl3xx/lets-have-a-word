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
  const [copied, setCopied] = useState(false);
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

  const copyCode = async () => {
    if (!code) return;
    void haptics.buttonTapMinor();
    try {
      await navigator.clipboard.writeText(code);
      void haptics.linkCopied();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard refused (permissions, or an insecure context). The code is
      // on screen and typeable, so this is a convenience that failed, not a
      // dead end — say nothing rather than raise an error about it.
    }
  };

  if (code) {
    return (
      <div className="section-card text-center space-y-2">
        <p className="text-sm text-gray-600">Enter this in the Base app, within 10 minutes</p>
        {/* The whole card is the copy target, not a separate button: the code
            is what the player is reaching for, so tapping it should do the
            obvious thing. */}
        <button
          onClick={copyCode}
          className="w-full py-2 rounded-btn active:scale-95 transition-all"
          aria-label="Copy your link code"
        >
          <span className="block text-3xl font-extrabold tracking-[0.3em] text-gray-900">
            {code}
          </span>
          <span className="block text-xs font-semibold text-accent-600 mt-1">
            {copied ? 'Copied ✓' : 'Tap to copy'}
          </span>
        </button>
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

  const pasteCode = async () => {
    void haptics.buttonTapMinor();
    try {
      const text = await navigator.clipboard.readText();
      // Codes are six characters from an unambiguous alphabet, so anything
      // else on the clipboard is not one — take only what looks like a code
      // rather than dumping arbitrary text into the field.
      const found = text.toUpperCase().match(/[A-Z2-9]{4,8}/);
      if (found) {
        setCode(found[0]);
        setError(null);
      }
    } catch {
      // Permission refused or unsupported. The field is still typeable.
    }
  };

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
      <div className="flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ABC123"
          maxLength={8}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          className="flex-1 text-center text-2xl font-bold tracking-[0.25em] py-3 rounded-btn border-2 border-gray-200"
        />
        {/* Reading the clipboard needs permission and some hosts refuse it
            outright, so this never replaces typing — it fills the field when it
            can and stays quiet when it cannot. */}
        <button
          onClick={pasteCode}
          className="px-4 rounded-btn border-2 border-gray-200 font-semibold text-gray-700 active:scale-95 transition-all"
          aria-label="Paste your link code"
        >
          Paste
        </button>
      </div>
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

const LINK_PROMPT_SEEN_KEY = 'lhaw_seen_link_prompt';

/** Has this browser already been offered the one-time link prompt? */
export function hasSeenLinkPrompt(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(LINK_PROMPT_SEEN_KEY) === 'true';
  } catch {
    // Storage disabled. Treat as seen: a prompt that cannot remember being
    // dismissed would reappear on every load, which is worse than never
    // appearing.
    return true;
  }
}

export function markLinkPromptSeen(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LINK_PROMPT_SEEN_KEY, 'true');
  } catch {
    /* nothing to do */
  }
}

/**
 * The one-time offer, shown right after a wallet player's first sign-in.
 *
 * TIMING IS THE WHOLE POINT. Linking from the stats panel works, but a
 * returning veteran has no reason to go looking there — they play, build a
 * history on the synthetic account, and only later wonder where their Early
 * Adopter Wordmark went. By then linking returns their old account but the
 * guesses made in between stay stranded on the synthetic one, because linking
 * deliberately does not migrate play history. Offered here, the account is
 * blank and linking costs nothing.
 *
 * Dismissible and remembered, like the install prompt: a player with no
 * Farcaster account must not be nagged about one.
 */
export function LinkAccountPrompt({
  onLinked,
  onDismiss,
}: {
  onLinked: (fid: number) => void;
  onDismiss: () => void;
}) {
  const dismiss = () => {
    void haptics.buttonTapMinor();
    markLinkPromptSeen();
    onDismiss();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={dismiss}>
      <div
        className="modal-sheet space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center space-y-1">
          <h2 className="text-xl font-bold text-gray-900">Played on Farcaster before?</h2>
          <p className="text-sm text-gray-600">
            Link that account and your guesses, Wordmarks and XP come with you...
            otherwise this starts as a brand new player.
          </p>
        </div>

        <LinkCodeRedeemer
          onLinked={(fid) => {
            markLinkPromptSeen();
            onLinked(fid);
          }}
        />

        <button onClick={dismiss} className="btn-secondary w-full">
          I&rsquo;m new here
        </button>
      </div>
    </div>
  );
}

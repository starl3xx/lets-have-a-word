/**
 * Wallet sign-in (SIWE) — the Base App door.
 *
 * Connect a wallet, sign a Sign-In With Ethereum message, exchange it at
 * /api/auth/siwe for an HttpOnly player-session cookie. From then on the game
 * endpoints resolve this player through `resolveRequestFid` exactly as they
 * resolve a Farcaster player through Quick Auth.
 *
 * WHY THE SERVER IS ASKED WHO WE ARE RATHER THAN THE COOKIE BEING READ.
 * The session cookie is HttpOnly, which is the point of it — page scripts must
 * not be able to lift a credential. So the client cannot see whether it holds
 * one, and `status` is established by asking an endpoint that requires it.
 *
 * The nonce is fetched immediately before signing, not at mount. It has a
 * five-minute TTL and is consumed atomically, so one fetched early and left
 * sitting while the player reads the page is a nonce that has expired by the
 * time they press the button.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccount, useConnect, useSignMessage } from 'wagmi';
import type { Connector } from 'wagmi';
import { createSiweMessage } from 'viem/siwe';
import { base } from 'wagmi/chains';
import {
  playerSessionHeaders,
  getStoredPlayerSession,
  setStoredPlayerSession,
  clearStoredPlayerSession,
} from '../lib/playerSessionClient';

/**
 * The response `wallet_connect` gives when asked for the signInWithEthereum
 * capability: the wallet BUILDS the SIWE message and signs it itself, in the
 * same approval as the connection. This is the flow Base documents for Base
 * Accounts, and the only one that reliably works for them: our previous
 * approach — build the message ourselves and ask for a personal_sign — worked
 * for plain EOAs and silently failed EVERY Base Account sign-in for two days
 * (2026-08-26/27), because what came back did not verify as a signature over
 * our message. The returned signature carries the ERC-6492 wrapper, so the
 * server's existing viem verification accepts it even for undeployed wallets.
 */
interface WalletConnectSiweResponse {
  accounts?: Array<{
    address?: `0x${string}`;
    capabilities?: {
      signInWithEthereum?: { message?: string; signature?: `0x${string}` };
    };
  }>;
}

interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  /** Coinbase/Base injected providers self-identify with these flags. */
  isCoinbaseWallet?: boolean;
  isCoinbaseBrowser?: boolean;
}

/** Does this connector's provider speak the Base wallet_connect dialect? */
function speaksWalletConnectSiwe(connector: Connector | undefined, provider: unknown): boolean {
  if (!connector) return false;
  if (connector.id.toLowerCase().includes('base')) return true;
  const p = provider as Eip1193Provider | undefined;
  return !!(p && (p.isCoinbaseWallet || p.isCoinbaseBrowser));
}

export type WalletSignInStatus =
  /** Have not yet asked the server whether a session exists. */
  | 'checking'
  /** No session. The player needs to connect and/or sign. */
  | 'signed-out'
  /** Connecting the wallet, or waiting on the signature, or verifying it. */
  | 'pending'
  /** A session exists; `fid` is populated. */
  | 'signed-in';

export interface WalletSignIn {
  status: WalletSignInStatus;
  fid: number | null;
  address: `0x${string}` | undefined;
  isConnected: boolean;
  error: string | null;
  /**
   * Connect (if needed), sign, and exchange. Safe to call when connected.
   * 'base' puts the Base Account connector first — the branded Sign in with
   * Base button must never open MetaMask; 'auto' keeps the injected-first
   * order for the plain "use a different wallet" path.
   */
  signIn: (prefer?: 'base' | 'auto') => Promise<void>;
  /**
   * The server has definitively refused the session (a 401 on a real request).
   * Drops the stored token and returns the player to the sign-in card with
   * `message` shown, instead of leaving them in a game where every guess fails
   * the same way. ONLY for a definitive 401 — a 500 or a timeout says nothing
   * about the token and must not cost a wallet signature.
   */
  expireSession: (message?: string | null) => void;
}

export function useWalletSignIn(enabled: boolean): WalletSignIn {
  const { address, isConnected, connector: activeConnector } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { signMessageAsync } = useSignMessage();

  const [status, setStatus] = useState<WalletSignInStatus>('checking');
  const [fid, setFid] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Prefetched nonce, so the wallet popup opens without an awaited fetch
  // between the tap and the window.open — Safari's popup blocker kills
  // exactly that gap, and Base's own guide says to fetch ahead for this
  // reason. Refreshed whenever the sign-in card becomes visible; a nonce
  // lives five minutes server-side and is consumed once.
  const nonceRef = useRef<{ nonce: string; fetchedAt: number } | null>(null);

  const prefetchNonce = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/nonce');
      if (!res.ok) return;
      const { nonce } = (await res.json()) as { nonce: string };
      if (nonce) nonceRef.current = { nonce, fetchedAt: Date.now() };
    } catch {
      // Sign-in falls back to fetching inline.
    }
  }, []);

  useEffect(() => {
    if (enabled && status === 'signed-out') void prefetchNonce();
  }, [enabled, status, prefetchNonce]);

  /** Prefetched if fresh, fetched inline otherwise. Consumes the prefetch. */
  const takeNonce = useCallback(async (): Promise<string> => {
    const held = nonceRef.current;
    nonceRef.current = null;
    if (held && Date.now() - held.fetchedAt < 4 * 60_000) return held.nonce;
    const res = await fetch('/api/auth/nonce');
    if (!res.ok) throw new Error('Sign-in is temporarily unavailable');
    const { nonce } = (await res.json()) as { nonce: string };
    return nonce;
  }, []);

  // Does a session already exist? /api/auth/me answers from the cookie alone.
  //
  // `checking` is held until the server actually answers, and is RE-ENTERED
  // whenever `enabled` flips true. The obvious shape — force `signed-out` while
  // disabled, then fetch when enabled — is wrong in a way that costs a real
  // player: `enabled` starts false while `useIsInMiniApp` is still probing, so
  // the landing page would render "Connect wallet" during the genuine session
  // check, and a returning player could tap it and start a second SIWE flow
  // racing the cookie they already hold. Not knowing yet is `checking`, and the
  // sign-in card stays hidden until we do.
  useEffect(() => {
    if (!enabled) return;
    setStatus('checking');
    let cancelled = false;

    /**
     * ONLY A 401 MEANS THE TOKEN IS DEAD.
     *
     * An earlier version cleared the stored session on any non-ok response, so
     * a 500, a 503, a 429 or a dropped connection destroyed a valid 30-day
     * session and cost the player a fresh wallet signature to recover from
     * someone else's transient fault. On anything other than a definitive
     * refusal we keep the token and fall back to the fid stored beside it; the
     * next real request is where the server gets to decide, and if the token
     * truly is dead that request answers 401 and the player is prompted then.
     */
    const stored = getStoredPlayerSession();

    fetch('/api/auth/me', { headers: playerSessionHeaders() })
      .then(async (r) => {
        if (cancelled) return;

        if (r.ok) {
          const data = await r.json().catch(() => null);
          if (data?.fid) {
            setStoredPlayerSession(
              stored ? { ...stored, fid: data.fid } : null
            );
            setFid(data.fid);
            setStatus('signed-in');
            return;
          }
        }

        if (r.status === 401) {
          clearStoredPlayerSession();
          setFid(null);
          setStatus('signed-out');
          return;
        }

        // Server trouble, not a rejection.
        if (stored) {
          setFid(stored.fid);
          setStatus('signed-in');
        } else {
          setStatus('signed-out');
        }
      })
      .catch(() => {
        if (cancelled) return;
        // Network failure says nothing about the token either.
        if (stored) {
          setFid(stored.fid);
          setStatus('signed-in');
        } else {
          setStatus('signed-out');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const expireSession = useCallback((message?: string | null) => {
    clearStoredPlayerSession();
    setFid(null);
    setError(message ?? null);
    setStatus('signed-out');
  }, []);

  const signIn = useCallback(async (prefer: 'base' | 'auto' = 'auto') => {
    setError(null);
    setStatus('pending');

    try {
      // The nonce comes FIRST: for the Sign in with Base path the very next
      // thing is the wallet popup, and an awaited fetch between tap and popup
      // is what Safari's blocker kills. Prefetched when the card rendered;
      // this is usually instant.
      const nonce = await takeNonce();

      // Try connectors in order of what this host can actually do, and fall
      // through on failure rather than giving up on the first.
      //
      // Selecting `injected` by id alone is useless: it is in the config in
      // EVERY environment because we put it there, so it always matches and
      // `baseAccount` — the one added for plain web — would never be reached.
      // On a browser with no `window.ethereum` that means connect simply
      // fails with no fallback, which is precisely the case baseAccount
      // exists to serve. So the injected connector is offered only when an
      // injected provider is actually present, and Base Account is always
      // kept as the next candidate.
      const hasInjectedProvider =
        typeof window !== 'undefined' &&
        (window as unknown as { ethereum?: unknown }).ethereum != null;

      const injectedConnector = connectors.find((c) => c.id === 'injected');
      const baseConnector = connectors.find((c) => c.id.toLowerCase().includes('base'));

      // A connected wallet short-circuits preference: whatever the branded
      // button says, the wallet that must sign is the one already holding
      // the connection (it is also the wallet the reward gate reads).
      const candidates: Connector[] = address && activeConnector
        ? [activeConnector]
        : prefer === 'base'
          ? [
              ...(baseConnector ? [baseConnector] : []),
              ...(hasInjectedProvider && injectedConnector ? [injectedConnector] : []),
            ]
          : [
              ...(hasInjectedProvider && injectedConnector ? [injectedConnector] : []),
              ...(baseConnector ? [baseConnector] : []),
              // Anything else configured, minus the Farcaster connector: it
              // cannot work here by definition — this path only runs outside a
              // host.
              ...connectors.filter(
                (c) =>
                  c !== injectedConnector &&
                  c !== baseConnector &&
                  !c.id.toLowerCase().includes('farcaster')
              ),
            ];

      if (candidates.length === 0) throw new Error('No wallet connector available');

      // What the sign-in must produce, by either dialect.
      let account: `0x${string}` | undefined;
      let message: string | undefined;
      let signature: `0x${string}` | undefined;

      let lastError: unknown = null;
      for (const connector of candidates) {
        try {
          const provider = (await connector.getProvider().catch(() => null)) as
            | Eip1193Provider
            | null;

          if (provider && speaksWalletConnectSiwe(connector, provider)) {
            // SIGN IN WITH BASE. One approval: the wallet connects, builds
            // the SIWE message around OUR server nonce, and signs it —
            // including the ERC-6492 wrapper a smart account needs.
            const requestSiwe = async () =>
              (await provider.request({
                method: 'wallet_connect',
                params: [
                  {
                    version: '1',
                    capabilities: {
                      signInWithEthereum: { nonce, chainId: '0x2105' },
                    },
                  },
                ],
              })) as WalletConnectSiweResponse;

            const extract = (resp: WalletConnectSiweResponse) => {
              const acct = resp?.accounts?.[0];
              const siwe = acct?.capabilities?.signInWithEthereum;
              return acct?.address && siwe?.message && siwe?.signature
                ? { address: acct.address, message: siwe.message, signature: siwe.signature }
                : null;
            };

            let signed = extract(await requestSiwe());
            if (!signed) {
              // An already-connected session (the expireSession retry path —
              // wagmi stays connected when a session dies) can answer
              // wallet_connect without re-running the capability. Drop the
              // session and ask once more with the SAME nonce, which is only
              // consumed server-side at verification.
              await provider.request({ method: 'wallet_disconnect' }).catch(() => {});
              signed = extract(await requestSiwe());
            }
            if (!signed) {
              // NEVER degrade to personal_sign here: a Base Account
              // signature produced that way can never verify — that silent
              // degradation was two days of invisible sign-in failure. Fail
              // the WHOLE attempt: the loop's catch retries the next
              // connector on ordinary errors, and the next candidate after
              // Base is the injected one — which on a desktop with MetaMask
              // would open the wrong wallet from under the branded button.
              // The name marks it non-retryable for the catch below.
              const abort = new Error('Sign-in did not complete. Please try again.');
              abort.name = 'SignInAbortError';
              throw abort;
            }

            account = signed.address;
            message = signed.message;
            signature = signed.signature;
            // Bring wagmi's view of the connection in line with the SDK
            // session that wallet_connect just established, so balances and
            // purchases see the wallet. Best-effort: the session token is
            // what authenticates play, not wagmi state.
            if (!isConnected) {
              await connectAsync({ connector }).catch(() => {});
            }
            break;
          }

          // CLASSIC SIWE, for connectors that cannot speak wallet_connect
          // (MetaMask-style EOA wallets): connect, build the message
          // ourselves, ask for a personal_sign. Proven against production —
          // and never reached for a dialect-speaking connector, see above.
          let eoaAccount = address;
          if (!eoaAccount) {
            const result = await connectAsync({ connector });
            eoaAccount = result.accounts[0];
          }
          if (!eoaAccount) continue;

          const classicMessage = createSiweMessage({
            address: eoaAccount,
            chainId: base.id,
            domain: window.location.host,
            nonce,
            uri: window.location.origin,
            version: '1',
            statement: 'Sign in to Let’s Have A Word!',
          });
          account = eoaAccount;
          message = classicMessage;
          signature = await signMessageAsync({ message: classicMessage, account: eoaAccount });
          break;
        } catch (err) {
          // A user rejecting the first prompt must not silently open the
          // next one — that would be a second wallet popup they did not ask
          // for. Stop on rejection, and on a deliberate abort from the
          // dialect branch above; fall through only on genuine failures.
          const name = (err as { name?: string })?.name;
          const rejected =
            name === 'UserRejectedRequestError' ||
            /user rejected|denied/i.test((err as { message?: string })?.message ?? '');
          if (rejected || name === 'SignInAbortError') throw err;
          lastError = err;
        }
      }

      if (!account || !message || !signature) {
        throw lastError ?? new Error('Could not connect a wallet');
      }

      // The referral code, if this player arrived through someone's link. Read
      // from the URL rather than stored, so it cannot outlive the visit.
      const ref =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('ref')
          : null;

      const verifyRes = await fetch('/api/auth/siwe', {
        method: 'POST',
        // playerSessionHeaders carries no token here (that is what we are
        // acquiring) — it contributes the x-lhaw-build header, so a sign-in
        // from a stale client is attributable server-side.
        headers: { 'Content-Type': 'application/json', ...playerSessionHeaders() },
        body: JSON.stringify({ message, signature, ref: ref ? Number(ref) : undefined }),
      });

      const data = await verifyRes.json().catch(() => null);
      if (!verifyRes.ok || !data?.success) {
        throw new Error(data?.error || 'Sign-in failed');
      }

      // Held because Base App's webview will not return the cookie. Harmless
      // where the cookie does work: the server tries the cookie first.
      if (data.sessionToken) setStoredPlayerSession({ token: data.sessionToken, fid: data.fid });

      setFid(data.fid);
      setStatus('signed-in');
    } catch (err: any) {
      // A rejected signature is a decision, not a fault — say nothing alarming.
      const rejected =
        err?.name === 'UserRejectedRequestError' ||
        /user rejected|denied/i.test(err?.message ?? '');
      setError(rejected ? null : err?.message || 'Sign-in failed');
      setStatus('signed-out');
    }
  }, [address, activeConnector, isConnected, connectAsync, connectors, signMessageAsync, takeNonce]);

  return { status, fid, address, isConnected, error, signIn, expireSession };
}

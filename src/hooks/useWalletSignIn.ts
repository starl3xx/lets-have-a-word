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

import { useCallback, useEffect, useState } from 'react';
import { useAccount, useConnect, useSignMessage } from 'wagmi';
import { createSiweMessage } from 'viem/siwe';
import { base } from 'wagmi/chains';
import {
  playerSessionHeaders,
  setStoredPlayerSession,
  clearStoredPlayerSession,
} from '../lib/playerSessionClient';

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
  /** Connect (if needed), sign, and exchange. Safe to call when connected. */
  signIn: () => Promise<void>;
}

export function useWalletSignIn(enabled: boolean): WalletSignIn {
  const { address, isConnected } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { signMessageAsync } = useSignMessage();

  const [status, setStatus] = useState<WalletSignInStatus>('checking');
  const [fid, setFid] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    fetch('/api/auth/me', { headers: playerSessionHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.fid) {
          setFid(data.fid);
          setStatus('signed-in');
        } else {
          // Whatever we were holding is no longer accepted. Drop it rather than
          // presenting a dead token on every subsequent request.
          clearStoredPlayerSession();
          setStatus('signed-out');
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('signed-out');
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const signIn = useCallback(async () => {
    setError(null);
    setStatus('pending');

    try {
      let account = address;

      if (!account) {
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

        const candidates = [
          ...(hasInjectedProvider && injectedConnector ? [injectedConnector] : []),
          ...(baseConnector ? [baseConnector] : []),
          // Anything else configured, minus the Farcaster connector: it cannot
          // work here by definition — this path only runs outside a host.
          ...connectors.filter(
            (c) =>
              c !== injectedConnector &&
              c !== baseConnector &&
              !c.id.toLowerCase().includes('farcaster')
          ),
        ];

        if (candidates.length === 0) throw new Error('No wallet connector available');

        let lastError: unknown = null;
        for (const connector of candidates) {
          try {
            const result = await connectAsync({ connector });
            account = result.accounts[0];
            if (account) break;
          } catch (err) {
            // A user rejecting the first prompt must not silently open the
            // next one — that would be a second wallet popup they did not ask
            // for. Stop on rejection; fall through only on genuine failures.
            const rejected =
              (err as { name?: string })?.name === 'UserRejectedRequestError' ||
              /user rejected|denied/i.test((err as { message?: string })?.message ?? '');
            if (rejected) throw err;
            lastError = err;
          }
        }
        if (!account) throw lastError ?? new Error('Could not connect a wallet');
      }

      if (!account) throw new Error('No account returned by the wallet');

      // Fetched here rather than at mount: a nonce lives five minutes and is
      // consumed once, so one issued while the player was still reading would
      // already be dead.
      const nonceRes = await fetch('/api/auth/nonce');
      if (!nonceRes.ok) throw new Error('Sign-in is temporarily unavailable');
      const { nonce } = (await nonceRes.json()) as { nonce: string };

      // The referral code, if this player arrived through someone's link. Read
      // from the URL rather than stored, so it cannot outlive the visit.
      const ref =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('ref')
          : null;

      const message = createSiweMessage({
        address: account,
        chainId: base.id,
        domain: window.location.host,
        nonce,
        uri: window.location.origin,
        version: '1',
        statement: 'Sign in to Let’s Have A Word!',
      });

      const signature = await signMessageAsync({ message, account });

      const verifyRes = await fetch('/api/auth/siwe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, signature, ref: ref ? Number(ref) : undefined }),
      });

      const data = await verifyRes.json().catch(() => null);
      if (!verifyRes.ok || !data?.success) {
        throw new Error(data?.error || 'Sign-in failed');
      }

      // Held because Base App's webview will not return the cookie. Harmless
      // where the cookie does work: the server tries the cookie first.
      if (data.sessionToken) setStoredPlayerSession(data.sessionToken);

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
  }, [address, connectAsync, connectors, signMessageAsync]);

  return { status, fid, address, isConnected, error, signIn };
}

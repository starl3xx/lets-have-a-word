/**
 * Auth Verify Endpoint
 *
 * POST /api/auth/verify
 * Verifies a Sign In With Farcaster (SIWF) credential and returns the FID
 *
 * Request body:
 * {
 *   "message": "...", // The SIWF message
 *   "signature": "...", // The signature
 *   "nonce": "...", // The nonce used
 *   "playerSession": true, // Optional: also return a player session token
 *   "ref": 123 // Optional, with playerSession: the referrer FID
 * }
 *
 * Response:
 * {
 *   "fid": 12345,
 *   "success": true,
 *   "sessionToken": "..." // Only when playerSession was asked for
 * }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
import { createAppClient, viemConnector } from '@farcaster/auth-client';
import { verifyAndConsumeNonce } from './nonce';
import { isAdminFid } from '../admin/me';
import {
  signAdminSession,
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
} from '../../../src/lib/adminSession';
import {
  signPlayerSession,
  FARCASTER_FALLBACK_SESSION_TTL_SECONDS,
} from '../../../src/lib/playerSession';
import { upsertUserFromFarcaster } from '../../../src/lib/users';

/**
 * Farcaster auth client for SIWF verification.
 *
 * The connector talks to Optimism, because verifying a SIWF signature means
 * resolving the custody address to a FID onchain (and, since auth-client 0.7,
 * checking auth addresses). An explicit RPC is passed rather than relying on
 * the default: with none supplied the library falls back to the public
 * endpoint and logs "Do not use this in production". A rate-limited public RPC
 * would make admin sign-in fail intermittently, which is the worst kind of
 * auth failure — it looks like a wrong key rather than an outage.
 *
 * OPTIMISM_RPC_URL is optional; unset simply restores the previous behaviour.
 */
const appClient = createAppClient({
  ethereum: process.env.OPTIMISM_RPC_URL
    ? viemConnector({ rpcUrl: process.env.OPTIMISM_RPC_URL })
    : viemConnector(),
});

interface VerifyRequest {
  message: string;
  signature: string;
  nonce: string;
  /** Ask for a player session too. Sent by the guess path's Quick Auth fallback. */
  playerSession?: boolean;
  /** Referrer FID, used only with playerSession. */
  ref?: unknown;
}

interface VerifyResponse {
  success: boolean;
  fid?: number;
  /** True when an admin session cookie was issued alongside this response. */
  adminSession?: boolean;
  /** A one-hour player session, present only when playerSession was asked for. */
  sessionToken?: string;
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<VerifyResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { message, signature, nonce, playerSession, ref } = req.body as VerifyRequest;

  if (!message || !signature || !nonce) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: message, signature, nonce',
    });
  }

  // Verify nonce hasn't been used and isn't expired
  if (!(await verifyAndConsumeNonce(nonce))) {
    return res.status(400).json({
      success: false,
      error: 'Invalid or expired nonce',
    });
  }

  try {
    // Verify the SIWF message signature
    const result = await appClient.verifySignInMessage({
      message,
      signature: signature as `0x${string}`,
      domain: 'letshaveaword.fun',
      nonce,
    });

    if (!result.success || !result.fid) {
      console.error('[auth/verify] Verification failed:', result);
      return res.status(401).json({
        success: false,
        error: 'Invalid signature',
      });
    }

    console.log(`[auth/verify] Successfully verified FID ${result.fid}`);

    // A verified signature only authenticates THIS request. Without minting
    // something the client cannot forge, the next request would be back to
    // taking the caller's word for their FID — which is the exact hole the
    // `?devFid=` pattern was. So admins get a signed, HttpOnly session here.
    //
    // Non-admins still get a successful verification; they simply get no
    // session, because there is nothing for them to hold one for.
    const adminSecret = process.env.ADMIN_SECRET;
    let adminSession = false;

    if (isAdminFid(result.fid) && adminSecret) {
      const token = await signAdminSession(result.fid, adminSecret);
      res.setHeader(
        'Set-Cookie',
        // HttpOnly so page scripts cannot read it — unlike the ADMIN_SECRET
        // cookie it supersedes, which the admin page had to set itself.
        // SameSite=Strict because no admin action should ever be reachable
        // from another origin.
        `${ADMIN_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ADMIN_SESSION_TTL_SECONDS}${
          process.env.NODE_ENV === 'production' ? '; Secure' : ''
        }`
      );
      adminSession = true;
      console.log(`[auth/verify] Issued admin session for FID ${result.fid}`);
    }

    // THE QUICK AUTH FALLBACK. A Farcaster guess normally carries a Quick Auth
    // JWT, which Farcaster's own server issues after it checks this same kind
    // of signature. From 01:00 UTC on 2026-10-14 that server answered 500 to
    // every player who opened the game (Sentry LETS-HAVE-A-WORD-32), and none of
    // them could guess. The
    // check above is the one it makes: the signer must be the FID's custody
    // address or an auth address the Key Registry lists for it, the domain
    // must be ours, and the nonce must be one we issued and have now spent.
    // So a player who passes it gets a player session that resolveRequestFid
    // already accepts.
    //
    // Only when asked for, so admin sign-in does exactly what it did before.
    // One hour, because the mini app can sign again with no prompt. Returned
    // in the body and never set as a cookie: the client holds it in memory for
    // the page, and a cookie would keep a Farcaster identity in a webview's jar
    // after the page that needed it has gone.
    let sessionToken: string | undefined;
    if (playerSession === true) {
      if (!adminSecret) {
        // The player session key is derived from this secret. No secret, no
        // minting: the client then refuses the guess, as it did before.
        console.error('[auth/verify] ADMIN_SECRET is not set — no player session');
      } else {
        try {
          // The guess path creates the row on each Quick Auth guess. A session
          // guess skips that step, so the row is made here, before the token
          // exists. First referrer wins, inside the upsert.
          const referrerFid = Number.isInteger(Number(ref)) && Number(ref) > 0 ? Number(ref) : null;
          await upsertUserFromFarcaster({
            fid: result.fid,
            signerWallet: null,
            spamScore: null,
            referrerFid,
          });
          sessionToken = await signPlayerSession(
            { fid: result.fid, origin: 'farcaster' },
            adminSecret,
            FARCASTER_FALLBACK_SESSION_TTL_SECONDS
          );
          console.log(`[auth/verify] Issued Quick Auth fallback session for FID ${result.fid}`);
        } catch (error) {
          // The signature was good, so report success without a token. The
          // client treats a missing token as a failed sign-in.
          console.error('[auth/verify] Could not issue a player session:', error);
          Sentry.captureException(error, { tags: { endpoint: 'auth-verify' } });
        }
      }
    }

    return res.status(200).json({
      success: true,
      fid: result.fid,
      adminSession,
      sessionToken,
    });
  } catch (error) {
    console.error('[auth/verify] Error verifying signature:', error);
    return res.status(500).json({
      success: false,
      error: 'Verification failed',
    });
  }
}

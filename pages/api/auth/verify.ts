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
 *   "nonce": "..." // The nonce used
 * }
 *
 * Response:
 * {
 *   "fid": 12345,
 *   "success": true
 * }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createAppClient, viemConnector } from '@farcaster/auth-client';
import { verifyAndConsumeNonce } from './nonce';
import { isAdminFid } from '../admin/me';
import {
  signAdminSession,
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
} from '../../../src/lib/adminSession';

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
}

interface VerifyResponse {
  success: boolean;
  fid?: number;
  /** True when an admin session cookie was issued alongside this response. */
  adminSession?: boolean;
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<VerifyResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { message, signature, nonce } = req.body as VerifyRequest;

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

    return res.status(200).json({
      success: true,
      fid: result.fid,
      adminSession,
    });
  } catch (error) {
    console.error('[auth/verify] Error verifying signature:', error);
    return res.status(500).json({
      success: false,
      error: 'Verification failed',
    });
  }
}

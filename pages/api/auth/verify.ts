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

// Create Farcaster auth client for verification
const appClient = createAppClient({
  ethereum: viemConnector(),
});

interface VerifyRequest {
  message: string;
  signature: string;
  nonce: string;
}

interface VerifyResponse {
  success: boolean;
  fid?: number;
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
  if (!verifyAndConsumeNonce(nonce)) {
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

    return res.status(200).json({
      success: true,
      fid: result.fid,
    });
  } catch (error) {
    console.error('[auth/verify] Error verifying signature:', error);
    return res.status(500).json({
      success: false,
      error: 'Verification failed',
    });
  }
}

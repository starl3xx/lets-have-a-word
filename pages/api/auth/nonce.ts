/**
 * Auth Nonce Endpoint
 *
 * GET /api/auth/nonce
 * Returns a random nonce for Sign In With Farcaster (SIWF)
 *
 * The nonce prevents replay attacks and should be verified server-side
 * when the signed message is received.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';

// Simple in-memory nonce store with expiration
// In production, use Redis or database
const nonceStore = new Map<string, { createdAt: number }>();
const NONCE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

// Clean up expired nonces periodically
function cleanupExpiredNonces() {
  const now = Date.now();
  for (const [nonce, data] of nonceStore.entries()) {
    if (now - data.createdAt > NONCE_EXPIRY_MS) {
      nonceStore.delete(nonce);
    }
  }
}

// Generate a secure random nonce
function generateNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}

// Verify and consume a nonce (one-time use)
export function verifyAndConsumeNonce(nonce: string): boolean {
  cleanupExpiredNonces();
  const data = nonceStore.get(nonce);
  if (!data) return false;

  // Check expiration
  if (Date.now() - data.createdAt > NONCE_EXPIRY_MS) {
    nonceStore.delete(nonce);
    return false;
  }

  // Consume the nonce (one-time use)
  nonceStore.delete(nonce);
  return true;
}

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ nonce: string } | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  cleanupExpiredNonces();

  const nonce = generateNonce();
  nonceStore.set(nonce, { createdAt: Date.now() });

  return res.status(200).json({ nonce });
}

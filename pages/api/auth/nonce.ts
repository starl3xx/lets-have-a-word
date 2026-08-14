/**
 * Auth Nonce Endpoint
 *
 * GET /api/auth/nonce
 * Returns a single-use nonce for Sign In With Farcaster (SIWF).
 *
 * The nonce prevents replay: a signed SIWF message is only accepted once, and
 * only within the window below.
 *
 * STORED IN REDIS, NOT IN MEMORY.
 *
 * This previously used a module-level `Map`, with a comment saying to use Redis
 * in production. On Vercel that does not merely scale badly — it is wrong.
 * Every serverless instance has its own memory, so a nonce issued by one
 * instance is unknown to the instance that receives the signed message, and
 * verification fails. It would pass locally, where there is one process, and
 * fail intermittently in production in proportion to how many instances were
 * warm. That is very likely why the SIWF path was built and never switched on.
 *
 * Redis also gives the property the Map could not: consumption is atomic
 * across instances, so the same nonce cannot be redeemed twice by two
 * concurrent requests.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import { redis } from '../../../src/lib/redis';

const NONCE_TTL_SECONDS = 5 * 60;
const NONCE_PREFIX = 'siwf:nonce:';

function generateNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Verify and consume a nonce. One-time use.
 *
 * Uses GETDEL so the read and the delete are a single atomic operation. With a
 * separate GET then DEL, two requests presenting the same nonce could both see
 * it before either removed it, and both would be accepted — which is precisely
 * the replay the nonce exists to stop.
 *
 * Fails CLOSED. If Redis is unavailable this returns false and the sign-in is
 * refused. That is the opposite of the rate limiter's policy, deliberately:
 * failing open on a rate limit costs you some spam, failing open here would
 * accept unverified sign-ins to an admin surface during an outage.
 */
export async function verifyAndConsumeNonce(nonce: string): Promise<boolean> {
  if (!redis) {
    console.error('[auth/nonce] Redis unavailable — refusing sign-in');
    return false;
  }

  try {
    const key = `${NONCE_PREFIX}${nonce}`;
    const existing = await redis.getdel(key);
    return existing !== null && existing !== undefined;
  } catch (error) {
    console.error('[auth/nonce] Error consuming nonce:', error);
    return false;
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ nonce: string } | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!redis) {
    return res.status(503).json({ error: 'Sign-in temporarily unavailable' });
  }

  try {
    const nonce = generateNonce();
    await redis.set(`${NONCE_PREFIX}${nonce}`, Date.now(), { ex: NONCE_TTL_SECONDS });
    return res.status(200).json({ nonce });
  } catch (error) {
    console.error('[auth/nonce] Failed to issue nonce:', error);
    return res.status(503).json({ error: 'Sign-in temporarily unavailable' });
  }
}

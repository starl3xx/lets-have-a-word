/**
 * Who does this browser's player session say it is?
 *
 * GET /api/auth/me -> { fid, origin, wallet? } | 401
 *
 * The session cookie is HttpOnly — deliberately, so page scripts cannot lift a
 * credential — which means the client has no way to tell whether it holds one.
 * This is how it asks. It reads nothing but the cookie: no wallet connection,
 * no chain call, no database round-trip.
 *
 * Returns 401 rather than 200-with-null for the absent case so a caller can
 * branch on `res.ok` without parsing, and so an expired session is
 * indistinguishable from never having had one.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import type { PlayerOrigin } from '../../../src/lib/playerSession';
import { resolvePlayerSessionFromRequest } from '../../../src/lib/requestAuth';

interface MeResponse {
  fid: number;
  origin: PlayerOrigin;
  wallet?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<MeResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // The SAME resolver the game endpoints use, so this can never disagree
  // with them about who is signed in. It tries every presented token: on
  // 2026-08-27 a dead cookie pinned in Base App's webview jar shadowed the
  // freshly minted header token here AND on /api/guess, which read as
  // "signed in, but every guess is a 401" — a permanent lockout the client
  // could not clear, because the jar cookie is HttpOnly and the webview
  // never honors an overwrite.
  const { session } = await resolvePlayerSessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ error: 'Not signed in' });
  }

  // Never cached: a session that has just been minted or has just expired must
  // not be served from an intermediary's copy of someone else's answer.
  res.setHeader('Cache-Control', 'no-store, private');

  return res.status(200).json({
    fid: session.fid,
    origin: session.origin,
    wallet: session.wallet,
  });
}

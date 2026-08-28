/**
 * Step 1 of linking a Base App wallet to an existing Farcaster account.
 *
 * POST /api/auth/link-code  ->  { code, expiresInSeconds }
 *
 * WHY A TWO-SESSION HANDSHAKE AND NOT ONE CALL. Neither side can prove both
 * identities alone. Inside the Farcaster mini app the connected wallet is the
 * player's Farcaster wallet, so they cannot produce a Base Account signature
 * there. Inside Base App there is no Farcaster host, so they cannot produce a
 * Quick Auth token. The only thing that spans both is the player: they hold a
 * Quick Auth session here, carry a short code across, and redeem it with a SIWE
 * session on the other side. Each half is independently authenticated and the
 * code is what ties them together.
 *
 * FARCASTER SESSIONS ONLY. A wallet player has nothing to link TO — the point
 * is to reach an existing Farcaster account — so a player-session caller is
 * refused rather than quietly issued a code that could only link a wallet to
 * another wallet.
 *
 * Fails CLOSED without Redis, exactly like the SIWE nonce: no store, no code.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { redis } from '../../../src/lib/redis';
import { resolveRequestFid } from '../../../src/lib/requestAuth';
import { isWalletFid } from '../../../src/lib/wallet-fid';

const CODE_PREFIX = 'lhaw:linkcode:';
/** Ten minutes: long enough to switch apps, short enough that a leaked code dies. */
export const LINK_CODE_TTL_SECONDS = 600;

/**
 * Six characters from an unambiguous alphabet — no O/0, no I/1/L — because a
 * player reads this off one screen and types it into another.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export async function consumeLinkCode(code: string): Promise<number | null> {
  if (!redis) return null;
  try {
    // GETDEL: read and delete atomically, so two redemptions of one code
    // cannot both succeed.
    const fid = await redis.getdel(`${CODE_PREFIX}${code.toUpperCase()}`);
    if (fid === null || fid === undefined) return null;
    const parsed = typeof fid === 'number' ? fid : parseInt(String(fid), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  } catch (error) {
    console.error('[auth/link-code] Error consuming code:', error);
    return null;
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ code: string; expiresInSeconds: number } | { error: string }>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!redis) {
    return res.status(503).json({ error: 'Linking is temporarily unavailable' });
  }

  const auth = await resolveRequestFid(req, { rejectUnverifiedMiniAppFid: true });
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  // The caller must BE a Farcaster account. A wallet player has nothing to
  // link to, and letting one issue a code would only ever join two wallets.
  if (auth.origin === 'player_session' || isWalletFid(auth.fid)) {
    return res
      .status(400)
      .json({ error: 'Open this in Farcaster to link your Base app wallet' });
  }

  try {
    const code = generateCode();
    await redis.set(`${CODE_PREFIX}${code}`, auth.fid, { ex: LINK_CODE_TTL_SECONDS });
    console.log(`[auth/link-code] Issued a link code for FID ${auth.fid}`);
    return res.status(200).json({ code, expiresInSeconds: LINK_CODE_TTL_SECONDS });
  } catch (error) {
    console.error('[auth/link-code] Failed to issue code:', error);
    return res.status(503).json({ error: 'Linking is temporarily unavailable' });
  }
}

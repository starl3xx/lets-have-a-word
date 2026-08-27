/**
 * Sign-In With Ethereum — the wallet-native door.
 *
 * POST /api/auth/siwe  { message, signature }
 *
 * The Base App counterpart to /api/auth/verify. Base App stopped hosting
 * Farcaster mini apps on 2026-04-09, so a player arriving from it has a wallet
 * and no FID, and SIWE is the only thing they can present. A verified signature
 * is exchanged for a player session cookie exactly as a verified SIWF signature
 * is exchanged for an admin one — a signature authenticates a single request,
 * and anything less than a minted token puts us back to trusting a client-sent
 * `fid`.
 *
 * THE SIGNATURE IS USUALLY NOT AN ECDSA SIGNATURE.
 *
 * Base App wallets are Base Accounts — smart contracts. What they return is an
 * ERC-1271 (often ERC-6492, if the account is not deployed yet) signature,
 * which `ecrecover` cannot validate: verifying it means CALLING the wallet
 * contract. That is why a public client is passed to `verifySiweMessage` and
 * why this endpoint needs an RPC. A verifier written for EOAs would reject
 * essentially every real Base App user while working perfectly against a test
 * private key, which is the sort of thing that ships.
 *
 * The nonce store is shared with SIWF (`verifyAndConsumeNonce`), so replay
 * protection is the same atomic GETDEL and the same fail-closed posture: no
 * Redis, no sign-in. Gameplay fails open; authentication does not.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { parseSiweMessage, verifySiweMessage } from 'viem/siwe';
import { verifyAndConsumeNonce } from './nonce';
import { upsertUserFromWallet } from '../../../src/lib/users';
import {
  signPlayerSession,
  PLAYER_SESSION_COOKIE,
  PLAYER_SESSION_TTL_SECONDS,
} from '../../../src/lib/playerSession';

/**
 * Domains this server will accept a signature for.
 *
 * A SIWE message names the site it was signed for. Without checking it, a
 * signature a player produced for some other dapp could be replayed here and
 * would verify perfectly — the cryptography is fine, it is simply consent to a
 * different thing. Localhost is allowed outside production only.
 */
const ALLOWED_DOMAINS = new Set(
  [
    'letshaveaword.fun',
    'www.letshaveaword.fun',
    ...(process.env.NODE_ENV === 'production' ? [] : ['localhost:3000', 'localhost']),
  ].map((d) => d.toLowerCase())
);

interface SiweResponse {
  success: boolean;
  fid?: number;
  /** Present on success so the client can show who it signed in as. */
  wallet?: string;
  /**
   * The same token as the cookie, handed to the client directly.
   *
   * This forfeits HttpOnly for clients that choose to store it, which is a real
   * cost and taken deliberately: Base App's webview accepts the cookie here and
   * never sends it back, so for those players HttpOnly protects a credential
   * that is never transmitted. The cookie is still set and is still preferred
   * wherever it works.
   */
  sessionToken?: string;
  error?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<SiweResponse>) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    // Fails closed. The player session key is derived from this secret, so with
    // no secret there is nothing to sign with — and minting under a default
    // would be worse than refusing.
    console.error('[auth/siwe] ADMIN_SECRET is not set — wallet sign-in is unavailable');
    return res.status(503).json({ success: false, error: 'Sign-in is unavailable' });
  }

  const { message, signature } = req.body as { message?: string; signature?: string };
  if (!message || !signature) {
    return res
      .status(400)
      .json({ success: false, error: 'Missing required fields: message, signature' });
  }

  let parsed: ReturnType<typeof parseSiweMessage>;
  try {
    parsed = parseSiweMessage(message);
  } catch {
    return res.status(400).json({ success: false, error: 'Malformed SIWE message' });
  }

  const { address, domain, nonce } = parsed;
  if (!address || !domain || !nonce) {
    return res
      .status(400)
      .json({ success: false, error: 'SIWE message is missing address, domain or nonce' });
  }

  if (!ALLOWED_DOMAINS.has(domain.toLowerCase())) {
    console.warn(`[auth/siwe] Refused a signature bound to domain "${domain}"`);
    return res.status(401).json({ success: false, error: 'Signature is not for this site' });
  }

  // Consume the nonce BEFORE the RPC round-trip, so a flood of replays cannot
  // be used to hammer the node. GETDEL is atomic, so two concurrent requests
  // presenting one nonce cannot both proceed.
  if (!(await verifyAndConsumeNonce(nonce))) {
    return res.status(400).json({ success: false, error: 'Invalid or expired nonce' });
  }

  try {
    const client = createPublicClient({
      chain: base,
      transport: http(process.env.BASE_RPC_URL || 'https://mainnet.base.org'),
    });

    // Passing the client is what enables ERC-1271/6492 verification. `domain`
    // and `nonce` are re-asserted here rather than trusted from the parse, so
    // the check is made by the library against the signed bytes.
    const valid = await verifySiweMessage(client, { message, signature: signature as `0x${string}`, domain, nonce });

    if (!valid) {
      console.warn(`[auth/siwe] Invalid signature for ${address}`);
      return res.status(401).json({ success: false, error: 'Invalid signature' });
    }

    // Referral, if the link carried one. Only ever used to fill an empty
    // referrer — upsertUserFromWallet enforces first-referrer-wins.
    const refRaw = req.body?.ref;
    const referrerFid = Number.isInteger(Number(refRaw)) && Number(refRaw) > 0 ? Number(refRaw) : null;

    const user = await upsertUserFromWallet({ wallet: address, referrerFid });

    const token = await signPlayerSession(
      { fid: user.fid, origin: 'wallet', wallet: address },
      secret
    );

    res.setHeader(
      'Set-Cookie',
      // HttpOnly so page scripts cannot lift it. SameSite=Lax rather than
      // Strict: the game is opened from cast embeds and Base App links, and
      // Strict would drop the cookie on exactly those cross-site navigations,
      // signing the player out every time they arrive from a share.
      `${PLAYER_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${PLAYER_SESSION_TTL_SECONDS}${
        process.env.NODE_ENV === 'production' ? '; Secure' : ''
      }`
    );

    console.log(`[auth/siwe] Signed in ${address} as FID ${user.fid} (${user.identityOrigin})`);

    return res.status(200).json({
      success: true,
      fid: user.fid,
      wallet: address.toLowerCase(),
      sessionToken: token,
    });
  } catch (error) {
    console.error('[auth/siwe] Verification error:', error);
    return res.status(500).json({ success: false, error: 'Sign-in failed' });
  }
}

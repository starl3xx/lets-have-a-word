/**
 * Step 2 of linking a Base App wallet to an existing Farcaster account.
 *
 * POST /api/auth/link-redeem  { code }  ->  { fid, sessionToken }
 *
 * The caller must hold a WALLET session, so the address is one they proved
 * control of via SIWE. The code proves the other half: it was issued to a
 * Quick Auth session minutes earlier, so whoever holds it demonstrably
 * controlled that Farcaster account. Two independent proofs, joined here.
 *
 * WHAT LINKING DOES AND DOES NOT DO. It writes the address into
 * user_addresses, so every future sign-in from this wallet resolves to the
 * Farcaster account — with its grandfathering, Wordmarks, XP and history
 * intact. It does NOT move guesses already made on the synthetic wallet row,
 * and it does NOT touch signer_wallet_address, which is the payout address:
 * silently redirecting where a player's winnings go is not something a link
 * flow should do.
 *
 * A fresh session is minted for the Farcaster FID, because the caller's
 * existing session names the synthetic one and every later request would
 * otherwise keep resolving to the account they just linked away from.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../src/db';
import { users, userAddresses } from '../../../src/db/schema';
import { eq, sql } from 'drizzle-orm';
import { resolveRequestFid } from '../../../src/lib/requestAuth';
import { isWalletFid } from '../../../src/lib/wallet-fid';
import { consumeLinkCode } from './link-code';
import {
  signPlayerSession,
  PLAYER_SESSION_COOKIE,
  PLAYER_SESSION_TTL_SECONDS,
} from '../../../src/lib/playerSession';

interface RedeemResponse {
  fid: number;
  username: string | null;
  sessionToken: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<RedeemResponse | { error: string }>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    console.error('[auth/link-redeem] ADMIN_SECRET is not set');
    return res.status(503).json({ error: 'Linking is unavailable' });
  }

  const auth = await resolveRequestFid(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  // Only a wallet session can redeem: the whole point is to attach the address
  // this session proved control of.
  if (auth.origin !== 'player_session' || !auth.provenWallet) {
    return res.status(400).json({ error: 'Sign in with your wallet first' });
  }

  const { code } = (req.body ?? {}) as { code?: string };
  if (!code || typeof code !== 'string' || code.trim().length < 4) {
    return res.status(400).json({ error: 'Enter the code from Farcaster' });
  }

  const farcasterFid = await consumeLinkCode(code.trim());
  if (!farcasterFid) {
    // Expired, already used, or never existed. All the same to the caller —
    // distinguishing them only helps someone guessing codes.
    return res.status(400).json({ error: 'That code has expired. Generate a new one.' });
  }

  if (isWalletFid(farcasterFid)) {
    // Cannot happen: link-code refuses wallet callers. Belt and braces, because
    // linking a wallet to a wallet would be a silent identity swap.
    console.error(`[auth/link-redeem] Code resolved to a wallet fid ${farcasterFid}`);
    return res.status(400).json({ error: 'That code cannot be used here' });
  }

  const wallet = auth.provenWallet.toLowerCase();

  const [target] = await db
    .select({ fid: users.fid, username: users.username })
    .from(users)
    .where(eq(users.fid, farcasterFid))
    .limit(1);

  if (!target) {
    return res.status(404).json({ error: 'That account no longer exists' });
  }

  try {
    // onConflictDoNothing against the unique index on lower(address): an
    // address vouches for exactly one player, so a second link attempt for the
    // same wallet is a no-op rather than a way to attach it to two accounts and
    // double the daily allocation the reward gate bounds per wallet.
    await db
      .insert(userAddresses)
      .values({ fid: farcasterFid, address: wallet, linkedVia: 'link_code' })
      .onConflictDoNothing();

    const [existingLink] = await db
      .select({ fid: userAddresses.fid })
      .from(userAddresses)
      .where(sql`lower(${userAddresses.address}) = ${wallet}`)
      .limit(1);

    if (existingLink && existingLink.fid !== farcasterFid) {
      // Already vouching for somebody else. Refuse rather than move it.
      console.warn(
        `[auth/link-redeem] ${wallet} already links to FID ${existingLink.fid}, refusing ${farcasterFid}`
      );
      return res
        .status(409)
        .json({ error: 'This wallet is already linked to another account' });
    }
  } catch (error) {
    console.error('[auth/link-redeem] Failed to record link:', error);
    return res.status(500).json({ error: 'Could not link that account' });
  }

  // The caller's current session names the synthetic wallet FID. Re-mint for
  // the account they just proved they own, or every later request keeps
  // resolving to the identity they linked away from.
  const token = await signPlayerSession(
    { fid: target.fid, origin: 'farcaster', wallet },
    secret
  );

  res.setHeader(
    'Set-Cookie',
    `${PLAYER_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${PLAYER_SESSION_TTL_SECONDS}${
      process.env.NODE_ENV === 'production' ? '; Secure' : ''
    }`
  );

  console.log(`[auth/link-redeem] Linked ${wallet} to FID ${target.fid}`);

  return res.status(200).json({
    fid: target.fid,
    username: target.username ?? null,
    sessionToken: token,
  });
}

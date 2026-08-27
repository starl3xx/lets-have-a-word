/**
 * POST /api/admin/operational/clear-sentinel-wallet?devFid=XXXX
 *
 * ONE-INCIDENT ENDPOINT — delete after the round-34 Base App sign-in incident
 * closes (see CLAUDE.md: one-incident code is born with an expiry).
 *
 * A sentinel row (fid -1, created 2026-01-01) holds a real player's Base
 * Account address in `signer_wallet_address`, so every Sign in with Base
 * linked that player to fid -1 and minted a session the verifier refuses.
 * The code now guards against this twice over (linkage filter + mint-time
 * invariant), but the data itself still points the wallet at the sentinel.
 * This clears it, restricted to non-positive fids so no real player row can
 * ever be touched, and removes the junk daily state the incident created.
 *
 * Body: { fid: number (must be <= 0), expectedWallet: string }
 * The wallet must match what the row currently holds — a stale assumption
 * about the data refuses rather than clearing the wrong thing.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../../src/db';
import { users, dailyGuessState } from '../../../../src/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { isAdminFid } from '../me';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const devFid = parseInt(req.query.devFid as string, 10);
  if (!devFid || !isAdminFid(devFid)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { fid, expectedWallet } = (req.body ?? {}) as { fid?: number; expectedWallet?: string };

  if (typeof fid !== 'number' || !Number.isInteger(fid) || fid > 0) {
    // The whole safety of this endpoint: only sentinel rows are reachable.
    return res.status(400).json({ error: 'fid must be a non-positive integer (sentinel rows only)' });
  }
  if (typeof expectedWallet !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(expectedWallet)) {
    return res.status(400).json({ error: 'expectedWallet must be a 0x address' });
  }

  const cleared = await db
    .update(users)
    .set({ signerWalletAddress: null, updatedAt: new Date() })
    .where(
      and(
        eq(users.fid, fid),
        sql`lower(${users.signerWalletAddress}) = ${expectedWallet.toLowerCase()}`
      )
    )
    .returning({ fid: users.fid });

  if (cleared.length === 0) {
    return res.status(409).json({
      error: 'No row matched — the fid does not hold that wallet. Nothing was changed.',
    });
  }

  const removedState = await db
    .delete(dailyGuessState)
    .where(eq(dailyGuessState.fid, fid))
    .returning({ fid: dailyGuessState.fid });

  console.log(
    `[clear-sentinel-wallet] fid ${fid}: wallet cleared, ${removedState.length} daily-state rows removed (admin ${devFid})`
  );

  return res.status(200).json({
    ok: true,
    fid,
    walletCleared: true,
    dailyStateRowsRemoved: removedState.length,
  });
}

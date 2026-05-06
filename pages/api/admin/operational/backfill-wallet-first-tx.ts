/**
 * Backfill wallet_first_tx_at for existing users (admin-only)
 *
 * POST /api/admin/operational/backfill-wallet-first-tx
 * Body: { devFid, limit? = 50, dryRun? = false }
 *
 * The wallet-cluster gate caches `wallet_first_tx_at` lazily on first
 * gameplay attempt. Users who guessed in earlier rounds (including the
 * known R28/R29 bots) won't have it populated unless they come back to
 * play, so the cluster report comes back empty until populated.
 *
 * This endpoint walks users where `wallet_first_tx_checked_at IS NULL`,
 * fetches first-tx from Blockscout, and updates the row. Processes in
 * batches with a small sleep between calls so we don't hammer Blockscout.
 *
 * Run repeatedly (each call processes `limit` users) until the response
 * shows `processed: 0` — at that point every user has been checked.
 *
 * Idempotent: a re-run skips users with `wallet_first_tx_checked_at`
 * already set. To force a re-fetch for a specific user, null out their
 * `wallet_first_tx_checked_at` first.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from '../me';
import { db } from '../../../../src/db';
import { users } from '../../../../src/db/schema';
import { and, eq, isNull, isNotNull, sql } from 'drizzle-orm';
import { fetchWalletFirstTx } from '../../../../src/lib/wallet-cluster';

const SLEEP_MS = 250;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { devFid, limit = 50, dryRun = false } = req.body ?? {};

  const adminFid = parseInt(devFid, 10);
  if (!adminFid || !isAdminFid(adminFid)) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const batchLimit = Math.max(1, Math.min(200, parseInt(limit, 10) || 50));

  try {
    // Pick users that have a wallet but no first-tx-checked-at, ordered
    // by FID descending so we hit recent (likely-bot-shaped) users first.
    const candidates = await db
      .select({ fid: users.fid, wallet: users.signerWalletAddress })
      .from(users)
      .where(
        and(
          isNull(users.walletFirstTxCheckedAt),
          isNotNull(users.signerWalletAddress)
        )
      )
      .orderBy(sql`${users.fid} desc`)
      .limit(batchLimit);

    if (candidates.length === 0) {
      // Also report total state for visibility
      const [{ remaining }] = await db
        .select({
          remaining: sql<number>`count(*) filter (where wallet_first_tx_checked_at is null and signer_wallet_address is not null)::int`,
        })
        .from(users);
      return res.status(200).json({
        processed: 0,
        remaining,
        message: remaining === 0 ? 'Backfill complete.' : 'No candidates returned in this query (race?).',
      });
    }

    if (dryRun) {
      return res.status(200).json({
        dryRun: true,
        wouldProcess: candidates.length,
        sample: candidates.slice(0, 5),
      });
    }

    let updated = 0;
    let foundFirstTx = 0;
    let errors = 0;

    for (const c of candidates) {
      try {
        const firstTx = await fetchWalletFirstTx(c.wallet as string);
        await db
          .update(users)
          .set({
            walletFirstTxAt: firstTx ?? undefined,
            walletFirstTxCheckedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(users.fid, c.fid));
        updated++;
        if (firstTx) foundFirstTx++;
      } catch (err) {
        errors++;
        console.warn(`[backfill] Failed FID ${c.fid}:`, err);
      }
      await sleep(SLEEP_MS);
    }

    // Report remaining
    const [{ remaining }] = await db
      .select({
        remaining: sql<number>`count(*) filter (where wallet_first_tx_checked_at is null and signer_wallet_address is not null)::int`,
      })
      .from(users);

    return res.status(200).json({
      processed: candidates.length,
      updated,
      foundFirstTx,
      errors,
      remaining,
      message:
        remaining === 0
          ? 'Backfill complete. Now hit /api/admin/operational/wallet-cluster-report to see clusters.'
          : `Run this endpoint again to continue (${remaining} users remaining).`,
    });
  } catch (error: any) {
    console.error('[backfill-wallet-first-tx] Error:', error);
    return res.status(500).json({
      error: 'Backfill failed',
      details: error?.message ?? String(error),
    });
  }
}

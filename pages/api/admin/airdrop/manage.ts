/**
 * Airdrop Manager API
 * CLANKTON to $WORD migration tracker
 *
 * GET  /api/admin/airdrop/manage?action=list&devFid=...
 * GET  /api/admin/airdrop/manage?action=summary&devFid=...
 * POST /api/admin/airdrop/manage  { action: 'import-csv', csvData, devFid }
 * POST /api/admin/airdrop/manage  { action: 'refresh-balances', devFid }
 * POST /api/admin/airdrop/manage  { action: 'refresh-single', walletId, devFid }
 * POST /api/admin/airdrop/manage  { action: 'mark-sent', walletId, txHash?, note?, devFid }
 * POST /api/admin/airdrop/manage  { action: 'mark-all-sent', txHash?, note?, devFid }
 * POST /api/admin/airdrop/manage  { action: 'unmark-sent', distributionId, devFid }
 * POST /api/admin/airdrop/manage  { action: 'delete-wallet', walletId, devFid }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from '../me';
import { db } from '../../../../src/db';
import { airdropWallets, airdropDistributions } from '../../../../src/db/schema';
import { eq, sql, gt, and, isNull } from 'drizzle-orm';
import { ethers } from 'ethers';
import { WORD_TOKEN_ADDRESS, getBaseProvider } from '../../../../src/lib/word-token';

const AIRDROP_FLOOR = 200_000_000; // 200M $WORD

const ERC20_BALANCE_ABI = ['function balanceOf(address owner) view returns (uint256)'];

/**
 * Get raw $WORD token balance for airdrop tracking.
 * Uses direct ERC-20 balanceOf — NOT the WordManager, which returns 0 for
 * wallets that have never interacted with the game contract.
 * Throws on error (no silent 0s).
 */
async function getAirdropBalance(walletAddress: string): Promise<number> {
  const provider = getBaseProvider();
  const contract = new ethers.Contract(WORD_TOKEN_ADDRESS, ERC20_BALANCE_ABI, provider);
  const balance = await contract.balanceOf(walletAddress);
  return parseFloat(ethers.formatUnits(balance, 18));
}

/**
 * Extract admin FID from request (query for GET, body for POST, cookies as fallback)
 */
function getAdminFid(req: NextApiRequest): number | null {
  const raw = req.method === 'GET'
    ? req.query.devFid
    : req.body?.devFid;
  if (raw) {
    const fid = parseInt(String(raw), 10);
    if (!isNaN(fid)) return fid;
  }
  if (req.cookies.siwn_fid) {
    const fid = parseInt(req.cookies.siwn_fid, 10);
    if (!isNaN(fid)) return fid;
  }
  return null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Auth
  const fid = getAdminFid(req);
  if (!fid || !isAdminFid(fid)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    if (req.method === 'GET') {
      const action = req.query.action as string;

      // ======================================================================
      // GET: list
      // ======================================================================
      if (action === 'list') {
        const wallets = await db
          .select()
          .from(airdropWallets)
          .orderBy(airdropWallets.id);

        // Get latest distribution for each wallet
        const distributions = await db
          .select()
          .from(airdropDistributions)
          .orderBy(airdropDistributions.sentAt);

        // Group distributions by wallet ID
        const distByWallet = new Map<number, typeof distributions[0][]>();
        for (const d of distributions) {
          const existing = distByWallet.get(d.airdropWalletId) || [];
          existing.push(d);
          distByWallet.set(d.airdropWalletId, existing);
        }

        const result = wallets.map(w => ({
          ...w,
          distributions: distByWallet.get(w.id) || [],
        }));

        return res.status(200).json({ ok: true, wallets: result });
      }

      // ======================================================================
      // GET: summary
      // ======================================================================
      if (action === 'summary') {
        const wallets = await db.select().from(airdropWallets);
        const distributions = await db.select().from(airdropDistributions);

        const totalWallets = wallets.length;
        let totalNeeded = 0;
        let aboveFloor = 0;
        let needingAirdrop = 0;

        // Track which wallets have distributions
        const sentWalletIds = new Set(distributions.map(d => d.airdropWalletId));

        for (const w of wallets) {
          const needed = parseFloat(w.airdropNeeded || '0');
          if (needed > 0) {
            needingAirdrop++;
            if (!sentWalletIds.has(w.id)) {
              totalNeeded += needed;
            }
          } else {
            aboveFloor++;
          }
        }

        return res.status(200).json({
          ok: true,
          summary: {
            totalWallets,
            totalWordNeeded: totalNeeded,
            aboveFloor,
            needingAirdrop,
            alreadySent: sentWalletIds.size,
          },
        });
      }

      return res.status(400).json({ error: `Unknown GET action: ${action}` });
    }

    if (req.method === 'POST') {
      const { action } = req.body;

      // ======================================================================
      // POST: import-csv
      // ======================================================================
      if (action === 'import-csv') {
        const { csvData } = req.body;
        if (!csvData || typeof csvData !== 'string') {
          return res.status(400).json({ error: 'csvData is required' });
        }

        const lines = csvData
          .split('\n')
          .map(l => l.replace(/\r/g, '').trim())
          .filter(l => l.length > 0);

        let imported = 0;
        let skipped = 0;
        const errors: string[] = [];

        for (const line of lines) {
          // Skip header row
          if (line.toLowerCase().includes('address') || line.toLowerCase().includes('wallet')) {
            continue;
          }

          const parts = line.split(',').map(p => p.trim());
          if (parts.length < 2) {
            errors.push(`Invalid line (need address,balance): ${line.slice(0, 60)}`);
            skipped++;
            continue;
          }

          const [address, balanceStr] = parts;

          if (!ethers.isAddress(address)) {
            errors.push(`Invalid address: ${address}`);
            skipped++;
            continue;
          }

          const balance = parseFloat(balanceStr.replace(/,/g, ''));
          if (isNaN(balance) || balance < 0) {
            errors.push(`Invalid balance for ${address}: ${balanceStr}`);
            skipped++;
            continue;
          }

          // Upsert: insert or update on conflict
          await db
            .insert(airdropWallets)
            .values({
              walletAddress: address.toLowerCase(),
              snapshotToken: 'CLANKTON',
              snapshotBalance: Math.round(balance).toString(),
              snapshotDate: '2026-01-17',
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: airdropWallets.walletAddress,
              set: {
                snapshotBalance: Math.round(balance).toString(),
                snapshotDate: '2026-01-17',
                updatedAt: new Date(),
              },
            });

          imported++;
        }

        return res.status(200).json({
          ok: true,
          imported,
          skipped,
          errors: errors.slice(0, 20), // Cap error list
        });
      }

      // ======================================================================
      // POST: refresh-balances (all wallets)
      // ======================================================================
      if (action === 'refresh-balances') {
        const wallets = await db.select().from(airdropWallets);
        const BATCH_SIZE = 5;
        const BATCH_DELAY_MS = 1000;

        let updated = 0;
        let failed = 0;

        for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
          const batch = wallets.slice(i, i + BATCH_SIZE);

          const results = await Promise.allSettled(
            batch.map(async (wallet) => {
              const balance = await getAirdropBalance(wallet.walletAddress);
              const needed = Math.max(0, AIRDROP_FLOOR - balance);

              await db
                .update(airdropWallets)
                .set({
                  currentWordBalance: balance.toFixed(2),
                  airdropNeeded: needed.toFixed(2),
                  balanceLastCheckedAt: new Date(),
                  balanceCheckError: null,
                  updatedAt: new Date(),
                })
                .where(eq(airdropWallets.id, wallet.id));

              return { walletId: wallet.id, balance, needed };
            })
          );

          for (const r of results) {
            if (r.status === 'fulfilled') {
              updated++;
            } else {
              failed++;
              // Try to record the error
              const wallet = batch[results.indexOf(r)];
              if (wallet) {
                await db
                  .update(airdropWallets)
                  .set({
                    balanceCheckError: String(r.reason).slice(0, 500),
                    balanceLastCheckedAt: new Date(),
                    updatedAt: new Date(),
                  })
                  .where(eq(airdropWallets.id, wallet.id));
              }
            }
          }

          // Delay between batches (except last)
          if (i + BATCH_SIZE < wallets.length) {
            await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
          }
        }

        return res.status(200).json({ ok: true, updated, failed, total: wallets.length });
      }

      // ======================================================================
      // POST: refresh-single
      // ======================================================================
      if (action === 'refresh-single') {
        const { walletId } = req.body;
        if (!walletId) {
          return res.status(400).json({ error: 'walletId is required' });
        }

        const [wallet] = await db
          .select()
          .from(airdropWallets)
          .where(eq(airdropWallets.id, walletId));

        if (!wallet) {
          return res.status(404).json({ error: 'Wallet not found' });
        }

        try {
          const balance = await getAirdropBalance(wallet.walletAddress);
          const needed = Math.max(0, AIRDROP_FLOOR - balance);

          await db
            .update(airdropWallets)
            .set({
              currentWordBalance: balance.toFixed(2),
              airdropNeeded: needed.toFixed(2),
              balanceLastCheckedAt: new Date(),
              balanceCheckError: null,
              updatedAt: new Date(),
            })
            .where(eq(airdropWallets.id, walletId));

          return res.status(200).json({ ok: true, balance, needed });
        } catch (err: any) {
          await db
            .update(airdropWallets)
            .set({
              balanceCheckError: String(err.message || err).slice(0, 500),
              balanceLastCheckedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(airdropWallets.id, walletId));

          return res.status(500).json({ error: `Balance check failed: ${err.message}` });
        }
      }

      // ======================================================================
      // POST: mark-sent
      // ======================================================================
      if (action === 'mark-sent') {
        const { walletId, txHash, note } = req.body;
        if (!walletId) {
          return res.status(400).json({ error: 'walletId is required' });
        }

        const [wallet] = await db
          .select()
          .from(airdropWallets)
          .where(eq(airdropWallets.id, walletId));

        if (!wallet) {
          return res.status(404).json({ error: 'Wallet not found' });
        }

        const amount = parseFloat(wallet.airdropNeeded || '0');

        await db.insert(airdropDistributions).values({
          airdropWalletId: walletId,
          amountSent: amount.toFixed(2),
          markedByFid: fid,
          txHash: txHash || null,
          note: note || null,
        });

        return res.status(200).json({ ok: true, walletId, amount });
      }

      // ======================================================================
      // POST: mark-all-sent
      // ======================================================================
      if (action === 'mark-all-sent') {
        const { txHash, note } = req.body;

        // Get wallets needing airdrop that haven't been sent yet
        const wallets = await db.select().from(airdropWallets);
        const existingDists = await db.select().from(airdropDistributions);
        const sentWalletIds = new Set(existingDists.map(d => d.airdropWalletId));

        let marked = 0;
        for (const w of wallets) {
          const needed = parseFloat(w.airdropNeeded || '0');
          if (needed > 0 && !sentWalletIds.has(w.id)) {
            await db.insert(airdropDistributions).values({
              airdropWalletId: w.id,
              amountSent: needed.toFixed(2),
              markedByFid: fid,
              txHash: txHash || null,
              note: note || null,
            });
            marked++;
          }
        }

        return res.status(200).json({ ok: true, marked });
      }

      // ======================================================================
      // POST: unmark-sent
      // ======================================================================
      if (action === 'unmark-sent') {
        const { distributionId } = req.body;
        if (!distributionId) {
          return res.status(400).json({ error: 'distributionId is required' });
        }

        await db
          .delete(airdropDistributions)
          .where(eq(airdropDistributions.id, distributionId));

        return res.status(200).json({ ok: true, distributionId });
      }

      // ======================================================================
      // POST: delete-wallet
      // ======================================================================
      if (action === 'delete-wallet') {
        const { walletId } = req.body;
        if (!walletId) {
          return res.status(400).json({ error: 'walletId is required' });
        }

        // Delete distributions first (FK constraint)
        await db
          .delete(airdropDistributions)
          .where(eq(airdropDistributions.airdropWalletId, walletId));

        await db
          .delete(airdropWallets)
          .where(eq(airdropWallets.id, walletId));

        return res.status(200).json({ ok: true, walletId });
      }

      return res.status(400).json({ error: `Unknown POST action: ${action}` });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error('[airdrop/manage] Error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

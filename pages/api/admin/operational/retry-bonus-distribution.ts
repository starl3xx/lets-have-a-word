/**
 * Retry Failed Bonus Word $WORD Distributions
 *
 * GET /api/admin/operational/retry-bonus-distribution
 *   - Lists all failed/pending bonus word distributions
 *
 * POST /api/admin/operational/retry-bonus-distribution
 *   - Retry distribution for a specific claim ID
 *   - Body: { claimId: number } or { all: true } to retry all failed
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../../src/db';
import { bonusWordClaims, roundBonusWords, users } from '../../../../src/db/schema';
import { eq, or, isNull } from 'drizzle-orm';
import { distributeBonusWordRewardOnChain, getBonusWordRewardsBalanceOnChain } from '../../../../src/lib/jackpot-contract';
import { isAdminFid } from '../../admin/me';
import { getUserByFid as getNeynarUserByFid } from '../../../../src/lib/farcaster';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Auth check
  let fid: number | null = null;
  if (req.query.devFid) {
    fid = parseInt(req.query.devFid as string, 10);
  } else if (req.cookies.siwn_fid) {
    fid = parseInt(req.cookies.siwn_fid, 10);
  } else if (req.body?.fid) {
    fid = parseInt(req.body.fid, 10);
  }

  if (!fid || isNaN(fid) || !isAdminFid(fid)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  if (req.method === 'GET') {
    // List all failed/pending distributions
    try {
      const failedClaims = await db
        .select({
          claimId: bonusWordClaims.id,
          bonusWordId: bonusWordClaims.bonusWordId,
          fid: bonusWordClaims.fid,
          username: users.username,
          walletAddress: bonusWordClaims.walletAddress,
          txStatus: bonusWordClaims.txStatus,
          txHash: bonusWordClaims.txHash,
          errorMessage: bonusWordClaims.errorMessage,
          claimedAt: bonusWordClaims.claimedAt,
          retryCount: bonusWordClaims.retryCount,
          wordIndex: roundBonusWords.wordIndex,
          roundId: roundBonusWords.roundId,
        })
        .from(bonusWordClaims)
        .leftJoin(roundBonusWords, eq(bonusWordClaims.bonusWordId, roundBonusWords.id))
        .leftJoin(users, eq(bonusWordClaims.fid, users.fid))
        .where(or(
          eq(bonusWordClaims.txStatus, 'failed'),
          eq(bonusWordClaims.txStatus, 'pending')
        ));

      // Also check for claimed bonus words without any claim record
      const claimedWithoutRecord = await db
        .select({
          bonusWordId: roundBonusWords.id,
          roundId: roundBonusWords.roundId,
          wordIndex: roundBonusWords.wordIndex,
          claimedByFid: roundBonusWords.claimedByFid,
          username: users.username,
          claimedAt: roundBonusWords.claimedAt,
          txHash: roundBonusWords.txHash,
        })
        .from(roundBonusWords)
        .where(isNull(roundBonusWords.txHash))
        .innerJoin(users, eq(roundBonusWords.claimedByFid, users.fid));

      // Get contract $WORD balance
      const wordTokenBalance = await getBonusWordRewardsBalanceOnChain();

      return res.status(200).json({
        failedClaims,
        claimedWithoutTx: claimedWithoutRecord,
        contractWordTokenBalance: wordTokenBalance,
        totalFailedOrPending: failedClaims.length,
      });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  if (req.method === 'POST') {
    const { claimId, all, bonusWordId } = req.body;

    try {
      if (all) {
        // Retry all failed claims
        const failedClaims = await db
          .select()
          .from(bonusWordClaims)
          .where(eq(bonusWordClaims.txStatus, 'failed'));

        const results = [];
        for (const claim of failedClaims) {
          try {
            // Get bonus word info
            const [bonusWord] = await db
              .select()
              .from(roundBonusWords)
              .where(eq(roundBonusWords.id, claim.bonusWordId));

            if (!bonusWord) {
              results.push({ claimId: claim.id, error: 'Bonus word not found' });
              continue;
            }

            const txHash = await distributeBonusWordRewardOnChain(
              claim.walletAddress,
              bonusWord.wordIndex
            );

            // Update claim record
            await db
              .update(bonusWordClaims)
              .set({
                txHash,
                txStatus: 'confirmed',
                confirmedAt: new Date(),
                retryCount: claim.retryCount + 1,
              })
              .where(eq(bonusWordClaims.id, claim.id));

            // Update bonus word record
            await db
              .update(roundBonusWords)
              .set({ txHash })
              .where(eq(roundBonusWords.id, claim.bonusWordId));

            results.push({ claimId: claim.id, txHash, success: true });
          } catch (error: any) {
            // Update retry count
            await db
              .update(bonusWordClaims)
              .set({
                retryCount: claim.retryCount + 1,
                errorMessage: error.message,
              })
              .where(eq(bonusWordClaims.id, claim.id));

            results.push({ claimId: claim.id, error: error.message });
          }
        }

        return res.status(200).json({ results });
      }

      // Retry specific claim
      if (claimId) {
        const [claim] = await db
          .select()
          .from(bonusWordClaims)
          .where(eq(bonusWordClaims.id, claimId));

        if (!claim) {
          return res.status(404).json({ error: 'Claim not found' });
        }

        const [bonusWord] = await db
          .select()
          .from(roundBonusWords)
          .where(eq(roundBonusWords.id, claim.bonusWordId));

        if (!bonusWord) {
          return res.status(404).json({ error: 'Bonus word not found' });
        }

        const txHash = await distributeBonusWordRewardOnChain(
          claim.walletAddress,
          bonusWord.wordIndex
        );

        await db
          .update(bonusWordClaims)
          .set({
            txHash,
            txStatus: 'confirmed',
            confirmedAt: new Date(),
            retryCount: claim.retryCount + 1,
          })
          .where(eq(bonusWordClaims.id, claim.id));

        await db
          .update(roundBonusWords)
          .set({ txHash })
          .where(eq(roundBonusWords.id, claim.bonusWordId));

        return res.status(200).json({ success: true, txHash });
      }

      // Handle case where bonus word was claimed but no claim record exists
      if (bonusWordId) {
        const [bonusWord] = await db
          .select()
          .from(roundBonusWords)
          .where(eq(roundBonusWords.id, bonusWordId));

        if (!bonusWord || !bonusWord.claimedByFid) {
          return res.status(404).json({ error: 'Bonus word not found or not claimed' });
        }

        // Get user wallet from database
        const [user] = await db
          .select({ wallet: users.signerWalletAddress, username: users.username })
          .from(users)
          .where(eq(users.fid, bonusWord.claimedByFid));

        let wallet = user?.wallet;

        // If no wallet in database, look up via Neynar
        if (!wallet) {
          console.log(`[retry-bonus-distribution] No wallet in DB for FID ${bonusWord.claimedByFid}, looking up via Neynar...`);
          const neynarUser = await getNeynarUserByFid(bonusWord.claimedByFid);

          // Use primaryWallet first, then signerWallet, then custodyAddress
          wallet = neynarUser?.primaryWallet || neynarUser?.signerWallet || neynarUser?.custodyAddress || null;

          if (wallet) {
            console.log(`[retry-bonus-distribution] Found wallet via Neynar for FID ${bonusWord.claimedByFid}: ${wallet.slice(0, 10)}...`);

            // Update user record with the wallet for future use
            await db
              .update(users)
              .set({ signerWalletAddress: wallet })
              .where(eq(users.fid, bonusWord.claimedByFid));
          }
        }

        if (!wallet) {
          return res.status(400).json({
            error: 'User has no wallet address (not in database and not found via Neynar)',
            fid: bonusWord.claimedByFid,
          });
        }

        const txHash = await distributeBonusWordRewardOnChain(
          wallet,
          bonusWord.wordIndex
        );

        await db
          .update(roundBonusWords)
          .set({ txHash })
          .where(eq(roundBonusWords.id, bonusWordId));

        return res.status(200).json({ success: true, txHash, walletAddress: wallet });
      }

      return res.status(400).json({ error: 'Provide claimId, bonusWordId, or all: true' });
    } catch (error: any) {
      console.error('[retry-bonus-distribution] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

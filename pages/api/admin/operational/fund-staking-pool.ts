/**
 * Admin: Fund Staking Pool
 * V3: Calls notifyRewardAmount() to start/extend a Synthetix-style reward period.
 * Tokens must already be in the contract (transferred separately).
 *
 * POST /api/admin/operational/fund-staking-pool
 * Body: { amountTokens: number, fid: number }
 *
 * Flow:
 * 1. Transfer $WORD to the WordManagerV3 proxy address (manual or separate endpoint)
 * 2. Call this endpoint → notifyRewardAmount(amount) starts the 30-day drip
 * 3. If a period is already active, remaining undistributed rolls into new period
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { ethers } from 'ethers';
import { isAdminFid } from '../me';
import { notifyRewardAmountOnChain } from '../../../../src/lib/word-manager';

interface FundRequest {
  amountTokens: number;
  fid: number;
}

interface FundResponse {
  success: boolean;
  txHash: string | null;
  amountTokens: number;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<FundResponse | { error: string }>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { amountTokens, fid } = req.body as FundRequest;

  // Auth check
  if (!fid || !isAdminFid(fid)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  if (!amountTokens || amountTokens <= 0) {
    return res.status(400).json({ error: 'Valid amountTokens required (positive number)' });
  }

  try {
    // Convert whole tokens to wei (18 decimals)
    const amountWei = ethers.parseUnits(String(amountTokens), 18).toString();

    console.log(`[fund-staking-pool] Admin FID ${fid} starting reward period: ${amountTokens} $WORD (${amountWei} wei)`);

    const txHash = await notifyRewardAmountOnChain(amountWei);

    console.log(`[fund-staking-pool] Reward period started: txHash=${txHash}`);

    return res.status(200).json({
      success: true,
      txHash,
      amountTokens,
    });
  } catch (error) {
    console.error('[fund-staking-pool] Error:', error);
    return res.status(500).json({
      error: `Failed to start reward period: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

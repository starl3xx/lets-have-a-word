/**
 * Admin: Fund Staking Pool
 * XP-Boosted Staking: Deposits $WORD tokens into the staking reward pool
 *
 * POST /api/admin/operational/fund-staking-pool
 * Body: { amountTokens: number, fid: number }
 *
 * Requires admin FID auth. Calls depositRewards() on WordManager contract.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { ethers } from 'ethers';
import { isAdminFid } from '../me';
import { depositRewardsOnChain } from '../../../../src/lib/word-manager';

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

    console.log(`[fund-staking-pool] Admin FID ${fid} depositing ${amountTokens} $WORD (${amountWei} wei)`);

    const txHash = await depositRewardsOnChain(amountWei);

    console.log(`[fund-staking-pool] Deposit complete: txHash=${txHash}`);

    return res.status(200).json({
      success: true,
      txHash,
      amountTokens,
    });
  } catch (error) {
    console.error('[fund-staking-pool] Error:', error);
    return res.status(500).json({
      error: `Failed to fund staking pool: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

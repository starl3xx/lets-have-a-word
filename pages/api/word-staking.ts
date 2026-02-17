/**
 * Word Staking API
 * Milestone 14: Records staking actions initiated by user wallet
 *
 * POST /api/word-staking
 * Body: { action: 'stake' | 'withdraw' | 'claim', txHash: string, walletAddress: string }
 *
 * Staking transactions are signed by the user's wallet directly via Wagmi.
 * This endpoint only records the action for the audit trail.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { ethers } from 'ethers';
import { isDevModeEnabled } from '../../src/lib/devGameState';

export interface WordStakingRequest {
  action: 'stake' | 'withdraw' | 'claim';
  txHash: string;
  walletAddress: string;
}

export interface WordStakingResponse {
  success: boolean;
  action: string;
  txHash: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WordStakingResponse | { error: string }>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, txHash, walletAddress } = req.body as WordStakingRequest;

  // Validate inputs
  if (!action || !['stake', 'withdraw', 'claim'].includes(action)) {
    return res.status(400).json({ error: 'Valid action required (stake, withdraw, claim)' });
  }

  if (!walletAddress || !ethers.isAddress(walletAddress)) {
    return res.status(400).json({ error: 'Valid walletAddress required' });
  }

  if (!txHash || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return res.status(400).json({ error: 'Valid txHash required' });
  }

  // Dev mode: return synthetic success
  if (isDevModeEnabled()) {
    return res.status(200).json({
      success: true,
      action,
      txHash,
    });
  }

  try {
    // Record the staking action
    // The actual staking tx was already sent by the user's wallet
    // We just log it for the audit trail
    console.log(`[word-staking] ${action} by ${walletAddress}: ${txHash}`);

    return res.status(200).json({
      success: true,
      action,
      txHash,
    });
  } catch (error) {
    console.error('[word-staking] Error:', error);
    return res.status(500).json({ error: 'Failed to record staking action' });
  }
}

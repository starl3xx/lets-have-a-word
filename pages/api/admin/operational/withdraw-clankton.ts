/**
 * Withdraw CLANKTON from Contract
 *
 * GET /api/admin/operational/withdraw-clankton
 *   - Get current CLANKTON balance and withdrawal status
 *
 * POST /api/admin/operational/withdraw-clankton
 *   - Withdraw CLANKTON to specified address
 *   - Body: { toAddress: string, amount?: string } (amount in whole tokens, default: all)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
import { ethers } from 'ethers';
import { isAdminFid } from '../me';
import {
  getClanktonBalanceWei,
  emergencyWithdrawClanktonOnChain,
  isBonusWordsEnabledOnChain,
  setBonusWordsEnabledOnChain,
  getContractOwnerOnChain,
  getContractConfig,
} from '../../../../src/lib/jackpot-contract';
import { CLANKTON_ADDRESS } from '../../../../src/lib/clankton';

interface ClanktonStatus {
  contractAddress: string;
  clanktonTokenAddress: string;
  balanceWei: string;
  balanceFormatted: string;
  balanceInMillions: string;
  roundsAvailable: number;
  bonusWordsEnabled: boolean;
  contractOwner: string;
  canWithdraw: boolean;
  withdrawalNote: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    // Auth check - support devFid from query (GET) or body (POST)
    const devFidFromQuery = req.query.devFid ? parseInt(req.query.devFid as string, 10) : null;
    const devFidFromBody = req.body?.devFid ? parseInt(req.body.devFid, 10) : null;
    const fidFromCookie = req.cookies.siwn_fid ? parseInt(req.cookies.siwn_fid, 10) : null;
    const fid = devFidFromQuery || devFidFromBody || fidFromCookie;

    if (!fid || !isAdminFid(fid)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    if (req.method === 'GET') {
      const config = getContractConfig();

      // Fetch all status info in parallel
      const [balanceWei, bonusWordsEnabled, contractOwner] = await Promise.all([
        getClanktonBalanceWei(),
        isBonusWordsEnabledOnChain(),
        getContractOwnerOnChain().catch(() => 'UNKNOWN'),
      ]);

      const balanceFormatted = ethers.formatUnits(balanceWei, 18);
      const balanceNum = parseFloat(balanceFormatted);
      const balanceInMillions = (balanceNum / 1_000_000).toFixed(2);

      // Each round uses 50M CLANKTON (10 bonus words x 5M each)
      const CLANKTON_PER_ROUND = 50_000_000;
      const roundsAvailable = Math.floor(balanceNum / CLANKTON_PER_ROUND);

      // Check if DEPLOYER_PRIVATE_KEY is configured
      const hasOwnerKey = !!process.env.DEPLOYER_PRIVATE_KEY;

      const status: ClanktonStatus = {
        contractAddress: config.jackpotManagerAddress,
        clanktonTokenAddress: CLANKTON_ADDRESS,
        balanceWei: balanceWei.toString(),
        balanceFormatted,
        balanceInMillions: `${balanceInMillions}M`,
        roundsAvailable,
        bonusWordsEnabled,
        contractOwner,
        canWithdraw: hasOwnerKey && balanceWei > 0n,
        withdrawalNote: !hasOwnerKey
          ? 'DEPLOYER_PRIVATE_KEY not configured - cannot withdraw'
          : bonusWordsEnabled
            ? 'Warning: Bonus words is still enabled. Consider disabling first.'
            : balanceWei === 0n
              ? 'No CLANKTON balance to withdraw'
              : 'Ready to withdraw',
      };

      return res.status(200).json({
        ok: true,
        ...status,
        timestamp: new Date().toISOString(),
      });
    }

    if (req.method === 'POST') {
      const { action, toAddress, amount } = req.body as {
        action?: 'withdraw' | 'disable-bonus-words' | 'enable-bonus-words';
        toAddress?: string;
        amount?: string; // In whole tokens (not wei)
      };

      // Handle bonus words toggle
      if (action === 'disable-bonus-words') {
        console.log(`[withdraw-clankton] Admin ${fid} disabling bonus words`);
        const txHash = await setBonusWordsEnabledOnChain(false);
        return res.status(200).json({
          ok: true,
          action: 'disable-bonus-words',
          txHash,
          message: 'Bonus words feature disabled',
        });
      }

      if (action === 'enable-bonus-words') {
        console.log(`[withdraw-clankton] Admin ${fid} enabling bonus words`);
        const txHash = await setBonusWordsEnabledOnChain(true);
        return res.status(200).json({
          ok: true,
          action: 'enable-bonus-words',
          txHash,
          message: 'Bonus words feature enabled',
        });
      }

      // Withdraw action
      if (action === 'withdraw' || !action) {
        if (!toAddress) {
          return res.status(400).json({ error: 'toAddress is required' });
        }

        // Validate address
        if (!ethers.isAddress(toAddress)) {
          return res.status(400).json({ error: 'Invalid toAddress format' });
        }

        // Get current balance
        const currentBalance = await getClanktonBalanceWei();

        if (currentBalance === 0n) {
          return res.status(400).json({ error: 'No CLANKTON balance to withdraw' });
        }

        // Determine amount to withdraw
        let withdrawAmount: bigint;
        if (amount) {
          // Convert from whole tokens to wei
          withdrawAmount = ethers.parseUnits(amount, 18);
          if (withdrawAmount > currentBalance) {
            return res.status(400).json({
              error: `Requested amount (${amount}) exceeds balance (${ethers.formatUnits(currentBalance, 18)})`,
            });
          }
        } else {
          // Withdraw all
          withdrawAmount = currentBalance;
        }

        console.log(`[withdraw-clankton] Admin ${fid} withdrawing ${ethers.formatUnits(withdrawAmount, 18)} CLANKTON to ${toAddress}`);

        const txHash = await emergencyWithdrawClanktonOnChain(withdrawAmount, toAddress);

        // Get new balance
        const newBalance = await getClanktonBalanceWei();

        return res.status(200).json({
          ok: true,
          action: 'withdraw',
          txHash,
          withdrawnAmount: ethers.formatUnits(withdrawAmount, 18),
          toAddress,
          newBalance: ethers.formatUnits(newBalance, 18),
          message: `Successfully withdrew ${ethers.formatUnits(withdrawAmount, 18)} CLANKTON`,
        });
      }

      return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('[admin/operational/withdraw-clankton] Error:', error);
    Sentry.captureException(error, {
      tags: { endpoint: 'admin-withdraw-clankton' },
    });
    const message = error instanceof Error ? error.message : 'Internal server error';
    return res.status(500).json({ error: message });
  }
}

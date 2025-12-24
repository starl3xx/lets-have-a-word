/**
 * Admin Wallet Balances API
 * Returns balances for operator wallet, prize pool, creator pool, and pending refunds
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { ethers } from 'ethers';
import { isAdminFid } from '../me';
import { getBaseProvider } from '../../../../src/lib/clankton';
import { getContractConfig, getJackpotManagerReadOnly } from '../../../../src/lib/jackpot-contract';
import { db } from '../../../../src/db';
import { refunds } from '../../../../src/db/schema';
import { eq, sql } from 'drizzle-orm';

export interface WalletBalancesResponse {
  operatorWallet: {
    address: string;
    balanceEth: string;
    balanceWei: string;
  };
  prizePool: {
    address: string;
    balanceEth: string;
    balanceWei: string;
    currentJackpotEth: string;
  };
  creatorPool: {
    address: string;
    accumulatedEth: string;
    accumulatedWei: string;
  };
  pendingRefunds: {
    count: number;
    totalEth: string;
  };
  contractAddress: string;
  contractError?: string; // Present if contract calls failed
  lastUpdated: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WalletBalancesResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Auth check
    let fid: number | null = null;
    if (req.query.devFid) {
      fid = parseInt(req.query.devFid as string, 10);
    } else if (req.cookies.siwn_fid) {
      fid = parseInt(req.cookies.siwn_fid, 10);
    }

    if (!fid || !isAdminFid(fid)) {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }

    const provider = getBaseProvider();
    const config = getContractConfig(); // Addresses are already checksummed
    const contract = getJackpotManagerReadOnly();

    // Fetch wallet balances (these always work)
    const [operatorBalance, prizePoolBalance] = await Promise.all([
      provider.getBalance(config.operatorWallet),
      provider.getBalance(config.prizePoolWallet),
    ]);

    // Contract calls may fail if contract not deployed - handle gracefully
    let currentJackpot: bigint = 0n;
    let creatorAccumulated: bigint = 0n;
    let contractError: string | null = null;

    try {
      [currentJackpot, creatorAccumulated] = await Promise.all([
        contract.currentJackpot(),
        contract.creatorProfitAccumulated(),
      ]);
    } catch (err) {
      console.warn('[admin/wallet/balances] Contract calls failed (contract may not be deployed):', err);
      contractError = 'Contract not deployed or not accessible';
    }

    // Database query for pending refunds
    let pendingRefunds = { count: 0, totalEth: '0' };
    try {
      const pendingRefundsResult = await db.select({
        count: sql<number>`cast(count(*) as int)`,
        totalEth: sql<string>`coalesce(sum(cast(amount_eth as numeric)), 0)::text`,
      })
        .from(refunds)
        .where(eq(refunds.status, 'pending'));
      pendingRefunds = pendingRefundsResult[0] || { count: 0, totalEth: '0' };
    } catch (err) {
      console.warn('[admin/wallet/balances] Refunds query failed:', err);
    }

    const response: WalletBalancesResponse = {
      operatorWallet: {
        address: config.operatorWallet,
        balanceEth: ethers.formatEther(operatorBalance),
        balanceWei: operatorBalance.toString(),
      },
      prizePool: {
        address: config.prizePoolWallet,
        balanceEth: ethers.formatEther(prizePoolBalance),
        balanceWei: prizePoolBalance.toString(),
        currentJackpotEth: ethers.formatEther(currentJackpot),
      },
      creatorPool: {
        address: config.creatorProfitWallet,
        accumulatedEth: ethers.formatEther(creatorAccumulated),
        accumulatedWei: creatorAccumulated.toString(),
      },
      pendingRefunds: {
        count: pendingRefunds.count,
        totalEth: parseFloat(pendingRefunds.totalEth).toFixed(6),
      },
      contractAddress: config.jackpotManagerAddress,
      ...(contractError && { contractError }),
      lastUpdated: new Date().toISOString(),
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error('[admin/wallet/balances] Error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch balances'
    });
  }
}

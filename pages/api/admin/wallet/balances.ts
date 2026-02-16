/**
 * Admin Wallet Balances API
 * Returns balances for operator wallet, prize pool, creator pool, and pending refunds
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { ethers } from 'ethers';
import { isAdminFid } from '../me';
import { getBaseProvider } from '../../../../src/lib/word-token';
import { getContractConfig, getJackpotManagerReadOnly } from '../../../../src/lib/jackpot-contract';
import { db } from '../../../../src/db';
import { refunds, rounds } from '../../../../src/db/schema';
import { eq, sql, desc } from 'drizzle-orm';
import { SEED_CAP_ETH } from '../../../../src/lib/economics';
import { FEE_RECIPIENTS, WETH_ADDRESS_BASE } from '../../../../src/lib/fee-recipients';

// Minimum seed target for next round
// Treasury funds below this threshold prioritize seeding rounds
export const SEED_TARGET_ETH = SEED_CAP_ETH; // 0.03 ETH

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
  nextRoundSeed: {
    fivePercentEth: string; // 5% of current jackpot
    fromTreasuryEth: string; // Amount Treasury contributes to reach 0.03
    totalEth: string; // min(0.03, 5% + treasury)
    targetEth: string; // 0.03 ETH target
    shortfallEth: string; // How much below 0.03 (0 if at or above target)
  };
  treasury: {
    address: string;
    balanceEth: string; // Total treasury balance
    balanceWei: string;
    contributingToSeedEth: string; // Amount going to seed (up to shortfall)
    withdrawableEth: string; // Only amount ABOVE what's needed for seed
    isWithdrawable: boolean; // True if withdrawableEth > 0
  };
  wordTokenRewards: {
    tokenAddress: string;
    balance: string; // Human readable (e.g., "5000000000" for 5B)
    balanceRaw: string; // Raw with 18 decimals
  };
  feeRecipients?: {
    recipients: {
      id: string;
      name: string;
      address: string;
      bps: number;
      percent: number;
      wethBalanceEth: string;
      ethBalanceEth?: string;
      totalEth: string;
    }[];
    totalWethEth: string;
    grandTotalEth: string;
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

    // Fetch $WORD token balance held by the JackpotManager contract
    const WORD_TOKEN_ADDRESS = '0x461DEb53515CaC6c923EeD9Eb7eD5Be80F4e0b07';
    let wordTokenBalance: bigint = 0n;
    try {
      const erc20Abi = ['function balanceOf(address) view returns (uint256)'];
      const wordTokenContract = new ethers.Contract(WORD_TOKEN_ADDRESS, erc20Abi, provider);
      wordTokenBalance = await wordTokenContract.balanceOf(config.jackpotManagerAddress);
    } catch (err) {
      console.warn('[admin/wallet/balances] $WORD balance fetch failed:', err);
    }

    // Fetch fee recipient WETH balances (+ native ETH for Player Rewards)
    let feeRecipientsData: WalletBalancesResponse['feeRecipients'] = undefined;
    try {
      const wethAbi = ['function balanceOf(address) view returns (uint256)'];
      const wethContract = new ethers.Contract(WETH_ADDRESS_BASE, wethAbi, provider);

      // Build parallel calls: WETH balance for all 4 + native ETH for 'BOTH' recipients
      const wethPromises = FEE_RECIPIENTS.map(r => wethContract.balanceOf(r.address));
      const ethPromises = FEE_RECIPIENTS
        .filter(r => r.receives === 'BOTH')
        .map(r => provider.getBalance(r.address));

      const [wethResults, ethResults] = await Promise.all([
        Promise.all(wethPromises),
        Promise.all(ethPromises),
      ]);

      let ethIdx = 0;
      let totalWeth = 0;
      let grandTotal = 0;

      const recipients = FEE_RECIPIENTS.map((r, i) => {
        const wethBal = parseFloat(ethers.formatEther(wethResults[i]));
        let ethBal: number | undefined;
        if (r.receives === 'BOTH') {
          ethBal = parseFloat(ethers.formatEther(ethResults[ethIdx++]));
        }
        const total = wethBal + (ethBal ?? 0);
        totalWeth += wethBal;
        grandTotal += total;

        return {
          id: r.id,
          name: r.name,
          address: r.address,
          bps: r.bps,
          percent: r.bps / 100,
          wethBalanceEth: wethBal.toFixed(6),
          ...(ethBal !== undefined && { ethBalanceEth: ethBal.toFixed(6) }),
          totalEth: total.toFixed(6),
        };
      });

      feeRecipientsData = {
        recipients,
        totalWethEth: totalWeth.toFixed(6),
        grandTotalEth: grandTotal.toFixed(6),
      };
    } catch (err) {
      console.warn('[admin/wallet/balances] Fee recipient balance fetch failed:', err);
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

    // Format $WORD balance (18 decimals) to human readable
    const wordTokenHumanReadable = ethers.formatUnits(wordTokenBalance, 18);
    // Round to whole number for display (e.g., "5000000000" for 5B)
    const wordTokenWhole = Math.floor(parseFloat(wordTokenHumanReadable)).toString();

    // =========================================================================
    // TREASURY + SEED CALCULATION
    // =========================================================================
    // Next Round Seed = min(0.03, 5% of jackpot + treasury)
    // Treasury contributes to seed until 0.03 target is reached
    // Only treasury balance ABOVE what's needed for seed is withdrawable
    // =========================================================================

    const currentJackpotFloat = parseFloat(ethers.formatEther(currentJackpot));
    const treasuryBalance = parseFloat(ethers.formatEther(creatorAccumulated));

    // 5% of current jackpot
    const fivePercentOfJackpot = currentJackpotFloat * 0.05;

    // How much more do we need to reach 0.03 target?
    const shortfallAfterFivePercent = Math.max(0, SEED_TARGET_ETH - fivePercentOfJackpot);

    // Treasury contributes up to the shortfall amount
    const treasuryContribution = Math.min(treasuryBalance, shortfallAfterFivePercent);

    // Total seed = 5% + treasury contribution (capped at 0.03)
    const totalSeed = Math.min(SEED_TARGET_ETH, fivePercentOfJackpot + treasuryContribution);

    // Final shortfall (if 5% + treasury still < 0.03)
    const finalShortfall = Math.max(0, SEED_TARGET_ETH - totalSeed);

    // Withdrawable = treasury balance minus what's being used for seed
    const withdrawableAmount = Math.max(0, treasuryBalance - treasuryContribution);
    const isWithdrawable = withdrawableAmount > 0;

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
      nextRoundSeed: {
        fivePercentEth: fivePercentOfJackpot.toFixed(18),
        fromTreasuryEth: treasuryContribution.toFixed(18),
        totalEth: totalSeed.toFixed(18),
        targetEth: SEED_TARGET_ETH.toFixed(18),
        shortfallEth: finalShortfall.toFixed(18),
      },
      treasury: {
        address: config.creatorProfitWallet,
        balanceEth: treasuryBalance.toFixed(18),
        balanceWei: creatorAccumulated.toString(),
        contributingToSeedEth: treasuryContribution.toFixed(18),
        withdrawableEth: withdrawableAmount.toFixed(18),
        isWithdrawable,
      },
      wordTokenRewards: {
        tokenAddress: WORD_TOKEN_ADDRESS,
        balance: wordTokenWhole,
        balanceRaw: wordTokenBalance.toString(),
      },
      ...(feeRecipientsData && { feeRecipients: feeRecipientsData }),
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

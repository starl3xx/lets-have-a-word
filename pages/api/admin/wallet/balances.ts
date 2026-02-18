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
import { FEE_RECIPIENTS, WETH_ADDRESS_BASE, USDC_ADDRESS_BASE, WORD_ADDRESS_BASE } from '../../../../src/lib/fee-recipients';

// Minimum seed target for next round
// Treasury funds below this threshold prioritize seeding rounds
export const SEED_TARGET_ETH = SEED_CAP_ETH; // 0.02 ETH

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
    fromTreasuryEth: string; // Amount Treasury contributes to reach 0.02
    totalEth: string; // min(0.02, 5% + treasury)
    targetEth: string; // 0.02 ETH target
    shortfallEth: string; // How much below 0.02 (0 if at or above target)
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
      wethBalance: string;
      ethBalance: string;
      usdcBalance: string;
      wordBalance: string;
    }[];
    totals: {
      weth: string;
      eth: string;
      usdc: string;
      word: string;
    };
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
    const WORD_TOKEN_ADDRESS = '0x304e649e69979298BD1AEE63e175ADf07885fb4b';
    let wordTokenBalance: bigint = 0n;
    try {
      const erc20Abi = ['function balanceOf(address) view returns (uint256)'];
      const wordTokenContract = new ethers.Contract(WORD_TOKEN_ADDRESS, erc20Abi, provider);
      wordTokenBalance = await wordTokenContract.balanceOf(config.jackpotManagerAddress);
    } catch (err) {
      console.warn('[admin/wallet/balances] $WORD balance fetch failed:', err);
    }

    // Fetch fee recipient balances: WETH, ETH, USDC, $WORD for all 4 wallets
    let feeRecipientsData: WalletBalancesResponse['feeRecipients'] = undefined;
    try {
      const erc20BalanceOf = ['function balanceOf(address) view returns (uint256)'];
      const wethContract = new ethers.Contract(WETH_ADDRESS_BASE, erc20BalanceOf, provider);
      const usdcContract = new ethers.Contract(USDC_ADDRESS_BASE, erc20BalanceOf, provider);
      const wordContract = new ethers.Contract(WORD_ADDRESS_BASE, erc20BalanceOf, provider);

      // 4 wallets × 3 ERC-20s + 4 native ETH = 16 parallel calls
      const [wethResults, ethResults, usdcResults, wordResults] = await Promise.all([
        Promise.all(FEE_RECIPIENTS.map(r => wethContract.balanceOf(r.address))),
        Promise.all(FEE_RECIPIENTS.map(r => provider.getBalance(r.address))),
        Promise.all(FEE_RECIPIENTS.map(r => usdcContract.balanceOf(r.address))),
        Promise.all(FEE_RECIPIENTS.map(r => wordContract.balanceOf(r.address))),
      ]);

      const totals = { weth: 0, eth: 0, usdc: 0, word: 0 };

      const recipients = FEE_RECIPIENTS.map((r, i) => {
        const weth = parseFloat(ethers.formatEther(wethResults[i]));
        const eth = parseFloat(ethers.formatEther(ethResults[i]));
        const usdc = parseFloat(ethers.formatUnits(usdcResults[i], 6));
        const word = parseFloat(ethers.formatEther(wordResults[i]));
        totals.weth += weth;
        totals.eth += eth;
        totals.usdc += usdc;
        totals.word += word;

        return {
          id: r.id,
          name: r.name,
          address: r.address,
          bps: r.bps,
          percent: r.bps / 100,
          wethBalance: weth.toFixed(6),
          ethBalance: eth.toFixed(6),
          usdcBalance: usdc.toFixed(6),
          wordBalance: Math.floor(word).toString(),
        };
      });

      feeRecipientsData = {
        recipients,
        totals: {
          weth: totals.weth.toFixed(6),
          eth: totals.eth.toFixed(6),
          usdc: totals.usdc.toFixed(6),
          word: Math.floor(totals.word).toString(),
        },
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
    // Next Round Seed = min(0.02, 5% of jackpot + treasury)
    // Treasury contributes to seed until 0.02 target is reached
    // Only treasury balance ABOVE what's needed for seed is withdrawable
    // =========================================================================

    const currentJackpotFloat = parseFloat(ethers.formatEther(currentJackpot));
    const treasuryBalance = parseFloat(ethers.formatEther(creatorAccumulated));

    // 5% of current jackpot
    const fivePercentOfJackpot = currentJackpotFloat * 0.05;

    // How much more do we need to reach 0.02 target?
    const shortfallAfterFivePercent = Math.max(0, SEED_TARGET_ETH - fivePercentOfJackpot);

    // Treasury contributes up to the shortfall amount
    const treasuryContribution = Math.min(treasuryBalance, shortfallAfterFivePercent);

    // Total seed = 5% + treasury contribution (capped at 0.02)
    const totalSeed = Math.min(SEED_TARGET_ETH, fivePercentOfJackpot + treasuryContribution);

    // Final shortfall (if 5% + treasury still < 0.02)
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

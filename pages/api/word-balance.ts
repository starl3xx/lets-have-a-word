/**
 * Word Balance API
 * Milestone 14: Returns $WORD holdings, staking status, and tier info
 *
 * GET /api/word-balance?walletAddress=0x...
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { ethers } from 'ethers';
import { getWordBonusTier, getWalletBalance, formatWordTokenBalance } from '../../src/lib/word-token';
import { getStakingInfo } from '../../src/lib/word-manager';
import { isDevModeEnabled } from '../../src/lib/devGameState';
import { WORD_MARKET_CAP_USD } from '../../config/economy';
import { fetchWordTokenMarketCap } from '../../src/lib/word-oracle';

export interface WordBalanceResponse {
  wallet: string;     // Wallet balance in whole tokens
  staked: string;     // Staked balance in whole tokens
  effective: string;  // wallet + staked
  valueUsd: string;   // Approximate USD value
  holderTier: number; // 0-3
  unclaimedRewards: string;
  stakingPoolShare: string; // 0-1 decimal
  stakingAvailable: boolean; // Whether WordManager is deployed
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WordBalanceResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const walletAddress = req.query.walletAddress as string;

  if (!walletAddress || !ethers.isAddress(walletAddress)) {
    return res.status(400).json({ error: 'Valid walletAddress required' });
  }

  // Dev mode: return synthetic data
  if (isDevModeEnabled()) {
    return res.status(200).json({
      wallet: '950000000',
      staked: '300000000',
      effective: '1250000000',
      valueUsd: '387.50',
      holderTier: 3,
      unclaimedRewards: '12500000',
      stakingPoolShare: '0.024',
      stakingAvailable: false,
    });
  }

  try {
    // Get wallet balance, staking info, holder tier, and live price in parallel
    const [walletBalanceWei, stakingInfo, holderTier, liveMarketData] = await Promise.all([
      getWalletBalance(walletAddress),
      getStakingInfo(walletAddress),
      getWordBonusTier(walletAddress),
      fetchWordTokenMarketCap().catch(() => null),
    ]);

    const walletBalance = parseFloat(ethers.formatUnits(walletBalanceWei, 18));
    const stakedBalance = stakingInfo ? parseFloat(ethers.formatUnits(stakingInfo.staked, 18)) : 0;
    const effectiveBalance = walletBalance + stakedBalance;
    const unclaimedRewards = stakingInfo ? parseFloat(ethers.formatUnits(stakingInfo.unclaimed, 18)) : 0;
    const totalStaked = stakingInfo ? parseFloat(ethers.formatUnits(stakingInfo.totalStaked, 18)) : 0;
    const poolShare = totalStaked > 0 ? stakedBalance / totalStaked : 0;

    // Use live price from DexScreener, fall back to env var calculation
    const tokenPrice = liveMarketData?.priceUsd ?? (WORD_MARKET_CAP_USD / 100_000_000_000);
    const valueUsd = effectiveBalance * tokenPrice;

    return res.status(200).json({
      wallet: Math.floor(walletBalance).toString(),
      staked: Math.floor(stakedBalance).toString(),
      effective: Math.floor(effectiveBalance).toString(),
      valueUsd: valueUsd.toFixed(2),
      holderTier,
      unclaimedRewards: Math.floor(unclaimedRewards).toString(),
      stakingPoolShare: poolShare.toFixed(4),
      stakingAvailable: !!process.env.WORD_MANAGER_ADDRESS,
    });
  } catch (error) {
    console.error('[word-balance] Error:', error);
    return res.status(500).json({ error: 'Failed to fetch balance' });
  }
}

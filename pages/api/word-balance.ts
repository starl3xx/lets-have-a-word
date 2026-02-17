/**
 * Word Balance API
 * Milestone 14: Returns $WORD holdings, staking status, and tier info
 * XP-Boosted Staking: Now includes XP tier data when fid is provided
 *
 * GET /api/word-balance?walletAddress=0x...&fid=12345
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { ethers } from 'ethers';
import { getWordBonusTier, getWalletBalance, formatWordTokenBalance } from '../../src/lib/word-token';
import { getStakingInfo, getRewardInfo } from '../../src/lib/word-manager';
import { isDevModeEnabled } from '../../src/lib/devGameState';
import { WORD_MARKET_CAP_USD, getXpStakingTier, getMinStakeForBoost, XP_STAKING_TIERS } from '../../config/economy';
import { fetchWordTokenMarketCap } from '../../src/lib/word-oracle';
import { getTotalXpForFid, getSevenDayXpRate } from '../../src/lib/xp';

export interface WordBalanceResponse {
  wallet: string;     // Wallet balance in whole tokens
  staked: string;     // Staked balance in whole tokens
  effective: string;  // wallet + staked
  valueUsd: string;   // Approximate USD value
  holderTier: number; // 0-3
  unclaimedRewards: string;
  stakingPoolShare: string; // 0-1 decimal
  stakingAvailable: boolean; // Whether WordManager is deployed
  // V3: Reward period info for frontend APR/timer
  rewardRate: string;       // $WORD per second (wei string)
  periodFinish: number;     // Unix timestamp when period ends
  rewardsDuration: number;  // Duration in seconds
  // XP staking tier fields
  xpStakingTier: number;        // 0-3
  xpStakingMultiplier: number;  // 1.0 / 1.15 / 1.35 / 1.60
  xpStakingTierName: string;    // "Passive" / "Bronze" / "Silver" / "Gold"
  xpTotal: number;
  xpToNextTier: number | null;  // null if max tier
  nextTierName: string | null;
  xpDailyRate: number;          // 7-day rolling avg
  minStakeForBoost: number;     // whole tokens
  meetsMinStake: boolean;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WordBalanceResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const walletAddress = req.query.walletAddress as string;
  const fid = req.query.fid ? parseInt(req.query.fid as string, 10) : null;

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
      rewardRate: '38580246913580246',
      periodFinish: Math.floor(Date.now() / 1000) + 86400 * 20,
      rewardsDuration: 2592000,
      xpStakingTier: 2,
      xpStakingMultiplier: 1.35,
      xpStakingTierName: 'Silver',
      xpTotal: 7200,
      xpToNextTier: 7800,
      nextTierName: 'Gold',
      xpDailyRate: 58,
      minStakeForBoost: 100_000_000,
      meetsMinStake: true,
    });
  }

  try {
    // Get wallet balance, staking info, reward info, holder tier, live price, and XP data in parallel
    const [walletBalanceWei, stakingInfo, rewardInfo, holderTier, liveMarketData, totalXp, xpRate] = await Promise.all([
      getWalletBalance(walletAddress),
      getStakingInfo(walletAddress),
      getRewardInfo(),
      getWordBonusTier(walletAddress),
      fetchWordTokenMarketCap().catch(() => null),
      fid ? getTotalXpForFid(fid) : Promise.resolve(0),
      fid ? getSevenDayXpRate(fid) : Promise.resolve({ totalInPeriod: 0, dailyAverage: 0 }),
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

    // XP staking tier
    const currentMarketCap = liveMarketData?.marketCap ?? WORD_MARKET_CAP_USD;
    const xpTier = getXpStakingTier(totalXp);
    const nextTierIndex = xpTier.tier + 1;
    const nextTier = nextTierIndex < XP_STAKING_TIERS.length ? XP_STAKING_TIERS[nextTierIndex] : null;
    const xpToNextTier = nextTier ? nextTier.xpThreshold - totalXp : null;
    const minStake = getMinStakeForBoost(currentMarketCap);

    return res.status(200).json({
      wallet: Math.floor(walletBalance).toString(),
      staked: Math.floor(stakedBalance).toString(),
      effective: Math.floor(effectiveBalance).toString(),
      valueUsd: valueUsd.toFixed(2),
      holderTier,
      unclaimedRewards: Math.floor(unclaimedRewards).toString(),
      stakingPoolShare: poolShare.toFixed(4),
      stakingAvailable: !!process.env.WORD_MANAGER_ADDRESS,
      rewardRate: rewardInfo?.rewardRate?.toString() ?? '0',
      periodFinish: rewardInfo ? Number(rewardInfo.periodFinish) : 0,
      rewardsDuration: rewardInfo ? Number(rewardInfo.rewardsDuration) : 0,
      xpStakingTier: xpTier.tier,
      xpStakingMultiplier: xpTier.multiplier,
      xpStakingTierName: xpTier.name,
      xpTotal: totalXp,
      xpToNextTier,
      nextTierName: nextTier?.name ?? null,
      xpDailyRate: Math.round(xpRate.dailyAverage),
      minStakeForBoost: minStake,
      meetsMinStake: effectiveBalance >= minStake,
    });
  } catch (error) {
    console.error('[word-balance] Error:', error);
    return res.status(500).json({ error: 'Failed to fetch balance' });
  }
}

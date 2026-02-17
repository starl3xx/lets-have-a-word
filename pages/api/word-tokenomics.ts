/**
 * Word Tokenomics API
 * Milestone 14: Returns live $WORD tokenomics stats
 *
 * GET /api/word-tokenomics
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { ethers } from 'ethers';
import { WORD_TOKEN_ADDRESS, getBaseProvider } from '../../src/lib/word-token';
import { getTotalBurned, getTotalStaked } from '../../src/lib/word-manager';
import { isDevModeEnabled } from '../../src/lib/devGameState';
import { WORD_MARKET_CAP_USD } from '../../config/economy';
import { fetchWordTokenMarketCap } from '../../src/lib/word-oracle';
import { db } from '../../src/db';
import { wordRewards } from '../../src/db/schema';
import { eq, sql } from 'drizzle-orm';

export interface WordTokenomicsResponse {
  totalSupply: string;
  totalBurned: string;
  totalStaked: string;
  marketCap: string;
  price: string;
  feeDistribution: {
    gameTreasury: string;
    buybackStake: string;
    playerRewards: string;
    top10Referral: string;
  };
  burnStats: {
    totalBurned: string;
    burnWordsFound: number;
  };
  bonusStats: {
    totalDistributed: string;
    bonusWordsFound: number;
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WordTokenomicsResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Dev mode: return synthetic data
  if (isDevModeEnabled()) {
    return res.status(200).json({
      totalSupply: '98750000000',
      totalBurned: '1250000000',
      totalStaked: '5000000000',
      marketCap: WORD_MARKET_CAP_USD.toString(),
      price: '0.00000031',
      feeDistribution: {
        gameTreasury: '50%',
        buybackStake: '25%',
        playerRewards: '15%',
        top10Referral: '10%',
      },
      burnStats: { totalBurned: '1250000000', burnWordsFound: 187 },
      bonusStats: { totalDistributed: '2800000000', bonusWordsFound: 412 },
    });
  }

  try {
    // Onchain reads
    const provider = getBaseProvider();
    const tokenContract = new ethers.Contract(
      WORD_TOKEN_ADDRESS,
      ['function totalSupply() view returns (uint256)'],
      provider
    );

    const [totalSupplyWei, totalBurnedWei, totalStakedWei, liveMarketData] = await Promise.all([
      tokenContract.totalSupply().catch(() => 100_000_000_000n * 10n ** 18n), // fallback: 100B
      getTotalBurned().then(v => v ?? 0n),
      getTotalStaked().then(v => v ?? 0n),
      fetchWordTokenMarketCap().catch(() => null),
    ]);

    const totalSupply = parseFloat(ethers.formatUnits(totalSupplyWei, 18));
    const totalBurned = parseFloat(ethers.formatUnits(totalBurnedWei, 18));
    const totalStaked = parseFloat(ethers.formatUnits(totalStakedWei, 18));

    // Use live DexScreener data, fall back to env var
    const marketCapUsd = liveMarketData?.marketCapUsd ?? WORD_MARKET_CAP_USD;
    const price = liveMarketData?.priceUsd ?? (totalSupply > 0 ? marketCapUsd / totalSupply : 0);

    // DB aggregates for burn/bonus stats
    const [burnStats, bonusStats] = await Promise.all([
      db.select({
        count: sql<number>`count(*)`,
        total: sql<string>`coalesce(sum(cast(amount as numeric)), 0)`,
      }).from(wordRewards).where(eq(wordRewards.rewardType, 'burn')),
      db.select({
        count: sql<number>`count(*)`,
        total: sql<string>`coalesce(sum(cast(amount as numeric)), 0)`,
      }).from(wordRewards).where(eq(wordRewards.rewardType, 'bonus_word')),
    ]);

    const burnCount = Number(burnStats[0]?.count ?? 0);
    const burnTotal = burnStats[0]?.total ?? '0';
    const bonusCount = Number(bonusStats[0]?.count ?? 0);
    const bonusTotal = bonusStats[0]?.total ?? '0';

    // Convert wei totals to whole tokens for display
    const burnTotalTokens = burnTotal !== '0'
      ? Math.floor(parseFloat(ethers.formatUnits(BigInt(burnTotal), 18))).toString()
      : '0';
    const bonusTotalTokens = bonusTotal !== '0'
      ? Math.floor(parseFloat(ethers.formatUnits(BigInt(bonusTotal), 18))).toString()
      : '0';

    return res.status(200).json({
      totalSupply: Math.floor(totalSupply).toString(),
      totalBurned: Math.floor(totalBurned).toString(),
      totalStaked: Math.floor(totalStaked).toString(),
      marketCap: marketCapUsd.toString(),
      price: price.toFixed(12),
      feeDistribution: {
        gameTreasury: '50%',
        buybackStake: '25%',
        playerRewards: '15%',
        top10Referral: '10%',
      },
      burnStats: { totalBurned: burnTotalTokens, burnWordsFound: burnCount },
      bonusStats: { totalDistributed: bonusTotalTokens, bonusWordsFound: bonusCount },
    });
  } catch (error) {
    console.error('[word-tokenomics] Error:', error);
    return res.status(500).json({ error: 'Failed to fetch tokenomics' });
  }
}

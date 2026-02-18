/**
 * WordSheet Component
 * Milestone 14: Full-height bottom sheet for $WORD token info
 * XP-Boosted Staking: Now passes fid for XP tier data + refetch callback
 *
 * Sections:
 * 1. Holdings header — balance, tier, USD value, Buy button
 * 2. Staking card — staked amount, unclaimed rewards
 * 3. Tokenomics — supply, burned, fee distribution, game stats
 */

import { useState, useEffect, useCallback } from 'react';
import { triggerHaptic } from '../src/lib/haptics';
import WordHoldings from './word/WordHoldings';
import StakingModal from './word/StakingModal';
import TokenomicsOverview from './word/TokenomicsOverview';
import BuyButton from './word/BuyButton';
import type { WordBalanceResponse } from '../pages/api/word-balance';
import type { WordTokenomicsResponse } from '../pages/api/word-tokenomics';

interface WordSheetProps {
  walletAddress: string | null;
  fid: number | null;
  onClose: () => void;
}

export default function WordSheet({ walletAddress, fid, onClose }: WordSheetProps) {
  const [balanceData, setBalanceData] = useState<WordBalanceResponse | null>(null);
  const [tokenomicsData, setTokenomicsData] = useState<WordTokenomicsResponse | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState(true);
  const [isLoadingTokenomics, setIsLoadingTokenomics] = useState(true);
  const [showStakingModal, setShowStakingModal] = useState(false);

  const fetchBalance = useCallback(async () => {
    if (!walletAddress) return;
    try {
      const params = new URLSearchParams({ walletAddress });
      if (fid) params.set('fid', String(fid));
      const res = await fetch(`/api/word-balance?${params}`);
      if (res.ok) {
        const data = await res.json();
        setBalanceData(data);
      }
    } catch (err) {
      console.error('[WordSheet] Balance fetch failed:', err);
    }
  }, [walletAddress, fid]);

  useEffect(() => {
    const fetchData = async () => {
      // Fetch tokenomics (always available, no wallet needed)
      const tokenomicsPromise = fetch('/api/word-tokenomics')
        .then(async (res) => {
          if (res.ok) {
            const data = await res.json();
            setTokenomicsData(data);
          }
        })
        .catch((err) => console.error('[WordSheet] Tokenomics fetch failed:', err))
        .finally(() => setIsLoadingTokenomics(false));

      // Fetch balance (only if wallet connected)
      if (walletAddress) {
        const balancePromise = fetchBalance().finally(() => setIsLoadingBalance(false));
        await Promise.all([tokenomicsPromise, balancePromise]);
      } else {
        setIsLoadingBalance(false);
        await tokenomicsPromise;
      }
    };

    fetchData();
  }, [walletAddress, fetchBalance]);

  const refetchBalance = useCallback(() => {
    fetchBalance();
  }, [fetchBalance]);

  return (
    <>
      <div className="modal-backdrop" onClick={onClose}>
        <div
          className="modal-sheet"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-200 pb-4 mb-4">
            <div className="flex items-center gap-2">
              <img
                src="/word-token-logo.png"
                alt="$WORD"
                className="w-8 h-8 rounded-full border border-gray-200"
              />
              <h2 className="text-xl font-bold text-gray-900">$WORD</h2>
            </div>
            <button onClick={onClose} className="btn-close" aria-label="Close">
              ×
            </button>
          </div>

          {/* Holdings section */}
          {walletAddress ? (
            isLoadingBalance ? (
              <div className="section-card animate-pulse mb-4">
                <div className="h-4 bg-gray-200 rounded w-1/3 mb-2"></div>
                <div className="h-6 bg-gray-200 rounded w-2/3 mb-2"></div>
                <div className="h-3 bg-gray-200 rounded w-1/4"></div>
              </div>
            ) : balanceData ? (
              <div className="mb-4">
                <WordHoldings
                  wallet={balanceData.wallet}
                  staked={balanceData.staked}
                  effective={balanceData.effective}
                  valueUsd={balanceData.valueUsd}
                  holderTier={balanceData.holderTier}
                  stakingAvailable={balanceData.stakingAvailable}
                  onStakingClick={() => {
                    triggerHaptic('light');
                    setShowStakingModal(true);
                  }}
                />
              </div>
            ) : (
              <div className="section-card mb-4 text-center">
                <p className="text-sm text-gray-500">Failed to load balance</p>
                <BuyButton className="mt-3" size="sm" />
              </div>
            )
          ) : (
            /* No wallet connected */
            <div className="section-card mb-4 text-center space-y-3">
              <div className="text-3xl">💰</div>
              <p className="text-sm text-gray-600">
                Connect your wallet to see your $WORD balance and holder tier bonus.
              </p>
              <BuyButton size="sm" />
            </div>
          )}

          {/* Tokenomics section */}
          <TokenomicsOverview data={tokenomicsData} isLoading={isLoadingTokenomics} />

          {/* Market cap & price */}
          {tokenomicsData && (
            <div className="mt-3 section-card">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Market cap</span>
                <span className="font-semibold text-gray-900">
                  ${parseInt(tokenomicsData.marketCap).toLocaleString('en-US')}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Staking modal overlay */}
      {showStakingModal && balanceData && (
        <StakingModal
          stakedBalance={balanceData.staked}
          unclaimedRewards={balanceData.unclaimedRewards}
          stakingPoolShare={balanceData.stakingPoolShare}
          stakingAvailable={balanceData.stakingAvailable}
          walletAddress={walletAddress as `0x${string}` | null}
          walletBalance={balanceData.wallet}
          rewardRate={balanceData.rewardRate}
          periodFinish={balanceData.periodFinish}
          rewardsDuration={balanceData.rewardsDuration}
          xpStakingTier={balanceData.xpStakingTier}
          xpStakingMultiplier={balanceData.xpStakingMultiplier}
          xpStakingTierName={balanceData.xpStakingTierName}
          xpTotal={balanceData.xpTotal}
          xpToNextTier={balanceData.xpToNextTier}
          nextTierName={balanceData.nextTierName}
          xpDailyRate={balanceData.xpDailyRate}
          minStakeForBoost={balanceData.minStakeForBoost}
          meetsMinStake={balanceData.meetsMinStake}
          onStakingAction={refetchBalance}
          onClose={() => setShowStakingModal(false)}
        />
      )}
    </>
  );
}

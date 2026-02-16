/**
 * StakingModal Component
 * Milestone 14: 3-tab modal for Stake / Unstake / Claim Rewards
 *
 * Staking is user-initiated (wallet signs tx directly via Wagmi).
 * When WordManager is not deployed, shows "Coming Soon" state.
 */

import { useState } from 'react';

interface StakingModalProps {
  stakedBalance: string;
  unclaimedRewards: string;
  stakingPoolShare: string;
  stakingAvailable: boolean;
  onClose: () => void;
}

type StakingTab = 'stake' | 'unstake' | 'rewards';

function formatTokenAmount(amount: string): string {
  const num = parseInt(amount, 10);
  if (isNaN(num) || num === 0) return '0';
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2)}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  return num.toLocaleString('en-US');
}

export default function StakingModal({
  stakedBalance,
  unclaimedRewards,
  stakingPoolShare,
  stakingAvailable,
  onClose,
}: StakingModalProps) {
  const [activeTab, setActiveTab] = useState<StakingTab>('stake');

  const tabs: { key: StakingTab; label: string }[] = [
    { key: 'stake', label: 'Stake' },
    { key: 'unstake', label: 'Unstake' },
    { key: 'rewards', label: 'Rewards' },
  ];

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">$WORD Staking</h3>
          <button onClick={onClose} className="btn-close" aria-label="Close">
            ×
          </button>
        </div>

        {!stakingAvailable ? (
          /* Coming Soon state */
          <div className="text-center py-8 space-y-3">
            <div className="text-4xl">🔒</div>
            <h4 className="text-lg font-semibold text-gray-700">Staking Coming Soon</h4>
            <p className="text-sm text-gray-500">
              The $WORD staking contract is being finalized. Once deployed, you'll be able to stake your tokens to earn rewards and increase your effective balance for higher bonus tiers.
            </p>
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div className="flex bg-gray-100 rounded-lg p-1">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-all ${
                    activeTab === tab.key
                      ? 'bg-white text-purple-700 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-gray-50 rounded-lg p-2">
                <div className="text-xs text-gray-500">Staked</div>
                <div className="text-sm font-bold">{formatTokenAmount(stakedBalance)}</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-2">
                <div className="text-xs text-gray-500">Rewards</div>
                <div className="text-sm font-bold text-green-600">{formatTokenAmount(unclaimedRewards)}</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-2">
                <div className="text-xs text-gray-500">Pool Share</div>
                <div className="text-sm font-bold">{(parseFloat(stakingPoolShare) * 100).toFixed(2)}%</div>
              </div>
            </div>

            {/* Tab content */}
            <div className="min-h-[120px]">
              {activeTab === 'stake' && (
                <div className="text-center py-6 text-sm text-gray-500">
                  <p>Stake your $WORD tokens to earn staking rewards and boost your effective balance for higher holder tiers.</p>
                  <p className="mt-2 text-xs text-gray-400">Connect your wallet to stake tokens directly via the $WORD contract.</p>
                </div>
              )}
              {activeTab === 'unstake' && (
                <div className="text-center py-6 text-sm text-gray-500">
                  <p>Withdraw your staked $WORD tokens back to your wallet.</p>
                  <p className="mt-2 text-xs text-gray-400">Note: Unstaking will reduce your effective balance and may lower your holder tier.</p>
                </div>
              )}
              {activeTab === 'rewards' && (
                <div className="text-center py-6 space-y-3">
                  <div className="text-sm text-gray-500">
                    You have <span className="font-bold text-green-600">{formatTokenAmount(unclaimedRewards)}</span> unclaimed $WORD rewards.
                  </div>
                  <p className="text-xs text-gray-400">Claim your staking rewards to your wallet.</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

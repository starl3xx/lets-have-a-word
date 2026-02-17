/**
 * WordHoldings Component
 * Milestone 14: Displays $WORD token balance, tier, and USD value
 */

import { formatTokenAmount } from '../../src/lib/format';

interface WordHoldingsProps {
  wallet: string;
  staked: string;
  effective: string;
  valueUsd: string;
  holderTier: number;
  stakingAvailable: boolean;
  onBuyClick: () => void;
}

const TIER_LABELS: Record<number, string> = {
  0: 'No Tier',
  1: 'Tier 1',
  2: 'Tier 2',
  3: 'Tier 3',
};

const TIER_COLORS: Record<number, string> = {
  0: '#9ca3af', // gray-400
  1: '#a78bfa', // purple-400
  2: '#8b5cf6', // purple-500
  3: '#7c3aed', // purple-600
};


export default function WordHoldings({
  wallet,
  staked,
  effective,
  valueUsd,
  holderTier,
  stakingAvailable,
  onBuyClick,
}: WordHoldingsProps) {
  const tierLabel = TIER_LABELS[holderTier] || 'No Tier';
  const tierColor = TIER_COLORS[holderTier] || '#9ca3af';
  const bonusGuesses = holderTier; // tier 1 = +1, tier 2 = +2, tier 3 = +3

  return (
    <div className="section-card">
      {/* Top row: Total balance + tier badge */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-xs text-gray-500 uppercase tracking-wider font-medium">Total balance</div>
          <div className="text-2xl font-bold text-gray-900">{formatTokenAmount(effective)} $WORD</div>
          <div className="text-sm text-gray-500">${valueUsd} USD</div>
        </div>
        <div
          className="px-3 py-1.5 rounded-full text-sm font-bold text-white"
          style={{ backgroundColor: tierColor }}
        >
          {tierLabel}
          {bonusGuesses > 0 && <span className="ml-1">+{bonusGuesses}</span>}
        </div>
      </div>

      {/* Balance breakdown */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-gray-50 rounded-lg p-3">
          <div className="text-xs text-gray-500">Wallet</div>
          <div className="text-sm font-semibold text-gray-900">{formatTokenAmount(wallet)}</div>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <div className="text-xs text-gray-500">
            Staked {!stakingAvailable && <span className="text-gray-400">(coming soon)</span>}
          </div>
          <div className="text-sm font-semibold text-gray-900">{formatTokenAmount(staked)}</div>
        </div>
      </div>

      {/* Buy button */}
      <button
        onClick={onBuyClick}
        className="w-full py-2.5 px-4 bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-700 hover:to-purple-600 text-white rounded-xl font-semibold transition-all text-sm"
      >
        Buy $WORD
      </button>
    </div>
  );
}

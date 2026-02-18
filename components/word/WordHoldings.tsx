/**
 * WordHoldings Component
 * Milestone 14: Displays $WORD token balance, tier, and USD value
 */

import { formatTokenAmount } from '../../src/lib/format';
import BuyButton from './BuyButton';

interface WordHoldingsProps {
  wallet: string;
  staked: string;
  effective: string;
  valueUsd: string;
  holderTier: number;
  stakingAvailable: boolean;
  onStakingClick?: () => void;
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
  onStakingClick,
}: WordHoldingsProps) {
  const tierLabel = TIER_LABELS[holderTier] || 'No Tier';
  const tierColor = TIER_COLORS[holderTier] || '#9ca3af';
  const bonusGuesses = holderTier; // tier 1 = +1, tier 2 = +2, tier 3 = +3

  return (
    <div className="space-y-3">
      {/* Hero balance */}
      <div className="section-card bg-gradient-to-br from-brand-50 to-indigo-50 text-center">
        <p className="text-sm text-brand-700 font-medium">Your $WORD</p>
        <p className="text-4xl font-extrabold text-brand-900 tabular-nums">{formatTokenAmount(effective)}</p>
        <div className="flex items-center justify-center gap-2 mt-1">
          <span className="text-sm text-brand-600">${valueUsd} USD</span>
          <div
            className="px-2.5 py-0.5 rounded-full text-xs font-bold text-white"
            style={{ backgroundColor: tierColor }}
          >
            {tierLabel}
            {bonusGuesses > 0 && <span className="ml-1">+{bonusGuesses}</span>}
          </div>
        </div>
      </div>

      {/* Balance breakdown */}
      <div className="section-card bg-brand-50">
        <h3 className="text-base font-semibold text-brand-900">Balance</h3>
        <div className="grid grid-cols-2 gap-3 mt-2">
          <div className="bg-white rounded-lg p-3 text-center border border-brand-100">
            <p className="text-xs text-brand-600">Wallet</p>
            <p className="text-lg font-bold text-brand-900 tabular-nums">{formatTokenAmount(wallet)}</p>
          </div>
          <div className="bg-white rounded-lg p-3 text-center border border-brand-100">
            <p className="text-xs text-brand-600">
              Staked {!stakingAvailable && <span className="text-brand-400">(coming soon)</span>}
            </p>
            <p className="text-lg font-bold text-brand-900 tabular-nums">{formatTokenAmount(staked)}</p>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <BuyButton className="flex-1" />
        {onStakingClick && (
          <button
            onClick={onStakingClick}
            className="flex-1 py-2.5 px-5 bg-gray-100 hover:bg-gray-200 rounded-xl text-base font-semibold text-gray-700 transition-all"
          >
            Staking
          </button>
        )}
      </div>
    </div>
  );
}

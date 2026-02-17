/**
 * TokenomicsOverview Component
 * Milestone 14: Displays $WORD token supply, burn stats, and fee distribution
 */

import type { WordTokenomicsResponse } from '../../pages/api/word-tokenomics';
import { formatTokenAmount } from '../../src/lib/format';

interface TokenomicsOverviewProps {
  data: WordTokenomicsResponse | null;
  isLoading: boolean;
}


export default function TokenomicsOverview({ data, isLoading }: TokenomicsOverviewProps) {
  if (isLoading) {
    return (
      <div className="section-card animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-1/3 mb-3"></div>
        <div className="space-y-2">
          <div className="h-3 bg-gray-200 rounded w-2/3"></div>
          <div className="h-3 bg-gray-200 rounded w-1/2"></div>
          <div className="h-3 bg-gray-200 rounded w-3/4"></div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="section-card">
        <p className="text-sm text-gray-500 text-center">Failed to load tokenomics data</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Supply stats */}
      <div className="section-card">
        <h4 className="text-xs uppercase tracking-wider text-gray-500 font-medium mb-3">Supply</h4>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <div className="text-lg font-bold text-gray-900">{formatTokenAmount(data.totalSupply)}</div>
            <div className="text-xs text-gray-500">Total supply</div>
          </div>
          <div>
            <div className="text-lg font-bold text-red-600">{formatTokenAmount(data.totalBurned)}</div>
            <div className="text-xs text-gray-500">Burned</div>
          </div>
          <div>
            <div className="text-lg font-bold text-purple-600">{formatTokenAmount(data.totalStaked)}</div>
            <div className="text-xs text-gray-500">Staked</div>
          </div>
        </div>
      </div>

      {/* Game stats */}
      <div className="section-card">
        <h4 className="text-xs uppercase tracking-wider text-gray-500 font-medium mb-3">Game activity</h4>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-red-50 rounded-lg p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-sm">🔥</span>
              <span className="text-xs font-medium text-red-700">Burn words</span>
            </div>
            <div className="text-lg font-bold text-red-700">{data.burnStats.burnWordsFound}</div>
            <div className="text-xs text-red-500">{formatTokenAmount(data.burnStats.totalBurned)} tokens burned</div>
          </div>
          <div className="bg-purple-50 rounded-lg p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-sm">🎣</span>
              <span className="text-xs font-medium text-purple-700">Bonus words</span>
            </div>
            <div className="text-lg font-bold text-purple-700">{data.bonusStats.bonusWordsFound}</div>
            <div className="text-xs text-purple-500">{formatTokenAmount(data.bonusStats.totalDistributed)} distributed</div>
          </div>
        </div>
      </div>

      {/* Fee distribution */}
      <div className="section-card">
        <h4 className="text-xs uppercase tracking-wider text-gray-500 font-medium mb-3">Fee distribution</h4>
        <div className="space-y-2">
          {[
            { label: 'Game treasury', value: data.feeDistribution.gameTreasury, color: '#2D68C7' },
            { label: 'Buyback & stake', value: data.feeDistribution.buybackStake, color: '#7c3aed' },
            { label: 'Player rewards', value: data.feeDistribution.playerRewards, color: '#10b981' },
            { label: 'Top 10 referral', value: data.feeDistribution.top10Referral, color: '#f59e0b' },
          ].map(({ label, value, color }) => (
            <div key={label} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-gray-700">{label}</span>
              </div>
              <span className="font-semibold text-gray-900">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * QC Preview Page
 * Milestone 14: Standalone page for visual QC of all new components
 *
 * Accessible at /preview (dev mode only)
 * Uses hardcoded mock data — no API calls, no auth required.
 */

import { useState } from 'react';
import Head from 'next/head';
import BurnWordModal from '../components/BurnWordModal';
import BonusWordWinModal from '../components/BonusWordWinModal';
import WordHoldings from '../components/word/WordHoldings';
import StakingModal from '../components/word/StakingModal';
import TokenomicsOverview from '../components/word/TokenomicsOverview';
import BuyButton from '../components/word/BuyButton';
import type { WordTokenomicsResponse } from './api/word-tokenomics';
import type { GuessSourceState } from '../src/types';

// Mock tokenomics data
const MOCK_TOKENOMICS: WordTokenomicsResponse = {
  totalSupply: '98750000000',
  totalBurned: '1250000000',
  totalStaked: '5000000000',
  marketCap: '125000',
  price: '0.00000127',
  feeDistribution: {
    gameTreasury: '50%',
    buybackStake: '25%',
    playerRewards: '15%',
    top10Referral: '10%',
  },
  burnStats: { totalBurned: '1250000000', burnWordsFound: 187 },
  bonusStats: { totalDistributed: '2800000000', bonusWordsFound: 412 },
};

// Mock guess source states for each tier
function mockSourceState(tier: number): GuessSourceState {
  return {
    totalRemaining: 1 + tier + 1, // free + word + share
    free: { total: 1, used: 0, remaining: 1 },
    wordToken: {
      total: tier,
      used: 0,
      remaining: tier,
      isHolder: tier > 0,
    },
    share: { total: 1, used: 0, remaining: 1 },
    paid: { total: 0, used: 0, remaining: 0 },
  };
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="mt-8 mb-4 px-4">
      <h2 className="text-lg font-bold text-gray-800 border-b-2 border-purple-300 pb-2">
        {title}
      </h2>
    </div>
  );
}

export default function PreviewPage() {
  const [showBurnModal, setShowBurnModal] = useState(false);
  const [showBonusModal, setShowBonusModal] = useState(false);
  const [showStakingModal, setShowStakingModal] = useState(false);

  // Only allow in dev mode
  const isDev = process.env.NEXT_PUBLIC_LHAW_DEV_MODE === 'true';

  if (!isDev) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-700 mb-2">Preview Unavailable</h1>
          <p className="text-gray-500">This page is only available in dev mode.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>QC Preview — Let's Have A Word M14</title>
      </Head>
      <div className="min-h-screen bg-gray-100 pb-20">
        {/* Page header */}
        <div className="bg-white border-b border-gray-200 px-4 py-4 sticky top-0 z-10">
          <h1 className="text-xl font-bold text-gray-900">Milestone 14 — QC Preview</h1>
          <p className="text-sm text-gray-500">All new components with mock data</p>
        </div>

        {/* ─── GuessBar Tier Variants ─── */}
        <SectionHeader title="GuessBar — Tier Variants" />
        <div className="px-4 space-y-2">
          {[0, 1, 2, 3].map((tier) => {
            const state = mockSourceState(tier);
            return (
              <div key={tier} className="bg-white rounded-lg border border-gray-200 p-3">
                <div className="text-xs text-gray-400 mb-1 font-mono">Tier {tier} {tier === 0 ? '(non-holder)' : `(+${tier} $WORD)`}</div>
                <div className="text-center py-2 flex items-center justify-center gap-2 whitespace-nowrap overflow-hidden" style={{ minHeight: '2.5rem' }}>
                  <span
                    className="text-sm whitespace-nowrap inline-flex items-center rounded-full"
                    style={{
                      padding: '2px 8px 3px 6px',
                      backgroundColor: 'rgba(34, 197, 94, 0.12)',
                      color: '#166534',
                      fontWeight: 400,
                      lineHeight: 1.2,
                    }}
                  >
                    <span style={{ fontWeight: 700 }}>{state.totalRemaining}</span>
                    &nbsp;
                    <span style={{ fontWeight: 400 }}>guesses left</span>
                  </span>
                  <span className="text-gray-400">|</span>
                  <span className="text-sm whitespace-nowrap" style={{ color: '#4b5563', fontWeight: 400 }}>
                    <span>1 free</span>
                    {tier > 0 ? (
                      <span style={{ color: '#7c3aed' }}> +{tier} $WORD</span>
                    ) : (
                      <span style={{ color: '#a78bfa', opacity: 0.5 }}>
                        <span className="line-through"> +1 $WORD</span>
                      </span>
                    )}
                    <span style={{ color: '#0891b2' }}> +1 share</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* ─── WordHoldings ─── */}
        <SectionHeader title="WordHoldings Component" />
        <div className="px-4 space-y-3">
          {[
            { wallet: '950000000', staked: '300000000', effective: '1250000000', valueUsd: '387.50', holderTier: 3, stakingAvailable: true },
            { wallet: '75000000', staked: '0', effective: '75000000', valueUsd: '23.25', holderTier: 1, stakingAvailable: false },
            { wallet: '0', staked: '0', effective: '0', valueUsd: '0.00', holderTier: 0, stakingAvailable: false },
          ].map((props, i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-200 p-3">
              <div className="text-xs text-gray-400 mb-2 font-mono">Tier {props.holderTier}</div>
              <WordHoldings {...props} onBuyClick={() => {}} />
            </div>
          ))}
        </div>

        {/* ─── TokenomicsOverview ─── */}
        <SectionHeader title="TokenomicsOverview Component" />
        <div className="px-4">
          <TokenomicsOverview data={MOCK_TOKENOMICS} isLoading={false} />
        </div>

        {/* ─── BuyButton ─── */}
        <SectionHeader title="BuyButton Variants" />
        <div className="px-4 flex gap-3">
          <BuyButton size="sm" />
          <BuyButton size="md" />
        </div>

        {/* ─── Modal Triggers ─── */}
        <SectionHeader title="Modal Triggers" />
        <div className="px-4 space-y-2">
          <button
            onClick={() => setShowBurnModal(true)}
            className="w-full py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl font-semibold"
          >
            Show BurnWordModal
          </button>
          <button
            onClick={() => setShowBonusModal(true)}
            className="w-full py-3 bg-gradient-to-r from-purple-500 to-cyan-500 text-white rounded-xl font-semibold"
          >
            Show BonusWordWinModal
          </button>
          <button
            onClick={() => setShowStakingModal(true)}
            className="w-full py-3 bg-gradient-to-r from-purple-600 to-purple-500 text-white rounded-xl font-semibold"
          >
            Show StakingModal (Coming Soon)
          </button>
        </div>

        {/* ─── 4-Tab Nav Preview ─── */}
        <SectionHeader title="4-Tab Navigation" />
        <div className="px-4">
          <div className="grid grid-cols-4 gap-2">
            <button className="py-2 px-3 bg-white border-2 border-gray-200 rounded-lg text-xs font-semibold text-gray-700">
              📊 Stats
            </button>
            <button className="py-2 px-3 bg-white border-2 border-gray-200 rounded-lg text-xs font-semibold text-gray-700">
              🤝 Refer
            </button>
            <button className="py-2 px-3 bg-white border-2 border-purple-200 rounded-lg text-xs font-semibold text-purple-700">
              💰 $WORD
            </button>
            <button className="py-2 px-3 bg-white border-2 border-gray-200 rounded-lg text-xs font-semibold text-gray-700">
              🤔 FAQ
            </button>
          </div>
        </div>
      </div>

      {/* Modals */}
      {showBurnModal && (
        <BurnWordModal
          word="FLAME"
          burnAmount="5000000"
          txHash="0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
          onClose={() => setShowBurnModal(false)}
        />
      )}
      {showBonusModal && (
        <BonusWordWinModal
          word="CRANE"
          tokenRewardAmount="5000000"
          txHash="0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd"
          onClose={() => setShowBonusModal(false)}
        />
      )}
      {showStakingModal && (
        <StakingModal
          stakedBalance="300000000"
          unclaimedRewards="12500000"
          stakingPoolShare="0.024"
          stakingAvailable={false}
          onClose={() => setShowStakingModal(false)}
        />
      )}
    </>
  );
}

/**
 * StakingModal Component
 * XP-Boosted Staking: Full 3-tab modal with live stake/unstake/claim,
 * XP tier progression card, ticking reward counter, and tier-up celebration.
 *
 * When WordManager is not deployed, shows "Coming Soon" state.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { formatTokenAmount } from '../../src/lib/format';
import { useStaking, type StakingPhase } from '../../src/hooks/useStaking';
import { triggerHaptic } from '../../src/lib/haptics';

// XP tier constants (duplicated client-side — 4 static entries, never changes at runtime)
const XP_TIERS = [
  { tier: 0, name: 'Passive',  xpThreshold: 0,      multiplier: 1.00, color: '#9CA3AF' },
  { tier: 1, name: 'Bronze',   xpThreshold: 1_000,  multiplier: 1.15, color: '#CD7F32' },
  { tier: 2, name: 'Silver',   xpThreshold: 5_000,  multiplier: 1.35, color: '#A0AEC0' },
  { tier: 3, name: 'Gold',     xpThreshold: 15_000, multiplier: 1.60, color: '#F59E0B' },
] as const;

interface StakingModalProps {
  stakedBalance: string;
  unclaimedRewards: string;
  stakingPoolShare: string;
  stakingAvailable: boolean;
  walletAddress: `0x${string}` | null;
  walletBalance: string;
  // V3: Reward period info
  rewardRate: string;       // $WORD per second (wei string)
  periodFinish: number;     // Unix timestamp
  rewardsDuration: number;  // seconds
  // XP tier fields
  xpStakingTier: number;
  xpStakingMultiplier: number;
  xpStakingTierName: string;
  xpTotal: number;
  xpToNextTier: number | null;
  nextTierName: string | null;
  xpDailyRate: number;
  minStakeForBoost: number;
  meetsMinStake: boolean;
  onStakingAction: () => void;
  onClose: () => void;
}

type StakingTab = 'stake' | 'unstake' | 'rewards';

/** Map raw viem/wallet errors to friendly one-liners */
function getFriendlyError(error: Error | null): string {
  if (!error) return 'Something went wrong. Please try again.';
  const msg = error.message.toLowerCase();
  if (msg.includes('user rejected') || msg.includes('user denied') || msg.includes('rejected the request'))
    return 'Transaction cancelled.';
  if (msg.includes('insufficient funds') || msg.includes('exceeds the balance'))
    return 'Insufficient funds for gas.';
  if (msg.includes('reverted') || msg.includes('transaction failure'))
    return 'Transaction failed. Please try again.';
  if (msg.includes('transfer failed') || msg.includes('insufficient'))
    return 'Insufficient $WORD balance.';
  if (msg.includes('network') || msg.includes('timeout') || msg.includes('disconnected'))
    return 'Network error. Check your connection and try again.';
  if (msg.includes('not configured') || msg.includes('not available'))
    return 'Staking is not available right now.';
  return 'Something went wrong. Please try again.';
}

/** Phase-aware button label */
function getPhaseLabel(phase: StakingPhase, action: StakingTab): string {
  const labels: Record<string, string> = {
    'idle': action === 'stake' ? 'Stake' : action === 'unstake' ? 'Unstake' : 'Claim Rewards',
    'approving': 'Approving...',
    'approve-confirming': 'Confirming approval...',
    'staking': 'Staking...',
    'stake-confirming': 'Confirming stake...',
    'withdrawing': 'Unstaking...',
    'withdraw-confirming': 'Confirming unstake...',
    'claiming': 'Claiming...',
    'claim-confirming': 'Confirming claim...',
    'success': 'Done!',
    'error': 'Try again',
  };
  return labels[phase] || 'Submit';
}

function isPhaseBusy(phase: StakingPhase): boolean {
  return !['idle', 'success', 'error'].includes(phase);
}

export default function StakingModal({
  stakedBalance,
  unclaimedRewards,
  stakingPoolShare,
  stakingAvailable,
  walletAddress,
  walletBalance,
  rewardRate,
  periodFinish,
  rewardsDuration,
  xpStakingTier,
  xpStakingMultiplier,
  xpStakingTierName,
  xpTotal,
  xpToNextTier,
  nextTierName,
  xpDailyRate,
  minStakeForBoost,
  meetsMinStake,
  onStakingAction,
  onClose,
}: StakingModalProps) {
  const [activeTab, setActiveTab] = useState<StakingTab>('stake');
  const [stakeAmount, setStakeAmount] = useState('');
  const [unstakeAmount, setUnstakeAmount] = useState('');
  const [showCelebration, setShowCelebration] = useState(false);
  const previousTierRef = useRef(xpStakingTier);

  const { stake, withdraw, claimRewards, phase, error, txHash, reset } = useStaking();

  // Ticking reward counter state
  const [displayedRewards, setDisplayedRewards] = useState(parseFloat(unclaimedRewards) || 0);
  const rewardBaselineRef = useRef({ amount: parseFloat(unclaimedRewards) || 0, time: Date.now() });
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resyncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Tier-up celebration detection
  useEffect(() => {
    if (xpStakingTier > previousTierRef.current) {
      setShowCelebration(true);
      triggerHaptic('success');
      const timer = setTimeout(() => setShowCelebration(false), 3000);
      return () => clearTimeout(timer);
    }
    previousTierRef.current = xpStakingTier;
  }, [xpStakingTier]);

  // Ticking reward counter — uses real rewardRate from contract
  // Stops ticking once periodFinish is reached (mirrors on-chain lastTimeRewardApplicable)
  useEffect(() => {
    const stakedNum = parseFloat(stakedBalance) || 0;
    if (stakedNum === 0) {
      // Not staking — show static prop value, stop ticking
      setDisplayedRewards(parseFloat(unclaimedRewards) || 0);
      rewardBaselineRef.current = { amount: parseFloat(unclaimedRewards) || 0, time: Date.now() };
      return;
    }

    // Anchor baseline to current prop value each time the effect restarts
    rewardBaselineRef.current = { amount: parseFloat(unclaimedRewards) || 0, time: Date.now() };
    setDisplayedRewards(parseFloat(unclaimedRewards) || 0);

    // rewardRate is in wei/second; convert to whole tokens/second
    const ratePerSecond = parseFloat(rewardRate) / 1e18;
    const poolShareNum = parseFloat(stakingPoolShare) || 0;
    // User's share of rewards per second
    const userRewardPerSecond = ratePerSecond * poolShareNum;

    if (userRewardPerSecond <= 0) return;

    // Don't start ticking if period already ended
    const nowSec = Math.floor(Date.now() / 1000);
    if (periodFinish > 0 && nowSec >= periodFinish) return;

    tickIntervalRef.current = setInterval(() => {
      const now = Date.now();
      const nowSeconds = Math.floor(now / 1000);

      // Cap elapsed at periodFinish (on-chain stops accruing after period ends)
      const baselineTimeSec = Math.floor(rewardBaselineRef.current.time / 1000);
      const effectiveEnd = periodFinish > 0 ? Math.min(nowSeconds, periodFinish) : nowSeconds;
      const elapsed = Math.max(0, effectiveEnd - baselineTimeSec);

      const increment = elapsed * userRewardPerSecond;
      setDisplayedRewards(rewardBaselineRef.current.amount + increment);

      // Stop ticking once period ends
      if (periodFinish > 0 && nowSeconds >= periodFinish && tickIntervalRef.current) {
        clearInterval(tickIntervalRef.current);
        tickIntervalRef.current = null;
      }
    }, 200);

    return () => {
      if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);
    };
  }, [stakedBalance, stakingPoolShare, rewardRate, periodFinish, unclaimedRewards]);

  // Resync baseline from prop every 60 seconds
  useEffect(() => {
    resyncIntervalRef.current = setInterval(() => {
      rewardBaselineRef.current = {
        amount: parseFloat(unclaimedRewards) || 0,
        time: Date.now(),
      };
    }, 60_000);

    return () => {
      if (resyncIntervalRef.current) clearInterval(resyncIntervalRef.current);
    };
  }, [unclaimedRewards]);

  // On success: refetch parent data with delay for RPC indexing, then reset
  useEffect(() => {
    if (phase === 'success') {
      // Delay refetch to let RPC node index the new block
      const refetchTimer = setTimeout(() => onStakingAction(), 2000);
      // Retry in case first refetch was too early
      const retryTimer = setTimeout(() => onStakingAction(), 5000);
      const resetTimer = setTimeout(() => {
        reset();
        setStakeAmount('');
        setUnstakeAmount('');
      }, 2500);
      return () => {
        clearTimeout(refetchTimer);
        clearTimeout(retryTimer);
        clearTimeout(resetTimer);
      };
    }
  }, [phase, onStakingAction, reset]);

  const handleStake = useCallback(() => {
    if (!stakeAmount || parseFloat(stakeAmount) <= 0) return;
    stake(stakeAmount);
  }, [stakeAmount, stake]);

  const handleUnstake = useCallback(() => {
    if (!unstakeAmount || parseFloat(unstakeAmount) <= 0) return;
    withdraw(unstakeAmount);
  }, [unstakeAmount, withdraw]);

  const handleClaim = useCallback(() => {
    claimRewards();
  }, [claimRewards]);

  const tabs: { key: StakingTab; label: string }[] = [
    { key: 'stake', label: 'Stake' },
    { key: 'unstake', label: 'Unstake' },
    { key: 'rewards', label: 'Rewards' },
  ];

  // Progress toward next tier
  const currentTierData = XP_TIERS[xpStakingTier] || XP_TIERS[0];
  const nextTierData = xpStakingTier < 3 ? XP_TIERS[xpStakingTier + 1] : null;
  const progressPercent = nextTierData
    ? Math.min(100, ((xpTotal - currentTierData.xpThreshold) / (nextTierData.xpThreshold - currentTierData.xpThreshold)) * 100)
    : 100;

  // Time to next tier estimate
  const daysToNextTier = xpToNextTier && xpDailyRate > 0 ? Math.ceil(xpToNextTier / xpDailyRate) : null;
  const timeEstimate = daysToNextTier
    ? daysToNextTier > 60
      ? `~${(daysToNextTier / 30).toFixed(1)} months at your pace`
      : `~${daysToNextTier} days at your pace`
    : xpDailyRate === 0
      ? 'Play to start earning XP'
      : null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-5 space-y-4 max-h-[85vh] overflow-y-auto"
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
            <h4 className="text-lg font-semibold text-gray-700">Staking coming soon</h4>
            <p className="text-sm text-gray-500">
              The $WORD staking contract is being finalized. Once deployed, you'll be able to stake your tokens to earn rewards and increase your effective balance for higher bonus tiers.
            </p>
          </div>
        ) : (
          <>
            {/* XP Tier Card */}
            <div
              className="relative rounded-xl p-4 space-y-3 overflow-hidden"
              style={{
                background: `linear-gradient(135deg, ${currentTierData.color}15, ${currentTierData.color}08)`,
                border: `1px solid ${currentTierData.color}30`,
              }}
            >
              {/* Celebration animation overlay */}
              {showCelebration && (
                <div className="absolute inset-0 pointer-events-none z-10">
                  <div className="absolute inset-0 animate-pulse" style={{ background: `${currentTierData.color}20` }} />
                  <div className="absolute top-2 left-1/2 -translate-x-1/2 text-sm font-bold px-3 py-1 rounded-full animate-bounce" style={{ background: currentTierData.color, color: 'white' }}>
                    You reached {xpStakingTierName}!
                  </div>
                  {/* CSS confetti particles */}
                  {[...Array(12)].map((_, i) => (
                    <div
                      key={i}
                      className="absolute w-1.5 h-1.5 rounded-full"
                      style={{
                        background: ['#F59E0B', '#CD7F32', '#A0AEC0', '#8B5CF6', '#EC4899'][i % 5],
                        left: `${10 + (i * 7)}%`,
                        top: '-4px',
                        animation: `confetti-fall ${0.8 + (i * 0.15)}s ease-out forwards`,
                        animationDelay: `${i * 0.05}s`,
                      }}
                    />
                  ))}
                </div>
              )}

              {/* Tier badge + multiplier */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className="text-xs font-bold px-2 py-0.5 rounded-full text-white"
                    style={{ background: currentTierData.color }}
                  >
                    {xpStakingTierName.toUpperCase()}
                  </span>
                  <span className="text-sm font-semibold text-gray-700">
                    {xpStakingMultiplier}x boost
                  </span>
                </div>
                <span className="text-xs text-gray-500">{xpTotal.toLocaleString()} XP</span>
              </div>

              {/* Progress bar */}
              {nextTierData ? (
                <div className="space-y-1">
                  <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${progressPercent}%`,
                        background: currentTierData.color,
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>{xpToNextTier?.toLocaleString()} XP to {nextTierName} ({nextTierData.multiplier}x)</span>
                    {timeEstimate && <span>{timeEstimate}</span>}
                  </div>
                </div>
              ) : (
                <div className="text-xs font-medium text-gray-600">Max tier reached</div>
              )}

              {/* Tier roadmap */}
              <div className="flex items-center gap-1 pt-1">
                {XP_TIERS.map((t) => (
                  <div key={t.tier} className="flex-1 flex flex-col items-center">
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                        t.tier <= xpStakingTier ? 'text-white' : 'text-gray-400 bg-gray-200'
                      }`}
                      style={t.tier <= xpStakingTier ? { background: t.color } : undefined}
                    >
                      {t.tier < xpStakingTier ? '✓' : t.tier === xpStakingTier ? '●' : t.tier}
                    </div>
                    <span className="text-[9px] text-gray-500 mt-0.5">{t.name}</span>
                  </div>
                ))}
              </div>

              {/* Min stake warning */}
              {!meetsMinStake && (
                <div className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                  Stake {formatTokenAmount(String(minStakeForBoost))} $WORD to unlock XP boost
                </div>
              )}
            </div>

            {/* Tabs */}
            <div className="flex bg-gray-100 rounded-lg p-1">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => {
                    setActiveTab(tab.key);
                    if (phase !== 'idle') reset();
                  }}
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
            <div className="min-h-[140px]">
              {/* ─── STAKE TAB ─── */}
              {activeTab === 'stake' && (
                <div className="space-y-3">
                  <div className="relative">
                    <input
                      type="number"
                      placeholder="Amount to stake"
                      value={stakeAmount}
                      onChange={(e) => setStakeAmount(e.target.value)}
                      disabled={isPhaseBusy(phase)}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent pr-16"
                    />
                    <button
                      onClick={() => setStakeAmount(walletBalance)}
                      disabled={isPhaseBusy(phase)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-bold text-purple-600 px-2 py-1 hover:bg-purple-50 rounded"
                    >
                      MAX
                    </button>
                  </div>
                  <button
                    onClick={handleStake}
                    disabled={!walletAddress || !stakeAmount || parseFloat(stakeAmount) <= 0 || isPhaseBusy(phase)}
                    className={`w-full py-3 rounded-xl text-sm font-semibold transition-all ${
                      phase === 'success'
                        ? 'bg-green-500 text-white'
                        : phase === 'error'
                        ? 'bg-red-100 text-red-700 hover:bg-red-200'
                        : 'bg-purple-600 text-white hover:bg-purple-700 disabled:bg-gray-200 disabled:text-gray-400'
                    }`}
                  >
                    {phase === 'success' ? '✓ Staked!' : getPhaseLabel(phase, 'stake')}
                  </button>
                  {phase === 'error' && error && (
                    <p className="text-xs text-red-500 text-center">{getFriendlyError(error)}</p>
                  )}
                </div>
              )}

              {/* ─── UNSTAKE TAB ─── */}
              {activeTab === 'unstake' && (
                <div className="space-y-3">
                  <div className="relative">
                    <input
                      type="number"
                      placeholder="Amount to unstake"
                      value={unstakeAmount}
                      onChange={(e) => setUnstakeAmount(e.target.value)}
                      disabled={isPhaseBusy(phase)}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent pr-16"
                    />
                    <button
                      onClick={() => setUnstakeAmount(stakedBalance)}
                      disabled={isPhaseBusy(phase)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-bold text-purple-600 px-2 py-1 hover:bg-purple-50 rounded"
                    >
                      MAX
                    </button>
                  </div>
                  <p className="text-xs text-amber-600">
                    Unstaking reduces your effective balance and may lower your holder tier. Rewards are auto-claimed.
                  </p>
                  <button
                    onClick={handleUnstake}
                    disabled={!walletAddress || !unstakeAmount || parseFloat(unstakeAmount) <= 0 || isPhaseBusy(phase)}
                    className={`w-full py-3 rounded-xl text-sm font-semibold transition-all ${
                      phase === 'success'
                        ? 'bg-green-500 text-white'
                        : phase === 'error'
                        ? 'bg-red-100 text-red-700 hover:bg-red-200'
                        : 'bg-purple-600 text-white hover:bg-purple-700 disabled:bg-gray-200 disabled:text-gray-400'
                    }`}
                  >
                    {phase === 'success' ? '✓ Unstaked!' : getPhaseLabel(phase, 'unstake')}
                  </button>
                  {phase === 'error' && error && (
                    <p className="text-xs text-red-500 text-center">{getFriendlyError(error)}</p>
                  )}
                </div>
              )}

              {/* ─── REWARDS TAB ─── */}
              {activeTab === 'rewards' && (
                <div className="space-y-3 text-center">
                  <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-4">
                    <div className="text-xs text-gray-500 mb-1">Unclaimed Rewards</div>
                    <div className="text-2xl font-bold text-green-700 tabular-nums">
                      {displayedRewards >= 1_000_000
                        ? `${(displayedRewards / 1_000_000).toFixed(2)}M`
                        : displayedRewards >= 1_000
                        ? `${(displayedRewards / 1_000).toFixed(1)}K`
                        : Math.floor(displayedRewards).toLocaleString()
                      }
                      <span className="text-sm font-normal ml-1">$WORD</span>
                    </div>
                    {xpStakingMultiplier > 1 && meetsMinStake && (
                      <div className="text-xs text-green-600 mt-1">
                        Your {xpStakingMultiplier}x {xpStakingTierName} boost is applied to future distributions
                      </div>
                    )}
                  </div>
                  {/* Reward period info */}
                  {periodFinish > 0 && (
                    <div className="flex gap-2 text-xs">
                      <div className="flex-1 bg-gray-50 rounded-lg p-2">
                        <div className="text-gray-500">Period ends</div>
                        <div className="font-semibold">
                          {(() => {
                            const remaining = periodFinish - Math.floor(Date.now() / 1000);
                            if (remaining <= 0) return 'Ended';
                            const days = Math.floor(remaining / 86400);
                            return days > 0 ? `${days}d remaining` : `${Math.floor(remaining / 3600)}h remaining`;
                          })()}
                        </div>
                      </div>
                      <div className="flex-1 bg-gray-50 rounded-lg p-2">
                        <div className="text-gray-500">Est. APR</div>
                        <div className="font-semibold">
                          {(() => {
                            const totalStakedNum = parseFloat(stakedBalance) / (parseFloat(stakingPoolShare) || 1);
                            if (totalStakedNum <= 0) return '—';
                            const ratePerSecond = parseFloat(rewardRate) / 1e18;
                            const yearlyRewards = ratePerSecond * 365 * 86400;
                            const apr = (yearlyRewards / totalStakedNum) * 100;
                            return apr >= 1000 ? `${(apr / 1000).toFixed(1)}K%` : `${apr.toFixed(1)}%`;
                          })()}
                        </div>
                      </div>
                    </div>
                  )}
                  <button
                    onClick={handleClaim}
                    disabled={!walletAddress || displayedRewards <= 0 || isPhaseBusy(phase)}
                    className={`w-full py-3 rounded-xl text-sm font-semibold transition-all ${
                      phase === 'success'
                        ? 'bg-green-500 text-white'
                        : phase === 'error'
                        ? 'bg-red-100 text-red-700 hover:bg-red-200'
                        : 'bg-green-600 text-white hover:bg-green-700 disabled:bg-gray-200 disabled:text-gray-400'
                    }`}
                  >
                    {phase === 'success' ? '✓ Claimed!' : getPhaseLabel(phase, 'rewards')}
                  </button>
                  {phase === 'error' && error && (
                    <p className="text-xs text-red-500 text-center">{getFriendlyError(error)}</p>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Confetti keyframes */}
      <style jsx>{`
        @keyframes confetti-fall {
          0% {
            transform: translateY(0) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: translateY(120px) rotate(360deg);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}

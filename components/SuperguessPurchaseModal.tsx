/**
 * Superguess Purchase Modal
 * Milestone 15: Purchase UI for Superguess mechanic
 *
 * Only accessible when superguessEligible: true (guess count >= 850)
 * Shows current tier + price in $WORD and USD
 * "50% burned . 50% to staking rewards" explainer
 * "Round pauses for all players" warning
 */

import { useState, useEffect, useCallback } from 'react';
import { useSuperguessPayment, type SuperguessPaymentPhase } from '../src/hooks/useSuperguessPayment';
import { formatUnits } from 'viem';

interface SuperguessStatusData {
  available: boolean;
  reason?: string;
  tier?: { id: string; usdPrice: number };
  wordTokenAmount?: string; // e.g. "64M"
  cooldown?: { endsAt: string };
  globalGuessCount?: number;
  roundId?: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onPurchaseComplete?: () => void;
  devFid?: number;
  preview?: boolean; // Use mock data instead of fetching from server
}

const TIER_LABELS: Record<string, string> = {
  tier_1: 'Standard',
  tier_2: 'Enhanced',
  tier_3: 'Premium',
  tier_4: 'Ultra',
};

export default function SuperguessPurchaseModal({ isOpen, onClose, onPurchaseComplete, devFid, preview }: Props) {
  const [statusData, setStatusData] = useState<SuperguessStatusData | null>(null);
  const [loading, setLoading] = useState(true);

  const {
    phase,
    error: paymentError,
    txHash,
    sessionId,
    startPayment,
    reset: resetPayment,
    balance,
  } = useSuperguessPayment(devFid);

  // Fetch availability on open
  useEffect(() => {
    if (!isOpen) return;

    if (preview) {
      // Mock data for UI preview — no server call
      setStatusData({
        available: true,
        tier: { id: 'tier_1', usdPrice: 20 },
        wordTokenAmount: '64M',
        globalGuessCount: 920,
        roundId: 1,
      });
      setLoading(false);
      return;
    }

    const fetchStatus = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/superguess/status');
        const data = await res.json();
        setStatusData(data);
      } catch {
        setStatusData(null);
      } finally {
        setLoading(false);
      }
    };

    fetchStatus();
  }, [isOpen, preview]);

  // Handle purchase complete
  useEffect(() => {
    if (phase === 'complete') {
      onPurchaseComplete?.();
      // Auto-close after brief delay
      setTimeout(() => {
        onClose();
        resetPayment();
      }, 1500);
    }
  }, [phase, onPurchaseComplete, onClose, resetPayment]);

  const handlePurchase = useCallback(() => {
    if (!statusData?.tier) return;

    // For dev mode, use a minimal token amount
    // In production, this would be calculated from the tier price and $WORD market cap
    const tokenAmount = '1000000'; // Placeholder: 1M $WORD tokens
    startPayment(tokenAmount);
  }, [statusData, startPayment]);

  const handleDevPurchase = useCallback(async () => {
    // Dev mode: skip onchain transfer, directly call purchase API
    try {
      const res = await fetch('/api/superguess/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ devFid, txHash: '0xdev' }),
      });
      const data = await res.json();
      if (data.success) {
        onPurchaseComplete?.();
        onClose();
      }
    } catch (err) {
      console.error('Dev purchase failed:', err);
    }
  }, [devFid, onPurchaseComplete, onClose]);

  if (!isOpen) return null;

  const isDevMode = !!devFid;
  const balanceFormatted = balance ? formatUnits(balance, 18) : '0';
  const phaseLabel: Record<SuperguessPaymentPhase, string> = {
    idle: '',
    transferring: 'Submitting transaction...',
    'transfer-confirming': 'Confirming on-chain...',
    purchasing: 'Activating Superguess...',
    complete: 'Superguess activated!',
    error: paymentError || 'Something went wrong',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm px-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl max-w-sm w-full p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <span className="text-2xl">🔴</span>
            Superguess
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-400">Loading...</div>
        ) : !statusData?.available ? (
          <div className="text-center py-4">
            <p className="text-gray-400 mb-2">
              {statusData?.reason === 'below_threshold'
                ? `Available after ${statusData.globalGuessCount || 0} more guesses reach 850`
                : statusData?.reason === 'session_active'
                ? 'A Superguess is already in progress'
                : statusData?.reason === 'cooldown'
                ? 'Cooldown active — try again soon'
                : 'Superguess is not available right now'}
            </p>
          </div>
        ) : (
          <>
            {/* Tier + Price */}
            <div className="bg-gray-800 rounded-xl p-4 mb-4">
              <div className="flex justify-between items-center mb-2">
                <span className="text-gray-400 text-sm">Current Tier</span>
                <span className="text-white font-medium">
                  {TIER_LABELS[statusData.tier?.id || ''] || statusData.tier?.id}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400 text-sm">Price</span>
                <div className="text-right">
                  <span className="text-white font-bold text-lg">
                    ${statusData.tier?.usdPrice} <span className="text-gray-400 text-sm">in $WORD</span>
                  </span>
                  {statusData.wordTokenAmount && (
                    <div className="text-gray-500 text-xs">
                      ≈{statusData.wordTokenAmount} $WORD
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* What you get */}
            <div className="space-y-2 mb-4 text-sm">
              <div className="flex items-center gap-2 text-gray-300">
                <span className="text-amber-400">⚡</span>
                25 exclusive guesses
              </div>
              <div className="flex items-center gap-2 text-gray-300">
                <span className="text-amber-400">⏱️</span>
                10 minute window
              </div>
              <div className="flex items-center gap-2 text-gray-300">
                <span className="text-amber-400">🍿</span>
                Earn the Showstopper Wordmark
              </div>
            </div>

            {/* Rules */}
            <div className="bg-gray-800/50 rounded-lg p-3 mb-4 text-xs text-gray-400 space-y-1.5">
              <p>Timer starts immediately upon purchase — all 25 guesses must be used within the 10-minute window.</p>
              <p>One Superguess per round. Round pauses for all other players while active.</p>
              <p className="text-gray-500">50% of payment burned · 50% to staking rewards</p>
            </div>

            {/* Wallet balance */}
            {balance !== undefined && (
              <div className="text-xs text-gray-500 mb-3">
                Wallet balance: {Number(balanceFormatted).toLocaleString()} $WORD
              </div>
            )}

            {/* Action button */}
            {phase !== 'idle' && phase !== 'error' ? (
              <div className="text-center py-3">
                <div className="text-sm text-gray-300">
                  {phaseLabel[phase]}
                </div>
                {phase === 'complete' && (
                  <div className="text-green-400 text-lg mt-2">✓</div>
                )}
              </div>
            ) : (
              <>
                {paymentError && (
                  <div className="text-red-400 text-xs mb-3 text-center">
                    {paymentError}
                  </div>
                )}
                {isDevMode ? (
                  <button
                    onClick={handleDevPurchase}
                    className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded-xl transition-colors"
                  >
                    Activate Superguess (Dev)
                  </button>
                ) : (
                  <button
                    onClick={handlePurchase}
                    className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded-xl transition-colors"
                  >
                    Purchase Superguess
                  </button>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

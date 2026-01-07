/**
 * BonusWordWinModal
 *
 * Celebration modal shown when a player finds a bonus word.
 * Features:
 * - Confetti celebration
 * - 🎣 badge animation
 * - 5M CLANKTON reward display
 * - Link to BaseScan transaction
 *
 * Bonus Words Feature
 */

import { useEffect, useState } from 'react';
import confetti from 'canvas-confetti';
import { triggerHaptic } from '../src/lib/haptics';

interface BonusWordWinModalProps {
  word: string;
  clanktonAmount: string;
  txHash: string | null;
  onClose: () => void;
}

/**
 * Fire a fish-themed confetti celebration 🎣
 */
function fireCelebration() {
  // Multiple bursts for exciting effect
  const duration = 1500;
  const animationEnd = Date.now() + duration;

  const defaults = {
    startVelocity: 30,
    spread: 360,
    ticks: 60,
    zIndex: 100,
    colors: ['#8B5CF6', '#06B6D4', '#10B981', '#F59E0B', '#EC4899'],
  };

  // Continuous smaller bursts
  const interval = setInterval(() => {
    const timeLeft = animationEnd - Date.now();
    if (timeLeft <= 0) {
      return clearInterval(interval);
    }

    const particleCount = 50 * (timeLeft / duration);

    // Left burst
    confetti({
      ...defaults,
      particleCount,
      origin: { x: 0.2, y: 0.5 },
    });

    // Right burst
    confetti({
      ...defaults,
      particleCount,
      origin: { x: 0.8, y: 0.5 },
    });
  }, 150);

  // Big center burst
  confetti({
    particleCount: 100,
    spread: 100,
    origin: { y: 0.4 },
    colors: ['#8B5CF6', '#A78BFA', '#C4B5FD'],
  });
}

/**
 * Format CLANKTON amount with commas
 */
function formatClankton(amount: string): string {
  const num = parseInt(amount, 10);
  return num.toLocaleString('en-US');
}

export default function BonusWordWinModal({
  word,
  clanktonAmount,
  txHash,
  onClose,
}: BonusWordWinModalProps) {
  const [showContent, setShowContent] = useState(false);

  useEffect(() => {
    // Trigger celebration on mount
    fireCelebration();
    triggerHaptic('success');

    // Stagger content appearance for animation
    setTimeout(() => setShowContent(true), 200);
  }, []);

  const handleViewTransaction = () => {
    triggerHaptic('light');
    if (txHash) {
      window.open(`https://basescan.org/tx/${txHash}`, '_blank');
    }
  };

  const handleContinue = () => {
    triggerHaptic('light');
    onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={handleContinue}
    >
      <div
        className={`bg-gradient-to-b from-purple-50 to-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-5 transform transition-all duration-500 ${
          showContent ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Badge */}
        <div className="text-center">
          {/* Animated fishing hook badge */}
          <div className="relative inline-block">
            <div className="w-24 h-24 bg-gradient-to-br from-cyan-400 to-purple-500 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg animate-bounce-subtle">
              <span className="text-5xl" role="img" aria-label="Side Quest">
                🎣
              </span>
            </div>
            {/* Sparkles around badge */}
            <div className="absolute -top-1 -right-1 text-2xl animate-spin-slow">✨</div>
            <div className="absolute -bottom-1 -left-1 text-2xl animate-spin-slow" style={{ animationDelay: '0.5s' }}>✨</div>
          </div>

          <h2 className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-cyan-500 bg-clip-text text-transparent mb-2">
            Bonus Word Found!
          </h2>
          <p className="text-gray-600">
            You found a secret bonus word
          </p>
        </div>

        {/* Word Display */}
        <div className="bg-white rounded-xl p-4 border-2 border-purple-200 shadow-inner text-center">
          <div className="text-3xl font-mono font-bold tracking-widest text-purple-700">
            {word}
          </div>
        </div>

        {/* Reward Display */}
        <div className="bg-gradient-to-r from-purple-100 to-cyan-100 rounded-xl p-5 text-center">
          <div className="flex items-center justify-center gap-3 mb-2">
            <img
              src="/clankton-logo.png"
              alt="CLANKTON"
              className="w-10 h-10 rounded-full border-2 border-white shadow"
            />
            <div>
              <div className="text-2xl font-bold text-purple-700">
                +{formatClankton(clanktonAmount)} CLANKTON
              </div>
              <div className="text-sm text-purple-500">
                Sent to your wallet
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center gap-2 mt-3">
            <span className="text-xl">🏆</span>
            <span className="text-sm font-medium text-purple-600">
              +250 XP &amp; 🎣 Badge earned!
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-3">
          {txHash && (
            <button
              onClick={handleViewTransaction}
              className="w-full px-4 py-3 bg-white border-2 border-purple-200 hover:border-purple-400 text-purple-700 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2"
            >
              <span>View Transaction</span>
              <span className="text-sm">↗</span>
            </button>
          )}

          <button
            onClick={handleContinue}
            className="w-full px-4 py-3 bg-gradient-to-r from-purple-600 to-cyan-500 hover:from-purple-700 hover:to-cyan-600 text-white rounded-xl font-semibold transition-all shadow-lg"
          >
            Keep Playing!
          </button>
        </div>

        {/* Hint about remaining words */}
        <p className="text-center text-xs text-gray-400">
          Keep guessing - there may be more bonus words this round!
        </p>
      </div>

      {/* CSS animations */}
      <style jsx>{`
        @keyframes bounce-subtle {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-8px);
          }
        }
        .animate-bounce-subtle {
          animation: bounce-subtle 2s ease-in-out infinite;
        }

        @keyframes spin-slow {
          0% {
            transform: rotate(0deg) scale(1);
          }
          50% {
            transform: rotate(180deg) scale(1.2);
          }
          100% {
            transform: rotate(360deg) scale(1);
          }
        }
        .animate-spin-slow {
          animation: spin-slow 3s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
